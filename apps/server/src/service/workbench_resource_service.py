from __future__ import annotations

from pathlib import Path, PurePath

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

    @staticmethod
    def read_html_content(
        db: Session, workspace_id: int, resource_id: int
    ) -> dict:
        """读取资源池条目的 HTML 内容（绝对路径 = workspace.root_path / src_path）。

        返回与 ResourceContent 同形的 dict：{path, content, artifact_type, language}。
        资源不存在 / 越界 / 文件缺失 → HTTPException 404。
        """
        from src.service.workspace_service import WorkspaceService

        row = db.get(WorkbenchResource, resource_id)
        if row is None or row.workspace_id != workspace_id:
            raise HTTPException(status_code=404, detail="资源不存在")

        ws = WorkspaceService.get_workspace(db, workspace_id)
        root = Path(ws.root_path).resolve()
        target = (root / row.src_path).resolve()
        # 防越界：解析后的路径必须仍在 root 内
        if not str(target).startswith(str(root)):
            raise HTTPException(status_code=404, detail="路径越界")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="文件不存在")

        try:
            content = target.read_text(encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail="读取失败") from exc

        return {
            "path": str(target),
            "content": content,
            "artifact_type": "html",
            "language": "html",
        }
