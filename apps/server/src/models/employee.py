from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.workspace import cst_now
from src.db.base import Base


class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = (UniqueConstraint("workspace_id", "employee_code", name="uq_workspace_employee_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_code: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 员工描述（来自员工参数 JSON 的“技能描述/description”等字段）
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    skills_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    meta_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    shift_schedule_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=cst_now,
        onupdate=cst_now,
    )

    workspace = relationship("Workspace", back_populates="employees")
    groups = relationship("ChatGroup", secondary="group_members", back_populates="members")
    shift_schedules = relationship(
        "EmployeeShiftSchedule",
        back_populates="employee",
        cascade="all, delete-orphan",
    )
    skills = relationship(
        "EmployeeSkill",
        back_populates="employee",
        cascade="all, delete-orphan",
    )


class EmployeeShiftSchedule(Base):
    """员工排班计划（SQLite / SQLAlchemy ORM）。嵌套创建时的 Pydantic 模型见 src.schemas.employee.ShiftScheduleCreateWithoutEmployee。"""

    __tablename__ = "employee_shift_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    start_date: Mapped[str] = mapped_column(String(32), nullable=False)
    end_date: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1-激活, 2-未激活, 3-取消
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=cst_now,
        onupdate=cst_now,
    )

    employee: Mapped[Employee] = relationship(back_populates="shift_schedules")


# 调度任务 ORM 见 src.models.employee_task.EmployeeTask；API 嵌套体见 src.schemas.employee.SchedulingTaskCreateWithoutEmployee。