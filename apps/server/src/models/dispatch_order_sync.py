from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from src.db.types import CstDateTime

from src.db.base import Base
from src.models.workspace import cst_now


class DispatchOrderSync(Base):
    __tablename__ = "dispatch_orders_sync"
    __table_args__ = (
        UniqueConstraint(
            "remote_order_id",
            name="uq_dispatch_orders_sync_remote_order_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    remote_order_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    order_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    dispatcher: Mapped[str] = mapped_column(String(45), nullable=False, default="")
    receiver: Mapped[str] = mapped_column(String(45), nullable=False, default="")
    start_time: Mapped[datetime | None] = mapped_column(
        CstDateTime, nullable=True
    )
    end_time: Mapped[datetime | None] = mapped_column(
        CstDateTime, nullable=True
    )
    occur_time: Mapped[datetime | None] = mapped_column(
        CstDateTime, nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(45), nullable=False, default="")
    eval: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    comment: Mapped[str | None] = mapped_column(String(256), nullable=True, default=None)
    trigger_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending"
    )
    trigger_error: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    last_triggered_at: Mapped[datetime | None] = mapped_column(
        CstDateTime, nullable=True
    )
    last_synced_at: Mapped[datetime] = mapped_column(
        CstDateTime, nullable=False, default=cst_now, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        CstDateTime, nullable=False, default=cst_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        CstDateTime, nullable=False, default=cst_now, onupdate=cst_now
    )
