from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class WorkbenchResource(Base):
    """工作台资源池条目：用户精选的 HTML 看板。

    仅用户主动入池/上传（agent 无入池工具）。
    - source="employee_artifact"：引用已有员工产物，不复制，src_path 指向产物。
    - source="upload"：外部上传，文件复制到 <root>/workbench-uploads/<uuid>/<name>，src_path 指向之。
    """

    __tablename__ = "workbench_resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="upload")
    # 相对 workspace.root_path 的 HTML 路径
    src_path: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    added_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now
    )
