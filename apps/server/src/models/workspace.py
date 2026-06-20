from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
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
    auto_grant_external_dirs: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # 员工/会话已挂 user_id，不随 workspace 删除而消失。
    # passive_deletes=True：避免 ORM 对 NOT NULL 的 workspace_id 发 null-out UPDATE；
    # DB 级 ON DELETE CASCADE 运行时不触发（PRAGMA foreign_keys 默认 OFF）。
    employees = relationship("Employee", back_populates="workspace", passive_deletes=True)
    conversations = relationship("Conversation", passive_deletes=True)

