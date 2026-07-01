from __future__ import annotations

from sqlalchemy.orm import Session

from src.models.workspace_authorized_dir import WorkspaceAuthorizedDir


def grant_dir(db: Session, workspace_id: int, path: str) -> None:
    exists = db.query(WorkspaceAuthorizedDir).filter_by(
        workspace_id=workspace_id, path=path
    ).first()
    if exists:
        return
    db.add(WorkspaceAuthorizedDir(workspace_id=workspace_id, path=path))
    db.commit()


def revoke_dir(db: Session, workspace_id: int, path: str) -> None:
    db.query(WorkspaceAuthorizedDir).filter_by(
        workspace_id=workspace_id, path=path
    ).delete()
    db.commit()


def list_authorized_dirs(db: Session, workspace_id: int) -> list[str]:
    rows = db.query(WorkspaceAuthorizedDir).filter_by(workspace_id=workspace_id).all()
    return [r.path for r in rows]
