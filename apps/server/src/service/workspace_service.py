from __future__ import annotations

import logging
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.workspace import Workspace
from src.schemas.workspace import WorkspaceCreate, WorkspaceUpdate

logger = logging.getLogger(__name__)


class WorkspaceService:
    @staticmethod
    def ensure_workspace_initialized(db: Session, workspace: Workspace) -> None:
        """
        确保 workspace 拥有默认的 seed 员工、总管和任务。
        幂等：已初始化过的 workspace 跳过（已有总管员工即为已初始化）。
        """
        from src.models.employee import Employee
        from src.service.employee_service import EmployeeService
        from src.service.task_service import TaskService

        existing_curator = db.scalar(
            select(Employee).where(
                Employee.workspace_id == workspace.id,
                Employee.is_curator.is_(True),
            )
        )
        if existing_curator:
            # 兼容增量发布：即使 workspace 已初始化，也要幂等补齐新增内置员工
            # （例如后续新增的“环境管家”种子员工）。
            EmployeeService.ensure_builtin_seed_employees(db, workspace)
            return

        EmployeeService.ensure_builtin_seed_employees(db, workspace)
        EmployeeService.ensure_curator_employee(db, workspace.id)
        TaskService.sync_workspace_tasks(db, workspace.id)
        logger.info(
            "Workspace initialized: id=%s name=%s",
            workspace.id,
            workspace.name,
        )

    @staticmethod
    def _resolve_default_root() -> Path:
        settings = get_settings()
        configured = settings.default_workspace_root
        if configured:
            configured_path = Path(configured)
            if configured_path.exists():
                return configured_path

        install_anchor = Path(__file__).resolve().anchor
        if install_anchor:
            return Path(install_anchor)

        return Path(Path.cwd().anchor or str(Path.cwd()))

    @staticmethod
    def get_or_create_user_workspace(db: Session, user_id: str, username: str | None = None) -> Workspace:
        """
        根据用户ID获取或创建专属工作空间。

        1. 如果已存在该用户的 workspace，直接返回
        2. 如果不存在：
           - 检查 workspace_id=1 是否未被认领（user_id IS NULL）
           - 是则认领该 workspace（将存量数据迁移给该用户）
           - 否则创建新 workspace，命名为 "<username>的工作空间" 或 "用户工作空间"
        """
        existing_workspace = db.execute(
            select(Workspace).where(Workspace.user_id == user_id)
        ).scalar_one_or_none()
        if existing_workspace:
            WorkspaceService.ensure_workspace_initialized(db, existing_workspace)
            return existing_workspace

        # 尝试认领 workspace_id=1（如果还未被认领）
        default_workspace_id = get_settings().default_workspace_id
        default_workspace = db.get(Workspace, default_workspace_id)
        if default_workspace and default_workspace.user_id is None:
            default_workspace.user_id = user_id
            default_workspace.name = username + "的工作空间" if username else "用户工作空间"
            db.commit()
            db.refresh(default_workspace)
            WorkspaceService.ensure_workspace_initialized(db, default_workspace)
            return default_workspace

        # 创建新的用户专属 workspace
        workspace_name = username + "的工作空间" if username else "用户工作空间"
        workspace_root = WorkspaceService._resolve_default_root()
        workspace = Workspace(
            name=workspace_name,
            root_path=str(workspace_root),
            user_id=user_id,
        )
        db.add(workspace)
        db.commit()
        db.refresh(workspace)
        WorkspaceService.ensure_workspace_initialized(db, workspace)
        return workspace

    @staticmethod
    def ensure_default_workspace(db: Session) -> Workspace:
        settings = get_settings()
        default_workspace_id = settings.default_workspace_id
        default_workspace_name = settings.default_workspace_name or "默认的工作空间"
        workspace = db.get(Workspace, default_workspace_id)
        if workspace:
            return workspace

        default_root = WorkspaceService._resolve_default_root()
        workspace = Workspace(
            id=default_workspace_id,
            name=default_workspace_name,
            root_path=str(default_root),
        )
        db.add(workspace)
        db.commit()
        db.refresh(workspace)
        return workspace

    @staticmethod
    def create_workspace(workspace_create: WorkspaceCreate, db: Session) -> Workspace:
        """创建工作空间，缺省参数时自动使用默认名称和默认根目录。"""
        settings = get_settings()
        default_workspace_name = settings.default_workspace_name or "默认的工作空间"
        # 这里需要做一下判断，如果传递过来的name和root_path都为空，则创建一个默认的工作空间
        if workspace_create.name is None and workspace_create.root_path is None:
            return WorkspaceService.ensure_default_workspace(db)
        if workspace_create.name is None:
            workspace_create.name = default_workspace_name
        if workspace_create.root_path is None:
            workspace_create.root_path = WorkspaceService._resolve_default_root()
        workspace = Workspace(name=workspace_create.name, root_path=str(workspace_create.root_path))
        db.add(workspace)
        db.commit()
        db.refresh(workspace)
        return workspace

    @staticmethod
    def list_workspaces(db: Session) -> list[Workspace]:
        return list[Workspace](db.scalars(select(Workspace).order_by(Workspace.id.desc())).all())

    @staticmethod
    def get_workspace(db: Session, workspace_id: int) -> Workspace:
        workspace = db.get(Workspace, workspace_id)
        if not workspace:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。")
        return workspace

    @staticmethod
    def update_workspace(db: Session, workspace_id: int, payload: WorkspaceUpdate) -> Workspace:
        workspace = WorkspaceService.get_workspace(db, workspace_id)
        if payload.name is not None:
            workspace.name = payload.name
        if payload.root_path is not None:
            root = Path(payload.root_path)
            if not root.exists():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="工作空间路径不存在。")
            workspace.root_path = str(root)
        db.commit()
        db.refresh(workspace)
        return workspace

    @staticmethod
    def delete_workspace(db: Session, workspace_id: int) -> None:
        workspace = WorkspaceService.get_workspace(db, workspace_id)
        db.delete(workspace)
        db.commit()
