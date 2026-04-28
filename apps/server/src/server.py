from src.core.logging_setup import setup_logging

setup_logging()

import logging
import asyncio
# from sqlalchemy import select
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.sql import select
import aiosqlite

from src.api import api_router
from src.db.init_db import init_db
from src.models.employee import Employee
from src.db.session import get_session_local
from src.service.employee_service import EmployeeService
from src.service.config_kv_service import ConfigKvService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService
from src.service.workspace_service import WorkspaceService
from src.service.agent import init_checkpointer
from src.core.config import get_settings, resolve_sqlite_path
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


def initialize_default_workspace_employees(db, workspace) -> None:
    existing_employee = db.scalar(select(Employee.id).limit(1))
    if existing_employee is not None:
        logger.info("Skip employee bootstrap on startup: employees already exist")
        return
    logger.info(
        "Bootstrap employees on startup: workspace_id=%s workspace_name=%s",
        workspace.id,
        workspace.name,
    )
    EmployeeService.sync_workspace_employees(db, workspace)


def create_app() -> FastAPI:

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_db()
        
        # 保存主事件循环引用，供 sync context 调度协程
        from src.service.orchestrator_agent import set_main_event_loop
        set_main_event_loop(asyncio.get_running_loop())
        
        # 初始化全局 AsyncSqliteSaver
        settings = get_settings()
        sqlite_path = resolve_sqlite_path(settings.sqlite_path)
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        # 保持连接打开直到应用关闭
        conn = await aiosqlite.connect(str(sqlite_path), check_same_thread=False)
        init_checkpointer(conn)
        logger.info("AsyncSqliteSaver initialized")
        
        EmployeeService.migrate_local_employees_to_skill_path()
        with get_session_local()() as db:
            workspace = WorkspaceService.ensure_default_workspace(db)
            inserted = ConfigKvService.bootstrap_from_json(db)
            if inserted > 0:
                logger.info(
                    "Initialized config_kvs from seed file (insert-only): inserted=%s",
                    inserted,
                )
            # 清理僵尸运行状态（上次进程崩溃遗留）
            from src.service.stream_registry import cleanup_zombie_executions
            cleaned = cleanup_zombie_executions(db)
            if cleaned > 0:
                logger.info("Cleaned %d zombie task executions", cleaned)
            # initialize_default_workspace_employees(db, workspace)
            # 获取员工
            # EmployeeService.sync_workspace_employees(db, workspace)
            # 从员工 metadata 同步任务
            TaskService.sync_workspace_tasks(db, workspace.id)
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
    fastapi_app.include_router(api_router)
    return fastapi_app

app = create_app()
