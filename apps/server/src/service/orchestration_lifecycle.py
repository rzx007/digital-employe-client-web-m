"""编排计划与任务删除/取消的生命周期一致性。"""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)


def _looks_like_product(path: str) -> bool:
    """该 write/edit 的目标是否算「项目产物」：排除 uploads/memories/已装 skills；
    草稿技能(skills-draft)算交付物；相对名(无目录段,落在产物 cwd)算产物。"""
    n = (path or "").replace("\\", "/").lower()
    if not n:
        return False
    if "/skills-draft/" in n:
        return True
    for seg in ("/uploads/", "/memories/", "/skills/"):
        if seg in n:
            return False
    return True


def _plan_artifacts_dir(db: Session, plan):
    """该计划对应项目的共享产物目录（用于存在性过滤）。失败→None。"""
    from src.service.agent.orchestrator.qa_delivery_check import _resolve_artifacts_dir

    conv_id = getattr(plan, "conversation_id", None)
    return _resolve_artifacts_dir(db, conv_id) if conv_id else None


def _still_exists_nonempty(path: str, artifacts_dir) -> bool:
    """文件结束时是否仍真实存在且非空（过滤跑完即删的临时脚本）。

    相对名按产物目录解析；产物目录解析不到时**保守保留**（不误删真实交付物）。
    """
    from pathlib import Path

    try:
        p = Path(str(path).replace("\\", "/"))
        if not p.is_absolute():
            if artifacts_dir is None:
                return True
            p = Path(artifacts_dir) / p
        return p.is_file() and p.stat().st_size > 0
    except OSError:
        return True


def collect_plan_deliverables(
    db: Session, plan_id: int, run_id: int | None = None
) -> list[dict]:
    """聚合某编排计划各子任务产出的文件（归属到任务）。

    来源：每个子任务最新执行日志所在员工会话的 write_file/edit_file 工具 parts 的
    file_path（排除非产物桶、去重），**且只保留结束时磁盘上仍存在且非空的文件**——
    跑完即删的临时脚本会被过滤掉。返回 [{path, basename, task_id, task_name, action}]。
    注：shell 直接写的文件不在 parts 里、会漏（已知限制，按需再补目录扫描）。

    run_id 给定时，每个子任务的「最新执行日志」只在该轮（TaskExecutionLog.run_id ==
    run_id）内取——只浮现该轮交付物；为 None 时为历史全量（取该任务全历史最新日志）。
    """
    from src.service.task_service import TaskService

    tasks = list(
        db.scalars(
            select(EmployeeTask)
            .where(EmployeeTask.orchestration_plan_id == plan_id)
            .order_by(EmployeeTask.id.asc())
        ).all()
    )
    seen: dict[str, dict] = {}
    order: list[str] = []
    for t in tasks:
        log_q = select(TaskExecutionLog).where(TaskExecutionLog.task_id == t.id)
        if run_id is not None:
            log_q = log_q.where(TaskExecutionLog.run_id == run_id)
        log = db.scalars(log_q.order_by(TaskExecutionLog.id.desc())).first()
        conv_id = log.conversation_id if log else None
        for p in TaskService.get_conversation_tool_parts(db, conv_id):
            ptype = p.get("type", "")
            action = (
                "created" if ptype == "tool-write_file"
                else "edited" if ptype == "tool-edit_file"
                else None
            )
            if action is None:
                continue
            inp = p.get("input") if isinstance(p.get("input"), dict) else {}
            fp = inp.get("file_path")
            if not isinstance(fp, str) or not fp or not _looks_like_product(fp):
                continue
            # size 只取 created 的 content 长度（≈文件大小）；edited 的 new_string 是
            # 片段、用作 size 会误导，故置 None，并在去重时保留 create 时已记的大小。
            content = inp.get("content") if action == "created" else None
            size = len(content) if isinstance(content, str) else None
            norm = fp.replace("\\", "/")
            base = norm.rstrip("/").split("/")[-1]
            if norm not in seen:
                order.append(norm)
            prev = seen.get(norm)
            seen[norm] = {
                "path": fp,
                "basename": base,
                "task_id": t.id,
                "task_name": t.task_name,
                "action": action,
                "size": size if size is not None else (prev or {}).get("size"),
            }

    plan = db.get(OrchestrationPlan, plan_id)
    adir = _plan_artifacts_dir(db, plan) if plan is not None else None
    return [
        seen[k] for k in order if _still_exists_nonempty(seen[k]["path"], adir)
    ]


def resolve_run_id_for_conversation(
    db: Session, plan_id: int, conversation_id: int
) -> int | None:
    """某会话对应的 PlanRun.id（该计划下 conversation_id 命中的轮）；无 → None。

    用于 per-run 会话按本轮过滤交付物：scheduled 轮有专属会话，命中其 run；
    非任何 run 的会话（如纯定时计划创建源会话）返回 None。

    注：manual 轮共用 plan.conversation_id（execution 处 run.conversation_id=plan.conversation_id），
    同一会话可能命中多轮 → order_by id desc 取最新轮，保证确定性。
    """
    from src.models.plan_run import PlanRun

    return db.scalar(
        select(PlanRun.id)
        .where(
            PlanRun.plan_id == plan_id,
            PlanRun.conversation_id == conversation_id,
        )
        .order_by(PlanRun.id.desc())
    )


