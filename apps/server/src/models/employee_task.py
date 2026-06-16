from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class EmployeeTask(Base):
    __tablename__ = "employee_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    dispatch_type: Mapped[str] = mapped_column(String(32), nullable=False, default="skill", index=True)
    skill_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    capability_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    task_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cron_expression: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cron_expression_type: Mapped[str] = mapped_column(String(32), nullable=False, default="custom")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    confirm_execution_result: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )
    user_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_input_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    execute_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="scheduled")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    orchestration_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("orchestration_plans.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    rework_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)

    def __init__(self, **kwargs: object) -> None:
        # SQLAlchemy 2.x mapped_column(default=) 仅在 INSERT 时生效；
        # 此处显式补默认，使瞬态（未 flush）实例读到 0 而非 None。
        kwargs.setdefault("rework_count", 0)
        super().__init__(**kwargs)

