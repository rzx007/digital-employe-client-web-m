from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class PlanRun(Base):
    """一轮"执行某张编排计划"的实例。

    交互式 confirm / 定时到点 / （返工沿用所在 run）都对应一条 PlanRun。
    去重/依赖判断按 run_id 收敛，根治"全历史去重"导致定时重跑卡死。
    """

    __tablename__ = "plan_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("orchestration_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # manual（confirm）/ scheduled（cron 到点）；返工不新开 run，沿用所在 run。
    trigger: Mapped[str] = mapped_column(String(32), nullable=False, default="manual", index=True)
    # True → 下游免人工 QA 自动放行（无人值守定时轮）。
    auto_accept: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # running / settled
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running", index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=cst_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 该轮专属总管会话（scheduled 轮新建；manual 轮 = plan.conversation_id）。SET NULL 防级联。
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=cst_now)
