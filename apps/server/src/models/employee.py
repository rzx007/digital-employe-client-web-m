from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
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
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    skills_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    meta_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    shift_schedule_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    is_curator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    # 自定义头像文件的本地存储路径；为空时前端回落到「名字前两个字」文本头像。
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=cst_now,
        onupdate=cst_now,
    )

    workspace = relationship("Workspace", back_populates="employees")
    groups = relationship("ChatGroup", secondary="group_members", back_populates="members")
    skills = relationship(
        "EmployeeSkill",
        back_populates="employee",
        cascade="all, delete-orphan",
    )