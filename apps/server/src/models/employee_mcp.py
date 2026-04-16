from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class EmployeeMcp(Base):
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

    server_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    server_addr: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    server_describe: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    directory_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    directory_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tool_num: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    create_time: Mapped[str | None] = mapped_column(String(32), nullable=True)
    update_time: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_timeout: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recovery: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    aios_mcp_result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    mcp_sync_client_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    aios_mcp_authorize_dto_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    aios_mcp_info_server_list_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now, onupdate=cst_now
    )
