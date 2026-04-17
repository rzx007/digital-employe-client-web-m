from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base


class EmployeeMcp(Base):
    """员工与远程 MCP 能力绑定；字段与远程 MCP 详情一致，外加关联键。"""

    __tablename__ = "employee_mcps"
    __table_args__ = (UniqueConstraint("employee_id", "mcp_id", name="uq_employee_mcp"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mcp_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    mcp_server_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mcp_tool_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    capability_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    capability_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    api_created_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    api_updated_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
