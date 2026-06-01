"""list_tasks 查询逻辑：独立 Session，避免污染总管流式会话的 SQLite 连接。"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from src.db.session import sqlite_db_session
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.service.task_service import TaskService

logger = logging.getLogger(__name__)

RESULT_EXCERPT_MAX_CHARS = 120
MAX_RESULT_EXCERPT_BLOCKS = 2


def _normalize_limit(limit: int) -> int:
    return limit if limit > 0 else 20


def _is_sqlite_session_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "interfaceerror" in message or "bad parameter or other api misuse" in message


def list_tasks_text(
    workspace_id: int,
    *,
    status: str | None = None,
    plan_id: int | None = None,
    employee_id: int | None = None,
    limit: int = 20,
    include_result_detail: bool = False,
) -> str:
    last_error: BaseException | None = None
    for attempt in range(2):
        try:
            with sqlite_db_session() as db:
                return _list_tasks_in_session(
                    db,
                    workspace_id,
                    status=status,
                    plan_id=plan_id,
                    employee_id=employee_id,
                    limit=_normalize_limit(limit),
                    include_result_detail=include_result_detail,
                )
        except DBAPIError as exc:
            last_error = exc
            if attempt == 0 and _is_sqlite_session_error(exc):
                logger.warning(
                    "list_tasks sqlite session error, retrying once: %s", exc
                )
                continue
            raise
    if last_error is not None:
        raise last_error
    return "没有找到匹配的任务。"


def _list_tasks_in_session(
    db,
    workspace_id: int,
    *,
    status: str | None,
    plan_id: int | None,
    employee_id: int | None,
    limit: int,
    include_result_detail: bool,
) -> str:
    query = select(EmployeeTask).where(
        EmployeeTask.workspace_id == workspace_id,
        EmployeeTask.is_active.is_(True),
    )

    if plan_id is not None:
        query = query.where(EmployeeTask.orchestration_plan_id == plan_id)
    if employee_id is not None:
        query = query.where(EmployeeTask.employee_id == employee_id)
    if status is not None:
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
                ~EmployeeTask.id.in_(select(TaskExecutionLog.task_id).distinct()),
            )

    tasks = list(
        db.scalars(
            query.order_by(EmployeeTask.priority.desc(), EmployeeTask.id.desc()).limit(
                limit
            )
        ).all()
    )

    if not tasks:
        return "没有找到匹配的任务。"

    lines = [
        "（任务配置快照；不含完整交付正文。要看某次执行详情请打开对应员工会话或任务卡片。）",
        "",
        "| ID | 任务名 | 员工 | 模式 | 状态 | 员工会话 |",
        "|---|---|---|---|---|---|",
    ]

    task_ids = [t.id for t in tasks]
    latest_logs = TaskService.latest_execution_logs_by_task_ids(db, task_ids)
    employee_ids = {t.employee_id for t in tasks}
    employee_names = {
        emp.id: emp.name
        for emp in db.scalars(
            select(Employee).where(Employee.id.in_(employee_ids))
        ).all()
    }

    detail_blocks: list[str] = []
    show_details = include_result_detail and len(tasks) <= 5

    for t in tasks:
        emp_name = employee_names.get(t.employee_id) or (
            t.employee_name_snapshot or str(t.employee_id)
        )
        mode = "定时" if t.execute_mode == "scheduled" else "即时"
        latest_log = latest_logs.get(t.id)
        task_status = (
            latest_log.run_status
            if latest_log
            else ("运行中" if t.execute_mode == "scheduled" else "未执行")
        )
        emp_conv = latest_log.conversation_id if latest_log else "—"
        lines.append(
            f"| {t.id} | {t.task_name} | {emp_name} | {mode} | {task_status} | {emp_conv} |"
        )
        if show_details and latest_log and latest_log.run_status == "success":
            from src.service.orchestrator_execution_summary import (
                extract_execution_output_text,
            )

            excerpt = extract_execution_output_text(
                latest_log.output_json, max_chars=RESULT_EXCERPT_MAX_CHARS
            )
            if excerpt:
                one_line = " ".join(excerpt.split())
                detail_blocks.append(
                    f"- #{t.id} {t.task_name}：{one_line[:RESULT_EXCERPT_MAX_CHARS]}"
                )
                if len(detail_blocks) >= MAX_RESULT_EXCERPT_BLOCKS:
                    break

    result = "\n".join(lines)
    if len(tasks) >= limit:
        result += f"\n\n（仅显示前 {limit} 条；请用 employee_id 或 plan_id 缩小范围。）"
    if detail_blocks:
        result += "\n\n**结果摘要（最多 2 条、每条 ≤120 字）**\n" + "\n".join(
            detail_blocks
        )
    return result
