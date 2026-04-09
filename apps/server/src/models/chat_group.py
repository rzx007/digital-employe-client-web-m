from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.workspace import cst_now
from src.db.base import Base


class ChatGroup(Base):
    __tablename__ = "chat_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=cst_now,
        onupdate=cst_now,
    )

    workspace = relationship("Workspace", back_populates="groups")
    members = relationship("Employee", secondary="group_members", back_populates="groups")

