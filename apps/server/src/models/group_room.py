from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base
from src.models.workspace import cst_now


class GroupRoom(Base):
    """群协作房间（一次协作实例）。

    房间是叠在多个**独立成员私有会话**之上的"编排+投影"层：
    - room_conversation_id：群时间线（一条 target_type="group" 的会话），用户看到的共享日志；
    - chat_group_id：关联的群定义（ChatGroup，成员名单）；
    - plan_id：本次协作的编排计划（DAG），可空（纯 @ 协作时无计划）；
    - leader_conversation_id：组长（调度员）的私有会话，可空。

    成员的私有会话/线程/流/上下文保持独立（隔离=缓存友好=前沿最佳实践），
    房间不共享线程，仅通过组长/房间中介交接结论。
    """

    __tablename__ = "group_rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 群时间线会话（target_type="group"）：用户看到的共享日志/投影
    room_conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("orchestration_plans.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    leader_conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 发起拉群的总管会话：组长汇总完成后回流到这里（让总管把结果转告用户）
    origin_curator_conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # active | done | archived
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="active", index=True
    )
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now, onupdate=cst_now
    )

    members = relationship(
        "GroupRoomMember",
        back_populates="room",
        cascade="all, delete-orphan",
    )


class GroupRoomMember(Base):
    """房间成员：把员工的私有会话挂进房间，记录角色/状态/白名单。"""

    __tablename__ = "group_room_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("group_rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 成员的私有协作会话（target_type="employee"），隔离线程/上下文/缓存
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # leader | worker
    role_in_room: Mapped[str] = mapped_column(
        String(16), nullable=False, default="worker", index=True
    )
    # ready | running | sleeping | done
    state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="ready", index=True
    )
    # 白名单：允许 @ 该成员的来源（JSON 数组，如 ["user","leader"]）；null=不限
    allow_from: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now, onupdate=cst_now
    )

    room = relationship("GroupRoom", back_populates="members")
