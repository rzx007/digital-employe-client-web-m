from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class McpListItem(BaseModel):
    """MCP 列表项 / 员工快照中的 MCP 条目（与远程 export 字段一致）。"""

    model_config = ConfigDict(extra="ignore")

    id: int
    mcp_server_name: str | None = None
    mcp_tool_name: str | None = None
    capability_name: str | None = None
    capability_desc: str | None = None
    creator_id: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class McpDetailRead(McpListItem):
    """MCP 详情（与列表单项字段一致）。"""

    pass
