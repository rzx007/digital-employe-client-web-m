"""list_tasks 查询逻辑：独立 Session，避免污染总管流式会话的 SQLite 连接。"""

from __future__ import annotations

import logging
import time

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

# ── list_tasks 反复轮询硬闸 ────────────────────────────────────────────────
# 组长（群编排）确认计划后，本应结束本轮、由完成驱动调度器自动派活+自动汇总
# （dependency_scheduler.on_employee_task_completed → summarize_by_leader）。
# 但模型常无视 prompt 里「别反复轮询」的软约束，确认后进入「让我再检查一次任务
# 状态」→ list_tasks 看到 running → 再检查的死循环：本轮永不结束 → 流式会话永不
# 释放（「组长会话停不掉」）→ 占满槽位/喂爆序列化层，是导致整体卡死的导火索之一。
# 软提示治不了（同 read_file 软停止），故在工具层硬闸：同一会话短窗口内重复
# list_tasks 超阈值，直接返回「停手」指令而非又一张邀请再轮询的状态表。
_POLL_WINDOW_SECONDS = 90.0
_POLL_HARD_LIMIT = 3
# conversation_id -> [单调时间戳, ...]（仅保留窗口内的）
_recent_list_task_calls: dict[int, list[float]] = {}

_POLL_STOP_DIRECTIVE = (
    "⛔ 你已在短时间内多次查询任务状态。**请立即停手并结束本轮，不要再调用 "
    "list_tasks。**\n\n"
    "原因：任务在各成员的独立会话里执行，**无需你轮询**。所有子任务完成后，"
    "系统会**自动**触发你做最终汇总并发到群里（完成驱动，无需你介入）；任务失败"
    "也会自动产生「【任务失败】」消息。反复 list_tasks 不会让任务更快完成，只会"
    "让本轮一直挂着、占用资源。\n\n"
    "现在请用一句话告诉用户「任务正在执行中，完成后会自动汇总」，然后**结束本轮，"
    "停止任何工具调用**。"
)


def _record_poll_and_should_block(conversation_id: int | None) -> bool:
    """登记一次 list_tasks 调用；返回是否应在本会话触发硬闸。

    用单调时钟的滑动窗口：窗口内累计调用次数达上限即拦截。窗口外的旧记录被丢弃，
    所以正常的「偶尔查一次」永远不会触发；只有短时间高频轮询才命中。
    """
    if conversation_id is None:
        return False
    now = time.monotonic()
    window = [
        ts for ts in _recent_list_task_calls.get(conversation_id, [])
        if now - ts < _POLL_WINDOW_SECONDS
    ]
    window.append(now)
    _recent_list_task_calls[conversation_id] = window
    return len(window) >= _POLL_HARD_LIMIT


def reset_poll_guard(conversation_id: int | None) -> None:
    """清除某会话的轮询计数（流结束/新一轮用户消息时调用，避免跨轮误伤）。"""
    if conversation_id is not None:
        _recent_list_task_calls.pop(conversation_id, None)


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

    _pending_cache: dict = {}
    for t in tasks:
        emp_name = employee_names.get(t.employee_id) or (
            t.employee_name_snapshot or str(t.employee_id)
        )
        mode = "定时" if t.execute_mode == "scheduled" else "即时"
        latest_log = latest_logs.get(t.id)
        if latest_log:
            task_status = latest_log.run_status
        elif t.execute_mode == "scheduled":
            task_status = "运行中"
        else:
            from src.service.agent.orchestrator.dependency_scheduler import (
                waiting_status_for_task,
            )
            task_status = (
                waiting_status_for_task(db, t, _plan_cache=_pending_cache) or "未执行"
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
