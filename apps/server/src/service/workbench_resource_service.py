from __future__ import annotations

from pathlib import PurePath

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.workbench_resource import WorkbenchResource


class WorkbenchResourceService:
    """资源池 CRUD。仅供用户路径调用——agent 无入池工具。"""

    @staticmethod
    def list_resources(db: Session, workspace_id: int) -> list[WorkbenchResource]:
        return list(
            db.scalars(
                select(WorkbenchResource)
                .where(WorkbenchResource.workspace_id == workspace_id)
                .order_by(WorkbenchResource.created_at.desc())
            ).all()
        )

    @staticmethod
    def add_artifact(
        db: Session,
        *,
        workspace_id: int,
        src_path: str,
        title: str | None,
        added_by: str | None,
    ) -> WorkbenchResource:
        row = WorkbenchResource(
            workspace_id=workspace_id,
            source="employee_artifact",
            src_path=src_path,
            title=(title or PurePath(src_path).name),
            added_by=added_by,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    @staticmethod
    def add_upload(
        db: Session,
        *,
        workspace_id: int,
        src_path: str,
        title: str | None,
        added_by: str | None,
    ) -> WorkbenchResource:
        row = WorkbenchResource(
            workspace_id=workspace_id,
            source="upload",
            src_path=src_path,
            title=(title or PurePath(src_path).name),
            added_by=added_by,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    @staticmethod
    def delete_resource(db: Session, workspace_id: int, resource_id: int) -> None:
        row = db.get(WorkbenchResource, resource_id)
        if row is None or row.workspace_id != workspace_id:
            raise HTTPException(status_code=404, detail="资源不存在")
        db.delete(row)
        db.commit()
