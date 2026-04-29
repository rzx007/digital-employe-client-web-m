from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class PerformanceRecord(Base):
    __tablename__ = "performance_records"
    __table_args__ = (
        UniqueConstraint(
            "assessment_period",
            "username",
            name="uq_performance_records_period_username",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    assessment_period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    work_no: Mapped[str] = mapped_column(String(128), nullable=True, index=True)
    department: Mapped[str] = mapped_column(String(255), nullable=True, default="")
    position_title: Mapped[str] = mapped_column(String(255), nullable=True, default="")
    monthly_ac_total: Mapped[float] = mapped_column(Float, nullable=True, default=0.0)
    monthly_ev_total: Mapped[float] = mapped_column(Float, nullable=True, default=0.0)
    monthly_work_deviation: Mapped[float] = mapped_column(Float, nullable=True, default=0.0)
    ac_actual_base_value: Mapped[float] = mapped_column(Float, nullable=True, default=0.0)
    workday_base_deviation: Mapped[float] = mapped_column(Float, nullable=True, default=0.0)
    assessment_department: Mapped[str] = mapped_column(
        String(255), nullable=True, default=""
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=cst_now,
        onupdate=cst_now,
    )
