from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class OrchestrationPlan(Base):
    __tablename__ = "orchestration_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversation_messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_input: Mapped[str] = mapped_column(Text, nullable=False)
    plan_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending", index=True
    )
    total_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 计划级节拍（标准 5 段 cron）；非空=递归计划，冻结模板的一部分。
    cron: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # SQLite 不支持 DROP COLUMN，此列保留以兼容历史表结构。
    # 业务逻辑不使用此字段，进度由 _compute_plan_progress 实时从 TaskExecutionLog 聚合。
    completed_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now, onupdate=cst_now
    )
