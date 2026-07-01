from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from src.db.types import CstDateTime

from src.db.base import Base
from src.models.workspace import cst_now


class ConfigKv(Base):
    __tablename__ = "config_kvs"
    __table_args__ = (
        UniqueConstraint("config_key", name="uq_config_kvs_config_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    config_key: Mapped[str] = mapped_column(String(255), nullable=False)
    config_value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        CstDateTime,
        default=cst_now,
        onupdate=cst_now,
    )
