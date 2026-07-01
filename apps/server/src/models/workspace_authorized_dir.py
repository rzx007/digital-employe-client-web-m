from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.core.cst import cst_now
from src.db.base import Base
from src.db.types import CstDateTime


class WorkspaceAuthorizedDir(Base):
    __tablename__ = "workspace_authorized_dir"
    __table_args__ = (UniqueConstraint("workspace_id", "path", name="uq_ws_auth_dir"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("workspaces.id"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        CstDateTime, default=cst_now, nullable=False
    )
