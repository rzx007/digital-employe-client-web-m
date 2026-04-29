from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class FeishuTask(Base):
    __tablename__ = "feishu_tasks"
    __table_args__ = (UniqueConstraint("task_id", name="uq_feishu_tasks_task_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    task_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    task_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    executor: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_schedule_created: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=cst_now,
        onupdate=cst_now,
    )
