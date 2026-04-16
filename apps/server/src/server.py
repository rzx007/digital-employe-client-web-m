import logging
# from sqlalchemy import select
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.sql import select

from src.api import api_router
from src.db.init_db import init_db
from src.models.employee import Employee
from src.db.session import get_session_local
from src.service.employee_service import EmployeeService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService
from src.service.workspace_service import WorkspaceService
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


def initialize_default_workspace_employees(db, workspace) -> None:
    existing_employee = db.scalar(select(Employee.id).limit(1))
    if existing_employee is not None:
        logger.warning("Skip employee bootstrap on startup: employees already exist")
        return
    logger.warning("Bootstrap employees on startup: workspace_id=%s workspace_name=%s", workspace.id, workspace.name)
    EmployeeService.sync_workspace_employees(db, workspace)


def create_app() -> FastAPI:

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_db()
        with get_session_local()() as db:
            workspace = WorkspaceService.ensure_default_workspace(db)
            # initialize_default_workspace_employees(db, workspace)
            # 获取员工
            # EmployeeService.sync_workspace_employees(db, workspace)
            # 从员工 metadata 同步任务
            TaskService.sync_workspace_tasks(db, workspace.id)
        # 启动调度器
        TaskSchedulerService.start()
        yield
        TaskSchedulerService.shutdown()
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
