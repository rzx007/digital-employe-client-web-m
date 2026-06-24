from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from src.db.types import CstDateTime

from src.db.base import Base
from src.models.workspace import cst_now


class RecentContact(Base):
    __tablename__ = "recent_contacts"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "target_type",
            "target_id",
            name="uq_recent_contacts_workspace_target",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_accessed_at: Mapped[datetime] = mapped_column(
        CstDateTime,
        default=cst_now,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        CstDateTime,
        default=cst_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        CstDateTime,
        default=cst_now,
        onupdate=cst_now,
    )
