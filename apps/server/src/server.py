from src.core.logging_setup import setup_logging

setup_logging()

import logging
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

        await loop.run_in_executor(None, _startup_db_init)

        # 保存主事件循环引用，供 sync context 调度协程
        from src.service.orchestrator_agent import set_main_event_loop
        set_main_event_loop(loop)

        from src.service.stream_registry import registry as _stream_registry
        from src.service.workspace_events import WorkspaceEventBus

        def _on_task_finalized(conversation_id: int, stream_state: str, task_id: int, workspace_id: int) -> None:
            if stream_state == "completed":
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_completed",
                    "task_id": task_id,
                    "conversation_id": conversation_id,
                })
            elif stream_state == "cancelled":
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_failed",
                    "task_id": task_id,
                    "conversation_id": conversation_id,
                    "error": "任务已取消",
                })
            else:
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_failed",
                    "task_id": task_id,
                    "conversation_id": conversation_id,
                })

        _stream_registry.on_task_finalized = _on_task_finalized

        settings = get_settings()
        sqlite_path = resolve_sqlite_path(settings.sqlite_path)
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)

        await loop.run_in_executor(None, EmployeeService.migrate_local_employees_to_skill_path)

        def _startup_data_init():
            with get_session_local()() as db:
                workspace = WorkspaceService.ensure_default_workspace(db)
                inserted = ConfigKvService.bootstrap_from_json(db)
                if inserted > 0:
                    logger.info(
                        "Initialized config_kvs from seed file (insert-only): inserted=%s",
                        inserted,
                    )
                LocalSkillService.seed_builtin_skills()
                # 清理僵尸运行状态（上次进程崩溃遗留）
                from src.service.stream_registry import cleanup_zombie_executions
                cleaned = cleanup_zombie_executions(db)
                if cleaned > 0:
                    logger.info("Cleaned %d zombie task executions", cleaned)
                EmployeeService.ensure_builtin_seed_employees(db, workspace)
                EmployeeService.ensure_curator_employee(db, workspace.id)
                TaskService.sync_workspace_tasks(db, workspace.id)

        await loop.run_in_executor(None, _startup_data_init)

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
    fastapi_app.include_router(api_router)
    return fastapi_app

app = create_app()
