"""编排计划与任务删除/取消的生命周期一致性。"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from src.schemas.resource import ResourceEntry

logger = logging.getLogger(__name__)


def _conversation_file_outputs(db: Session, conversation_id: int | None) -> list[dict]:
    """读某会话全部 assistant 消息 extra_meta.file_outputs，聚合去重。

    Task 5 在流结束时把本轮写的文件落进 assistant 消息的
    `extra_meta.file_outputs`（`[{path, action}]`，path 为 resolve 绝对 posix）。
    这里按 id 升序遍历该会话所有 assistant 消息、容错解析 JSON，按 path 合并：
    后出现的消息覆盖早的 action，但 **create 不被 modify 降级**（一旦标过 create 即 create）。
    返回 `[{path, action}]`。
    """
    if conversation_id is None:
        return []
    msgs = list(
        db.scalars(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role == "assistant",
            )
            .order_by(ConversationMessage.id.asc())
        ).all()
    )
    merged: dict[str, str] = {}
    order: list[str] = []
    for m in msgs:
        if not m.extra_meta:
            continue
        try:
            meta = json.loads(m.extra_meta)
        except (json.JSONDecodeError, TypeError):
            continue
        outputs = meta.get("file_outputs") if isinstance(meta, dict) else None
        if not isinstance(outputs, list):
            continue
        for o in outputs:
            if not isinstance(o, dict):
                continue
            path = o.get("path")
            action = o.get("action")
            if not isinstance(path, str) or not path:
                continue
            if path not in merged:
                order.append(path)
            # create 优先：一旦记过 create，不被后续 modify 降级。
            if merged.get(path) == "create":
                continue
            merged[path] = action if isinstance(action, str) else "modify"
    return [{"path": p, "action": merged[p]} for p in order]


def _filesystem_deliverable_index(product_root: Path) -> dict[str, ResourceEntry]:
    """扫产物根，把 artifacts + skills_draft 两桶里所有 file entry（递归 children）
    按 **resolve 后**的绝对 posix 路径建索引。

    ⚠️ 必须 resolve：journal 侧路径是 `Path(...).resolve().as_posix()`，而
    ResourceEntry.path 来自 iterdir（`as_posix()` 未 resolve）；不对齐则交集全空。
    """
    from src.service.resource_service import ResourceService

    listing = ResourceService.list_resources(product_root)
    index: dict[str, ResourceEntry] = {}

    def _walk(entries: list[ResourceEntry]) -> None:
        for e in entries:
            if e.entry_type == "file":
                try:
                    key = Path(e.path).resolve().as_posix()
                except OSError:
                    continue
                index[key] = e
            elif e.children:
                _walk(e.children)

    _walk(listing.artifacts)
    _walk(listing.skills_draft)
    return index


def collect_plan_deliverables(
    db: Session, plan_id: int, run_id: int | None = None
) -> list[dict]:
    """聚合某编排计划各子任务产出的文件（归属到任务）。

    来源：每个子任务最新执行日志所在员工会话的 assistant 消息
    `extra_meta.file_outputs`（Task 5 写入，含 write/edit/bash 写的文件），聚合后
    与当前文件系统（ResourceService 扫 artifacts + skills_draft 两桶）求**交集**——
    只保留磁盘上仍存在的文件（删除/空文件自然落选）。返回
    [{path, basename, task_id, task_name, action, size}]。

    run_id 给定时，每个子任务的「最新执行日志」只在该轮（TaskExecutionLog.run_id ==
    run_id）内取——只浮现该轮交付物；为 None 时为历史全量（取该任务全历史最新日志）。
    """
    tasks = list(
        db.scalars(
            select(EmployeeTask)
            .where(EmployeeTask.orchestration_plan_id == plan_id)
            .order_by(EmployeeTask.id.asc())
        ).all()
    )

    # journal 侧：聚合各任务会话的 file_outputs（path → 归属信息）。归属（task_id/
    # task_name）跟随后出现的任务；但 action 沿用 journal 内部规则——一旦标过
    # create 即不被后续 modify 降级（create-wins，跨任务同会话内一致）。聚合阶段保留
    # 原始 create/modify，最终产出时统一映射成对外契约的 created/edited（见下方循环）。
    seen: dict[str, dict] = {}
    order: list[str] = []
    for t in tasks:
        log_q = select(TaskExecutionLog).where(TaskExecutionLog.task_id == t.id)
        if run_id is not None:
            log_q = log_q.where(TaskExecutionLog.run_id == run_id)
        log = db.scalars(log_q.order_by(TaskExecutionLog.id.desc())).first()
        conv_id = log.conversation_id if log else None
        for o in _conversation_file_outputs(db, conv_id):
            path = o["path"]
            try:
                key = Path(path).resolve().as_posix()
            except OSError:
                continue
            raw_action = o.get("action") or "modify"
            if key not in seen:
                order.append(key)
                prev_action = None
            else:
                prev_action = seen[key].get("raw_action")
            # create 优先：已是 create 则保留，不被后续 modify 降级。
            action = "create" if prev_action == "create" else raw_action
            seen[key] = {
                "path": key,
                "basename": Path(key).name,
                "task_id": t.id,
                "task_name": t.task_name,
                "raw_action": action,
            }

    if not seen:
        return []

    # 文件系统侧：交集——只保留磁盘上仍存在的文件，size 取文件系统 entry。
    plan = db.get(OrchestrationPlan, plan_id)
    plan_conv = (
        db.get(Conversation, plan.conversation_id)
        if plan is not None and plan.conversation_id is not None
        else None
    )
    if plan_conv is None:
        return []
    from src.service.product_paths import resolve_conversation_product_root

    product_root = resolve_conversation_product_root(db, plan_conv)
    fs_index = _filesystem_deliverable_index(product_root)

    results: list[dict] = []
    for key in order:
        entry = fs_index.get(key)
        if entry is None:
            continue  # 磁盘上已不存在 → 落选
        d = seen[key]
        # 边界映射：把 journal 内部词汇 create/modify 映射回公共契约 created/edited，
        # 保持 PlanDeliverablesCard 契约稳定（default created、只认 edited）。
        raw_action = d.pop("raw_action", "modify")
        d["action"] = "created" if raw_action == "create" else "edited"
        d["size"] = entry.size
        results.append(d)
    return results


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


def resolve_latest_run_id_by_conversation(
    db: Session, conversation_id: int, *, since=None
) -> int | None:
    """某会话最新一轮 PlanRun.id（按 id 降序取首条）；无 → None。

    ChannelManager 只持有 conversation_id（无 plan_id），用此判断「这一轮是否产生了
    编排 run」：None=纯对话回复，非 None=编排轮（需等 plan_run_settled 才回执）。

    ⚠️ ``since``：飞书接盘的是**共享**总管会话，会话里可能残留**历史 PlanRun**（之前几轮
    编排留下的）。若不过滤，纯对话回复会被历史 run 误判成编排轮、傻等永不再来的
    plan_run_settled。故传入本次指令的入站时间（inbox 行 created_at），只算
    ``started_at >= since`` 的 run——即「这条指令进来之后才开始的 run」。
    """
    from src.models.plan_run import PlanRun

    stmt = select(PlanRun.id).where(PlanRun.conversation_id == conversation_id)
    if since is not None:
        stmt = stmt.where(PlanRun.started_at >= since)
    return db.scalar(stmt.order_by(PlanRun.id.desc()))


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
                (log.ended_at - log.started_at).total_seconds()
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
