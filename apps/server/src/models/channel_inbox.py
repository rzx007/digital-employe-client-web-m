from datetime import datetime
from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from src.db.base import Base
from src.db.types import CstDateTime
from src.core.cst import cst_now


class ChannelInbox(Base):
    """渠道入站指令真相源：去重 / 关联那一轮 / 回执路由 / 状态机。"""
    __tablename__ = "channel_inbox"
    __table_args__ = (
        UniqueConstraint("channel", "external_event_id", name="uq_channel_event"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    external_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    external_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    external_chat_id: Mapped[str] = mapped_column(String(255), nullable=False)
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    conversation_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    user_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assistant_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    plan_run_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # received → acked → running → reported / failed / rejected
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="received", index=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    reported_at: Mapped[datetime | None] = mapped_column(CstDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now, onupdate=cst_now)
