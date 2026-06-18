from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base
from src.models.workspace import cst_now


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")
    session_flags: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    workspace = relationship("Workspace", back_populates="conversations")
    messages = relationship("ConversationMessage", back_populates="conversation", cascade="all, delete-orphan")


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_meta: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    stream_state: Mapped[str | None] = mapped_column(String(32), nullable=True)     # 取值: "streaming" | "completed" | "error" | NULL（旧消息无此字段
    stream_cursor: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)     # 已发送的最后一个事件序列号
    message_parts: Mapped[str | None] = mapped_column(Text, nullable=True)     # 预计算的结构化 parts（JSON），前端直接渲染
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, index=True)

    conversation = relationship("Conversation", back_populates="messages")
