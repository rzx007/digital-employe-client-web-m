from __future__ import annotations

import asyncio
import logging
from concurrent.futures import TimeoutError as FuturesTimeoutError
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.employee import Employee

logger = logging.getLogger(__name__)

MAX_CONCURRENT_PER_EMPLOYEE = 2

@contextmanager
def orchestrator_sqlite_guard():
    """兼容旧调用；与 src.db.session.SQLITE_ACCESS_LOCK 共用同一把锁。"""
    from src.db.session import SQLITE_ACCESS_LOCK

    SQLITE_ACCESS_LOCK.acquire()
    try:
        yield
    finally:
        SQLITE_ACCESS_LOCK.release()


@contextmanager
def locked_orchestrator_db():
    """流式会话绑定的共享 Session 也须与独立 Session 共用锁。"""
    with orchestrator_sqlite_guard():
        yield get_db()


_main_loop: asyncio.AbstractEventLoop | None = None

_db_session_ctx: ContextVar[Session | None] = ContextVar("orchestrator_db", default=None)
_workspace_id_ctx: ContextVar[int | None] = ContextVar("orchestrator_ws", default=None)
_conversation_id_ctx: ContextVar[int | None] = ContextVar("orchestrator_conv", default=None)
_auth_token_ctx: ContextVar[str | None] = ContextVar("orchestrator_token", default=None)
_user_id_ctx: ContextVar[str | None] = ContextVar("orchestrator_user", default=None)
# 当前执行流的来源（如 "feishu"）。与 db/workspace_id 同点绑定（见 stream_registry
# _run_agent_background），随流隔离——飞书轮与桌面轮各自独立的 ContextVar 值，互不污染。
_source_ctx: ContextVar[str | None] = ContextVar("orchestrator_source", default=None)


def get_orchestrator_source() -> str | None:
    return _source_ctx.get()


def set_orchestrator_source(source: str | None) -> None:
    _source_ctx.set(source)


@dataclass(slots=True)
class OrchestratorStreamSession:
    workspace_id: int
    auth_token: str | None
    user_id: str | None = None


_stream_sessions: dict[int, OrchestratorStreamSession] = {}


def conversation_id_from_runtime(runtime: Any | None) -> int | None:
    if runtime is None:
        return None
    config = getattr(runtime, "config", None)
    if not isinstance(config, dict):
        return None
    configurable = config.get("configurable")
    if not isinstance(configurable, dict):
        return None
    thread_id = configurable.get("thread_id")
    try:
        return int(thread_id) if thread_id is not None else None
    except (TypeError, ValueError):
        return None


def register_stream_session(
    conversation_id: int,
    *,
    workspace_id: int,
    auth_token: str | None,
    user_id: str | None = None,
) -> None:
    _stream_sessions[conversation_id] = OrchestratorStreamSession(
        workspace_id=workspace_id,
        auth_token=(auth_token or "").strip() or None,
        user_id=user_id,
    )


def unregister_stream_session(conversation_id: int) -> None:
    _stream_sessions.pop(conversation_id, None)


def resolve_auth_token(runtime: Any | None = None) -> str | None:
    token = _auth_token_ctx.get()
    if token:
        return token

    conversation_id = conversation_id_from_runtime(runtime) or _conversation_id_ctx.get()
    if conversation_id is not None:
        session = _stream_sessions.get(conversation_id)
        if session and session.auth_token:
            return session.auth_token

    from src.core.config import get_settings

    fallback = (get_settings().skill_remote_token or "").strip()
    return fallback or None


def resolve_workspace_id(runtime: Any | None = None) -> int:
    workspace_id = _workspace_id_ctx.get()
    if workspace_id is not None:
        return workspace_id

    conversation_id = conversation_id_from_runtime(runtime) or _conversation_id_ctx.get()
    if conversation_id is not None:
        session = _stream_sessions.get(conversation_id)
        if session is not None:
            return session.workspace_id

    raise RuntimeError("orchestrator workspace_id not set")


def resolve_user_id(runtime: Any | None = None) -> str | None:
    uid = _user_id_ctx.get()
    if uid is not None:
        return uid
    conversation_id = conversation_id_from_runtime(runtime) or _conversation_id_ctx.get()
    if conversation_id is not None:
        session = _stream_sessions.get(conversation_id)
        if session is not None and session.user_id is not None:
            return session.user_id
    # 兜底：当前激活工作空间的所有者即当前用户（workspace 与 user 永远 1:N，owner 唯一）
    try:
        from src.models.workspace import Workspace

        ws = get_db().get(Workspace, resolve_workspace_id(runtime))
        if ws is not None and ws.user_id is not None:
            return ws.user_id
    except Exception:
        logger.debug("resolve_user_id workspace-owner 兜底失败", exc_info=True)
        return None
    return None


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


