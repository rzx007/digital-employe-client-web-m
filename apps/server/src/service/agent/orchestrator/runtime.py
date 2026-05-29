from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.employee import Employee

logger = logging.getLogger(__name__)

MAX_CONCURRENT_PER_EMPLOYEE = 2

_main_loop: asyncio.AbstractEventLoop | None = None

_db_session_ctx: ContextVar[Session | None] = ContextVar("orchestrator_db", default=None)
_workspace_id_ctx: ContextVar[int | None] = ContextVar("orchestrator_ws", default=None)
_conversation_id_ctx: ContextVar[int | None] = ContextVar("orchestrator_conv", default=None)
_auth_token_ctx: ContextVar[str | None] = ContextVar("orchestrator_token", default=None)


def set_main_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """
    main_loop = 应用主 asyncio 循环的句柄；
    call_soon_threadsafe 用来在「非 async / 可能跨线程」的 orchestrator 代码里，
    安全地把「启动流式 agent 任务」丢回主循环执行，避免 asyncio.create_task 用错循环。
    """
    global _main_loop
    _main_loop = loop


def get_main_loop() -> asyncio.AbstractEventLoop:
    if _main_loop is None:
        raise RuntimeError("main event loop not set")
    return _main_loop


# 兼容 task_scheduler_service 等既有 import
_get_main_loop = get_main_loop


def run_coro_on_main_loop(coro: Any) -> Any:
    """在线程上下文中将协程安全投递到主事件循环执行并等待结果。"""
    loop = get_main_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result()


def get_db() -> Session:
    db = _db_session_ctx.get()
    if db is None:
        raise RuntimeError("orchestrator DB session not set")
    return db


def get_workspace_id() -> int:
    ws = _workspace_id_ctx.get()
    if ws is None:
        raise RuntimeError("orchestrator workspace_id not set")
    return ws


def get_conversation_id() -> int | None:
    return _conversation_id_ctx.get()


def set_context(
    db: Session,
    workspace_id: int,
    conversation_id: int | None = None,
    *,
    auth_token: str | None = None,
    bind_auth_token: bool = False,
) -> None:
    _db_session_ctx.set(db)
    _workspace_id_ctx.set(workspace_id)
    _conversation_id_ctx.set(conversation_id)
    if bind_auth_token:
        _auth_token_ctx.set(auth_token)


def get_auth_token() -> str | None:
    return _auth_token_ctx.get()


def reset_context() -> None:
    """清除总管 Tool 的 ContextVar（后台流结束后调用，避免泄漏到其他任务）。"""
    _db_session_ctx.set(None)
    _workspace_id_ctx.set(None)
    _conversation_id_ctx.set(None)
    _auth_token_ctx.set(None)


def invalidate_orchestrator_db_cache() -> None:
    """fresh Session 写入后，使流式会话中的 ORM 缓存失效。"""
    db = _db_session_ctx.get()
    if db is not None:
        db.expire_all()


def count_running_tasks(db: Session, employee_id: int) -> int:
    from src.models.task_execution_log import TaskExecutionLog

    return db.scalar(
        select(func.count(TaskExecutionLog.id)).where(
            TaskExecutionLog.employee_id == employee_id,
            TaskExecutionLog.run_status == "running",
        )
    ) or 0


def can_assign_to_employee(db: Session, employee_id: int) -> bool:
    return count_running_tasks(db, employee_id) < MAX_CONCURRENT_PER_EMPLOYEE


def get_employee_name(db: Session, employee_id: int) -> str:
    emp = db.get(Employee, employee_id)
    return emp.name if emp else f"#{employee_id}"


def mark_task_failed(task_id: int, conversation_id: int, error: str) -> None:
    from src.db.session import get_session_local
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    from src.service.workspace_events import WorkspaceEventBus

    db = get_session_local()()
    try:
        log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.task_id == task_id,
                TaskExecutionLog.run_status == "running",
            )
        ).first()
        if log:
            log.run_status = "failed"
            log.run_result = "任务执行失败"
            log.error_message = error[:2000] if error else "agent thread crash"
            log.ended_at = cst_now()
            if log.started_at:
                log.duration_ms = int(
                    (log.ended_at - log.started_at).total_seconds() * 1000
                )
            db.commit()
            WorkspaceEventBus.push(log.workspace_id, {
                "type": "task_failed",
                "task_id": task_id,
                "conversation_id": conversation_id,
                "error": error[:200],
            })
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
