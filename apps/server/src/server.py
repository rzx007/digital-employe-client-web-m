import os as _os

# 关闭 langsmith tracing（本应用不用，省掉每次模型调用的 trace 开销/后台上报）。
# 必须在任何 langchain/langsmith/langgraph 导入之前设置。
# 注意：不要设 LANGCHAIN_CALLBACKS_BACKGROUND=false —— 实测它会破坏 langgraph 流式
# token 投递与「流结束信号」（表现为只出几个 token 后卡到 60s 超时才收尾、tok 几乎不出）。
_os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
_os.environ.setdefault("LANGSMITH_TRACING", "false")
_os.environ.setdefault("LANGCHAIN_TRACING", "false")

from src.core.logging_setup import setup_logging

setup_logging()

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from src.service.agent.path_access import install as install_agent_path_access
from src.service.agent.compatible_filesystem_middleware import (
    install_compatible_filesystem_middleware,
)

install_compatible_filesystem_middleware()
install_agent_path_access()

from src.service.agent.memory_middleware_patch import install_safe_memory_decode

install_safe_memory_decode()

import logging
import re
import sys
import asyncio

# Windows: 强制用 SelectorEventLoop 取代默认的 ProactorEventLoop。
# 根因（实测）：Proactor 在「大量连接重置 / 超长请求」后会把 IOCP 套接字处理搞坏——
# 满屏 `_ProactorBasePipeTransport._call_connection_lost` WinError 10054，之后整个进程
# 「再也连不上模型」，但同机 curl 同地址却秒连秒回（证明模型/网络无恙、是 Proactor 循环坏了）。
# Selector 把连接错误正常传播、不积累卡死。本应用 shell 子进程走 subprocess.run+线程
# （非 asyncio 异步子进程），不依赖 Proactor，故切换安全。必须在任何事件循环创建前设置。
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        logging.getLogger(__name__).info(
            "Windows: 已切换为 SelectorEventLoop（规避 Proactor 连接重置卡死）"
        )
    except Exception:
        pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import aiosqlite