# run_coroutine_threadsafe(...).result() 是阻塞的线程调用，asyncio 的 cancel 打不断它。
# 若投递的协程卡住（如它要的 SQLITE_ACCESS_LOCK 正被本 worker 线程自己持有 → 跨线程自锁），
# worker 线程会永久阻塞、永远不释放锁 → orchestration 流首包卡死、且累积漏锁（只能重启）。
# 加超时把「永久阻塞」降级为「超时报错+取消协程+释放线程/锁」，让流能被判死回收。
_RUN_CORO_ON_MAIN_TIMEOUT = 60.0


def run_coro_on_main_loop(coro: Any) -> Any:
    """在线程上下文中将协程安全投递到主事件循环执行并等待结果（带超时，防永久自锁）。"""
    loop = get_main_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    try:
        return future.result(timeout=_RUN_CORO_ON_MAIN_TIMEOUT)
    except FuturesTimeoutError:
        future.cancel()  # 取消投递到主循环的协程，避免它继续占资源
        logger.error(
            "run_coro_on_main_loop 超过 %.0fs 未完成，已取消（疑跨线程自锁/主循环饱和）",
            _RUN_CORO_ON_MAIN_TIMEOUT,
        )
        raise TimeoutError(
            f"主循环协程执行超过 {int(_RUN_CORO_ON_MAIN_TIMEOUT)}s 未返回（疑跨线程自锁）"
        )


def get_db() -> Session:
    db = _db_session_ctx.get()
    if db is None:
        raise RuntimeError("orchestrator DB session not set")
    return db


def get_workspace_id() -> int:
    return resolve_workspace_id()


def get_user_id() -> str | None:
    return resolve_user_id()


def get_conversation_id() -> int | None:
    return _conversation_id_ctx.get()


def set_context(
    db: Session,
    workspace_id: int,
    conversation_id: int | None = None,
    *,
    auth_token: str | None = None,
    bind_auth_token: bool = False,
    user_id: str | None = None,
) -> None:
    _db_session_ctx.set(db)
    _workspace_id_ctx.set(workspace_id)
    _conversation_id_ctx.set(conversation_id)
    _user_id_ctx.set(user_id)
    if bind_auth_token:
        _auth_token_ctx.set(auth_token)
    if conversation_id is not None and bind_auth_token:
        register_stream_session(
            conversation_id,
            workspace_id=workspace_id,
            auth_token=auth_token,
            user_id=user_id,
        )


def get_auth_token() -> str | None:
    return resolve_auth_token()


def reset_context(conversation_id: int | None = None) -> None:
    """清除总管 Tool 的 ContextVar。

    若传入 conversation_id，仅当当前上下文属于该会话时才清除，
    避免串行模式下其他流结束时误清正在排队/执行的总管任务上下文。
    """
    current_conv = _conversation_id_ctx.get()
    if conversation_id is not None and current_conv != conversation_id:
        return
    if current_conv is not None:
        unregister_stream_session(current_conv)
        # 清掉本会话的 list_tasks 轮询计数，避免跨轮（下一轮用户消息）误伤。
        from src.service.agent.orchestrator.task_listing import reset_poll_guard

        reset_poll_guard(current_conv)
    _db_session_ctx.set(None)
    _workspace_id_ctx.set(None)
    _conversation_id_ctx.set(None)
    _auth_token_ctx.set(None)
    _user_id_ctx.set(None)
    _source_ctx.set(None)


def invalidate_orchestrator_db_cache() -> None:
    """fresh Session 写入后，使流式会话中的 ORM 缓存失效。"""
    db = _db_session_ctx.get()
    if db is not None:
        with orchestrator_sqlite_guard():
            db.expire_all()


def count_running_tasks(db: Session, employee_id: int) -> int:
    from src.models.task_execution_log import TaskExecutionLog

    return db.scalar(
        select(func.count(TaskExecutionLog.id)).where(
            TaskExecutionLog.employee_id == employee_id,
            TaskExecutionLog.run_status.in_(("running", "queued")),
        )
    ) or 0


def can_assign_to_employee(db: Session, employee_id: int) -> bool:
    return count_running_tasks(db, employee_id) < MAX_CONCURRENT_PER_EMPLOYEE


def get_employee_name(db: Session, employee_id: int) -> str:
    emp = db.get(Employee, employee_id)
    return emp.name if emp else f"#{employee_id}"


def notify_task_failed_for_conversation(conversation_id: int, error: str) -> None:
    """按会话查找执行日志并推送 task_failed（委派启动失败等）。"""
    from src.db.session import get_session_local
    from src.models.task_execution_log import TaskExecutionLog

    db = get_session_local()()
    try:
        log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.conversation_id == conversation_id,
                TaskExecutionLog.run_status.in_(("running", "queued")),
            )
        ).first()
        if log:
            mark_task_failed(log.task_id, conversation_id, error)
    finally:
        db.close()


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
                TaskExecutionLog.run_status.in_(("running", "queued")),
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
