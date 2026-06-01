"""子任务管理工具：列表 / 更新 / 单删 / 批量删。"""

from __future__ import annotations

import json

from langchain_core.tools import tool
from sqlalchemy import select

from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.service.agent.orchestrator.runtime import (
    get_db,
    get_workspace_id,
    invalidate_orchestrator_db_cache,
)
from src.service.agent.orchestrator.task_mutations import (
    MAX_TASK_DELETE_BATCH,
    _delete_task_with_fresh_session,
    _update_task_with_fresh_session,
    delete_tasks_batch as run_delete_tasks_batch,
)


@tool
def update_task(
    task_id: int,
    task_name: str | None = None,
    prompt: str | None = None,
    cron: str | None = None,
    employee_id: int | None = None,
) -> str:
    """修改已存在的子任务。参数均可选，只更新传入的非 None 字段。"""
    workspace_id = get_workspace_id()
    result = _update_task_with_fresh_session(
        workspace_id,
        task_id,
        task_name=task_name,
        prompt=prompt,
        cron=cron,
        employee_id=employee_id,
    )
    if result.get("error"):
        return f"错误：{result['error']}"

    changed = result.get("changed") or []
    if not changed:
        return result.get("message") or "未做任何修改。"

    if "调度时间" in changed:
        from src.service.task_scheduler_service import TaskSchedulerService

        TaskSchedulerService.reload_jobs()
    invalidate_orchestrator_db_cache()
    return result.get("message") or f"任务 #{task_id} 已更新。"


@tool
def delete_task(task_id: int) -> str:
    """删除单个子任务（物理删除，关联的执行记录会保留但 task_id 置空）。"""
    workspace_id = get_workspace_id()
    result = _delete_task_with_fresh_session(workspace_id, task_id)
    if result.get("error"):
        return f"错误：{result['error']}"

    from src.service.task_scheduler_service import TaskSchedulerService

    TaskSchedulerService.reload_jobs()
    invalidate_orchestrator_db_cache()
    task_name = result.get("task_name") or ""
    return f"任务 #{task_id} ({task_name}) 已删除。"


@tool
def delete_tasks_batch(task_ids: str) -> str:
    """批量删除多个子任务（一次调用，逐任务独立 Session，整批只刷新调度一次）。

    当用户要求删除 2 个及以上任务时使用本工具，不要用同一轮多次 delete_task。

    参数 task_ids: JSON 整数数组字符串，例如 "[31, 32, 33]"
    """
    workspace_id = get_workspace_id()

    try:
        parsed = json.loads(task_ids)
    except json.JSONDecodeError as exc:
        return f"错误：task_ids 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list):
        return "错误：task_ids 必须为 JSON 数组。"
    if len(parsed) == 0:
        return "错误：task_ids 不能为空。"
    if len(parsed) > MAX_TASK_DELETE_BATCH:
        return f"错误：单次最多删除 {MAX_TASK_DELETE_BATCH} 个任务。"

    normalized: list[int] = []
    for i, raw in enumerate(parsed):
        try:
            normalized.append(int(raw))
        except (TypeError, ValueError):
            return f"错误：task_ids[{i}] 不是有效整数: {raw!r}"

    raw = run_delete_tasks_batch(workspace_id, normalized, reload_scheduler=True)
    if not raw.startswith("错误："):
        invalidate_orchestrator_db_cache()
    return raw


@tool
def list_tasks(
    status: str | None = None,
    plan_id: int | None = None,
    employee_id: int | None = None,
    limit: int = 20,
) -> str:
    """查询工作空间已配置任务（employee_tasks 表快照，非员工实时流）。

    适用：
    - 用户问「某员工有没有/有哪些定时任务」→ employee_id=该员工 ID（Prompt 员工表有摘要，需 cron/详情时用本工具）
    - 用户追问某编排计划进度 → plan_id=计划 ID
    - 委派快照缺失或与用户描述矛盾时的补充查询
    禁止：confirm 后反复轮询；Prompt 表已能回答「有没有」时勿重复调用。
    建议：带 employee_id 或 plan_id 精确查询；limit 宜 ≤ 5。
    """
    db = get_db()
    workspace_id = get_workspace_id()

    query = select(EmployeeTask).where(
        EmployeeTask.workspace_id == workspace_id,
        EmployeeTask.is_active.is_(True),
    )

    if plan_id is not None:
        query = query.where(EmployeeTask.orchestration_plan_id == plan_id)
    if employee_id is not None:
        query = query.where(EmployeeTask.employee_id == employee_id)
    if status is not None:
        from src.models.task_execution_log import TaskExecutionLog

        if status in ("executing",):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "running"
            ).distinct()
            query = query.where(
                (EmployeeTask.execute_mode == "scheduled")
                | (EmployeeTask.id.in_(sub))
            )
        elif status in ("completed", "success"):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "success"
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status in ("failed", "timeout", "cancelled"):
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status.in_(["failed", "timeout", "cancelled"])
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status == "pending":
            query = query.where(
                EmployeeTask.execute_mode == "scheduled",
                ~EmployeeTask.id.in_(
                    select(TaskExecutionLog.task_id).distinct()
                ),
            )

    tasks = list(
        db.scalars(
            query.order_by(EmployeeTask.priority.desc(), EmployeeTask.id.desc()).limit(limit)
        ).all()
    )

    if not tasks:
        return "没有找到匹配的任务。"

    lines = [
        "| ID | 任务名 | 员工 | 执行模式 | 状态 | 员工会话 |",
        "|---|---|---|---|---|---|",
    ]
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.orchestrator_execution_summary import (
        extract_execution_output_text,
    )

    detail_blocks: list[str] = []

    for t in tasks:
        emp = db.get(Employee, t.employee_id)
        emp_name = emp.name if emp else (t.employee_name_snapshot or str(t.employee_id))
        mode = "定时" if t.execute_mode == "scheduled" else "即时"
        latest_log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.task_id == t.id
            ).order_by(TaskExecutionLog.id.desc()).limit(1)
        ).first()
        task_status = (
            latest_log.run_status
            if latest_log
            else ("运行中" if t.execute_mode == "scheduled" else "未执行")
        )
        emp_conv = latest_log.conversation_id if latest_log else "—"
        lines.append(
            f"| {t.id} | {t.task_name} | {emp_name} | {mode} | {task_status} | {emp_conv} |"
        )
        if latest_log and latest_log.run_status == "success":
            excerpt = extract_execution_output_text(
                latest_log.output_json, max_chars=600
            )
            if excerpt:
                detail_blocks.append(
                    f"任务 #{t.id}（{t.task_name}）最新结果摘要：\n{excerpt}"
                )

    result = "\n".join(lines)
    if detail_blocks:
        result += "\n\n" + "\n\n".join(detail_blocks)
    return result
