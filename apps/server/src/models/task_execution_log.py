from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from src.db.types import CstDateTime

from src.db.base import Base
from src.models.workspace import cst_now


class TaskExecutionLog(Base):
    __tablename__ = "task_execution_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("employee_tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    orchestrator_conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    run_status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    run_result: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    output_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    started_at: Mapped[datetime] = mapped_column(CstDateTime, nullable=False, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(CstDateTime, nullable=True, index=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(CstDateTime, nullable=True)
    # 已纳入某次总管增量汇报 turn 的时间；NULL = 待汇报
    reported_at: Mapped[datetime | None] = mapped_column(CstDateTime, nullable=True)
    # 所属执行轮（PlanRun.id）；编排日志一律写值，非编排（独立 run_task_job）日志为 NULL。
    run_id: Mapped[int | None] = mapped_column(
        ForeignKey("plan_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 总管 QA 审核通过时间；NULL = 尚未接受（下游派发闸门）
    qa_accepted_at: Mapped[datetime | None] = mapped_column(CstDateTime, nullable=True)
    confirm_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    # 执行结果是否已由用户确认（默认未确认）
    result_confirmed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )
    # 日志是否已读（默认未读）
    is_read: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now, index=True)