def cancel_running_executions_for_task(
    db: Session,
    task_id: int,
    *,
    reason: str = "任务已删除，执行已取消",
) -> int:
    """取消 task_id 上仍在 running 的执行，并更新 TaskExecutionLog。"""
    logs = list(
        db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.task_id == task_id,
                TaskExecutionLog.run_status == "running",
            )
        ).all()
    )
    if not logs:
        return 0

    from src.service.chat_service import ChatService

    now = cst_now()
    for log in logs:
        if log.conversation_id:
            ChatService.cancel_conversation_stream(log.conversation_id)
        log.run_status = "cancelled"
        log.run_result = reason
        log.ended_at = now
        if log.started_at:
            log.duration_ms = int(
                (
                    log.ended_at.replace(tzinfo=None)
                    - log.started_at.replace(tzinfo=None)
                ).total_seconds()
                * 1000
            )

    db.commit()
    logger.info(
        "cancelled %s running execution(s) for task_id=%s",
        len(logs),
        task_id,
    )
    return len(logs)


def finalize_orchestration_plan_if_empty(db: Session, plan_id: int) -> bool:
    """若编排计划下已无子任务，则将 plan 标为 cancelled。"""
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan or plan.status == "cancelled":
        return False

    remaining = (
        db.scalar(
            select(func.count())
            .select_from(EmployeeTask)
            .where(EmployeeTask.orchestration_plan_id == plan_id)
        )
        or 0
    )
    if remaining > 0:
        return False

    plan.status = "cancelled"
    db.commit()
    logger.info("orchestration plan #%s cancelled (no remaining tasks)", plan_id)
    return True


def update_pending_plan_task(
    db: Session,
    workspace_id: int,
    plan_id: int,
    task_id: int,
    *,
    prompt: str | None = None,
    employee_id: int | None = None,
) -> dict:
    """编辑**待确认(pending)**编排计划的单个子任务：改 prompt / 换指派员工。

    只在 confirm 前可改（executing/confirmed → 走返工，不走这里）；不动 depends_on /
    位置 / 任务增删，故 DAG 映射不受影响。换员工不得使全部子任务塌成同一员工。
    同步 plan_json 对应位置的快照（保持卡片显示一致）。返回更新后的任务字段。
    异常用 HTTPException（404/400），与 EmployeeService 一致由端点直接透出。
    """
    import json as _json

    from fastapi import HTTPException, status as http_status

    from src.models.employee import Employee
    from src.models.workspace import Workspace

    plan = db.get(OrchestrationPlan, plan_id)
    if plan is None or plan.workspace_id != workspace_id:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, detail="编排计划不存在")
    if plan.status != "pending":
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            detail=f"计划当前状态为 {plan.status}，仅待确认计划可编辑；已在执行的请用返工。",
        )

    tasks = list(
        db.scalars(
            select(EmployeeTask)
            .where(EmployeeTask.orchestration_plan_id == plan_id)
            .order_by(EmployeeTask.id.asc())
        ).all()
    )
    task = next((t for t in tasks if t.id == task_id), None)
    if task is None:
        raise HTTPException(
            http_status.HTTP_404_NOT_FOUND, detail="子任务不存在或不属于该计划"
        )

    emp: Employee | None = None
    if employee_id is not None and employee_id != task.employee_id:
        emp = db.get(Employee, employee_id)
        ws = db.get(Workspace, workspace_id)
        owner = ws.user_id if ws is not None else None
        if emp is None or (owner is not None and emp.user_id != owner):
            raise HTTPException(
                http_status.HTTP_404_NOT_FOUND, detail="指定的员工不存在"
            )
        # 换员工后不得让全部子任务塌成同一员工（多人协作的前提）
        new_ids = [
            (employee_id if t.id == task_id else t.employee_id) for t in tasks
        ]
        if len(tasks) > 1 and len(set(new_ids)) == 1:
            raise HTTPException(
                http_status.HTTP_400_BAD_REQUEST,
                detail="所有子任务都会指派给同一员工；多人协作请分配不同员工。",
            )

    changed = False
    if prompt is not None and prompt != task.user_prompt:
        task.user_prompt = prompt
        changed = True
    if emp is not None:
        task.employee_id = emp.id
        task.employee_name_snapshot = emp.name or ""
        changed = True

    if changed:
        # 同步 plan_json 镜像（按 id 升序定位 position；位置不变）
        try:
            pos = next(i for i, t in enumerate(tasks) if t.id == task_id)
            plan_json = _json.loads(plan.plan_json or "[]")
            if 0 <= pos < len(plan_json) and isinstance(plan_json[pos], dict):
                if prompt is not None:
                    plan_json[pos]["prompt"] = prompt
                if emp is not None:
                    plan_json[pos]["employee_id"] = emp.id
                plan.plan_json = _json.dumps(plan_json, ensure_ascii=False)
        except (ValueError, StopIteration):
            logger.warning("update_pending_plan_task: plan_json 同步失败 plan=%s", plan_id, exc_info=True)
        db.commit()
        db.refresh(task)

    return {
        "task_id": task.id,
        "employee_id": task.employee_id,
        "employee_name": task.employee_name_snapshot or "",
        "prompt": task.user_prompt or "",
    }


def cancel_orchestration_plan(db: Session, plan_id: int) -> str | None:
    """取消编排计划：终止进行中执行、停用子任务、刷新调度。"""
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"编排计划 #{plan_id} 不存在。"
    if plan.status not in ("pending", "confirmed"):
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法取消。"

    tasks = list(
        db.scalars(
            select(EmployeeTask).where(
                EmployeeTask.orchestration_plan_id == plan_id
            )
        ).all()
    )

    for task in tasks:
        cancel_running_executions_for_task(
            db,
            task.id,
            reason="编排计划已取消，执行已终止",
        )
        task.is_active = False

    plan.status = "cancelled"
    db.commit()

    from src.service.task_scheduler_service import TaskSchedulerService

    TaskSchedulerService.reload_jobs()
    logger.info(
        "orchestration plan #%s cancelled, %s task(s) deactivated",
        plan_id,
        len(tasks),
    )
    return None
