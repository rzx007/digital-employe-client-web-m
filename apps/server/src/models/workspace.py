from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base


CST = timezone(timedelta(hours=8))


def cst_now() -> datetime:
    return datetime.now(CST)


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    root_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=cst_now,
        onupdate=cst_now,
    )

    employees = relationship("Employee", back_populates="workspace", cascade="all, delete-orphan")
    groups = relationship("ChatGroup", back_populates="workspace", cascade="all, delete-orphan")
    conversations = relationship("Conversation", cascade="all, delete-orphan")

