from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from src.db.types import CstDateTime

from src.db.base import Base
from src.models.workspace import cst_now


class EmployeeSkill(Base):
    __tablename__ = "employee_skills"
    __table_args__ = (UniqueConstraint("employee_id", "skill_id", name="uq_employee_skill"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    skill_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    skill_name: Mapped[str] = mapped_column(String(255), nullable=False)
    skill_name_zh: Mapped[str | None] = mapped_column(String(255), nullable=True)
    skill_description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # 来自远程技能详情（get_remote_skill）的 prompt、skillContent
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    skill_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now, onupdate=cst_now)

    employee = relationship("Employee", back_populates="skills")
