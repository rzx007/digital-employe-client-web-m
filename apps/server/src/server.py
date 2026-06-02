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
import asyncio
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

        _stream_registry.on_task_finalized = _on_task_finalized

        settings = get_settings()
        sqlite_path = resolve_sqlite_path(settings.sqlite_path)
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)

        await loop.run_in_executor(None, EmployeeService.migrate_local_employees_to_skill_path)

        # LangGraph checkpointer：须在 SQLAlchemy 启动期写入结束后再连接，避免双连接抢锁
        # （sqlite3.OperationalError: database is locked）
        conn = await aiosqlite.connect(str(sqlite_path), check_same_thread=False)
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA busy_timeout=30000")
        await conn.commit()
        init_checkpointer(conn)
        logger.info("AsyncSqliteSaver initialized")

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