from src.api import api_router
from src.db.init_db import init_db
from src.db.session import get_session_local
from src.service.employee_service import EmployeeService
from src.service.config_kv_service import ConfigKvService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService
from src.service.workspace_service import WorkspaceService
from src.service.local_skill_service import LocalSkillService
from src.service.agent import init_checkpointer
from src.core.config import get_settings, resolve_sqlite_path
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        loop = asyncio.get_running_loop()

        # 启动即确认实际事件循环类型：Windows 上必须是 SelectorEventLoop，
        # 若是 ProactorEventLoop 则会在连接重置洪流后卡死、整进程连不上模型。
        _loop_name = type(loop).__name__
        _loop_ok = ("Selector" in _loop_name) or sys.platform != "win32"
        logger.warning(
            "事件循环 = %s  [%s]",
            _loop_name,
            "OK" if _loop_ok else "危险: 仍是 Proactor，群聊会卡死！请检查 --loop / start.py",
        )

        # 离线 IO 密集型初始化到线程池，避免阻塞事件循环导致前端请求挂起
        def _startup_db_init():
            init_db()
            with get_session_local()() as db:
                workspace = WorkspaceService.ensure_default_workspace(db)
                inserted = ConfigKvService.bootstrap_from_json(db)
                if inserted > 0:
                    logger.info(
                        "Initialized config_kvs from seed file (insert-only): inserted=%s",
                        inserted,
                    )
                from src.llm.registry import ensure_offline_bootstrap_active, load_registry

                load_registry(db)
                if ensure_offline_bootstrap_active(db):
                    get_settings.cache_clear()
                from src.service import model_patch

                model_patch.apply_if_needed(get_settings())
                LocalSkillService.seed_builtin_skills()
                from src.service.stream_registry import cleanup_zombie_executions

                cleaned = cleanup_zombie_executions(db)
                if cleaned > 0:
                    logger.info("Cleaned %d zombie task executions", cleaned)
                from src.service.agent.memory_file import normalize_all_memory_files

                normalized = normalize_all_memory_files()
                if normalized > 0:
                    logger.info(
                        "Normalized %d employee memory files to UTF-8", normalized
                    )
                WorkspaceService.ensure_workspace_initialized(db, workspace)

        await loop.run_in_executor(None, _startup_db_init)

        # 保存主事件循环引用，供 sync context 调度协程
        from src.service.agent.orchestrator import set_main_event_loop
        set_main_event_loop(loop)

        from src.service.stream_registry import registry as _stream_registry
        from src.service.workspace_events import WorkspaceEventBus

        def _on_task_finalized(
            conversation_id: int,
            stream_state: str,
            task_id: int,
            workspace_id: int,
            *,
            orchestrator_conversation_id: int | None = None,
            summary_message_id: int | None = None,
            execution_log_id: int | None = None,
        ) -> None:
            if (
                stream_state == "completed"
                and orchestrator_conversation_id is not None
            ):
                from src.service.context_compression_checkpoint import (
                    mark_pending_compact,
                )

                mark_pending_compact(
                    orchestrator_conversation_id,
                    "delegation_completed",
                )
            base = {
                "task_id": task_id,
                "conversation_id": conversation_id,
                "execution_log_id": execution_log_id,
                "orchestrator_conversation_id": orchestrator_conversation_id,
                "summary_message_id": summary_message_id,
            }
            if stream_state == "completed":
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_completed",
                    **base,
                })
            elif stream_state == "cancelled":
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_failed",
                    **base,
                    "error": "任务已取消",
                })
            else:
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_failed",
                    **base,
                })

            # 完成驱动调度：任务进入终态后都要驱动 DAG——
            # 成功→派发就绪后继；失败/取消→级联跳过下游（fail-fast），
            # 并让整盘在全部定局后触发汇总（不再因失败而永久僵死）。
            # interrupted 是 HITL 暂停、非终态，不驱动。
            if stream_state in ("completed", "cancelled", "failed", "timeout", "error"):
                try:
                    from src.service.agent.orchestrator.dependency_scheduler import (
                        on_employee_task_completed,
                    )
                    on_employee_task_completed(task_id, workspace_id)
                except Exception:
                    logger.warning(
                        "completion-driven scheduler failed task_id=%s",
                        task_id,
                        exc_info=True,
                    )

        _stream_registry.on_task_finalized = _on_task_finalized

        settings = get_settings()
        sqlite_path = resolve_sqlite_path(settings.sqlite_path)
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)

        await loop.run_in_executor(None, EmployeeService.migrate_local_employees_to_skill_path)

        # LangGraph checkpointer 用**独立库文件** checkpoints.db，与业务 ORM 的 app.db 分开。
        # 根因：群聊并发多条重活流时，LangGraph 每个 super-step 都经这条连接写大 checkpoint
        # （observed 110KB+），与 ORM 的写争用同一个 app.db 的单写锁 → ORM 写 30s 后
        # `database is locked` 失败、checkpoint 写队列雪崩，最终后端空转崩溃。分库后两者
        # 各自独占文件写锁，互不阻塞。checkpoint 是按流的瞬态数据，重启丢弃无碍业务表。
        checkpoint_path = sqlite_path.parent / "checkpoints.db"
        conn = await aiosqlite.connect(str(checkpoint_path), check_same_thread=False)
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA busy_timeout=30000")
        # synchronous=NORMAL：WAL 模式下安全（断电最多丢最后一个事务，checkpoint
        # 可重建），但写不必每次 fsync，大幅加速 checkpoint 落盘。原默认 FULL 会让
        # 每个 super-step 写近 1MB 的 state 都 fsync，是全局串行瓶颈的主因之一。
        await conn.execute("PRAGMA synchronous=NORMAL")
        # 加大 page cache，减少大 blob（checkpoint state 可达数百 KB）读写的 IO
        await conn.execute("PRAGMA cache_size=-16000")  # ~16MB
        # WAL 自动 checkpoint 阈值调大，减少写放大
        await conn.execute("PRAGMA wal_autocheckpoint=2000")
        await conn.commit()
        init_checkpointer(conn)
        logger.info("AsyncSqliteSaver initialized (db=%s)", checkpoint_path)

        # 启动调度器
        TaskSchedulerService.start()
        yield
        # Cancel all active streams so background tasks flush final state
        from src.service.stream_registry import registry
        _active = [cid for cid, t in registry._tasks.items() if t.is_active]
        if _active:
            logger.info("Shutting down %d active streams: %s", len(_active), _active)
            for conv_id in _active:
                registry.cancel(conv_id)
        TaskSchedulerService.shutdown()
        await conn.close()
        logger.info("AsyncSqliteSaver connection closed")
        
    fastapi_app = FastAPI(
        title="欢迎来到数字员工客户端",
        description="数字员工客户端",
        version="1.0.0",
        lifespan=lifespan
    )
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    from starlette.middleware.sessions import SessionMiddleware
    fastapi_app.add_middleware(
        SessionMiddleware,
        secret_key="digital-employee-oauth-secret",
    )

    class WorkspaceHeaderMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            ws_id = request.headers.get("X-Workspace-Id")
            if ws_id:
                try:
                    ws_id_int = int(ws_id)
                except (TypeError, ValueError):
                    return await call_next(request)
                request.state.workspace_id = ws_id_int
                path = request.scope["path"]
                request.scope["path"] = re.sub(
                    r"/workspaces/\d+/",
                    f"/workspaces/{ws_id}/",
                    path,
                )
            return await call_next(request)

    fastapi_app.add_middleware(WorkspaceHeaderMiddleware)

    # 激活拦截：仅在强制激活时挂载，在线 / bypass 下零开销
    from src.core.activation.policy import is_activation_enforced

    if is_activation_enforced():
        from src.middleware.activation_middleware import ActivationMiddleware

        fastapi_app.add_middleware(ActivationMiddleware)
        logger.info("ActivationMiddleware enabled (activation enforced)")

    fastapi_app.include_router(api_router)
    return fastapi_app

app = create_app()
