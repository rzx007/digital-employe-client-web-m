from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.workspace import Workspace
from src.schemas.workspace import WorkspaceCreate, WorkspaceUpdate


class WorkspaceService:
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
