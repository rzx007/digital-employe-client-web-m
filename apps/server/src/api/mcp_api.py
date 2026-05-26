from __future__ import annotations

from fastapi import APIRouter, Request, Depends

from src.core.deps import require_capability
from src.models.response import ResponseBase
from src.schemas.mcp import McpDetailRead, McpListItem
from src.service.mcp_service import McpService

router = APIRouter(tags=["MCP"], dependencies=[Depends(require_capability("remote_mcp"))])


@router.get("/mcp/list", response_model=ResponseBase[list[McpListItem]])
def list_mcp_servers(request: Request) -> ResponseBase[list[McpListItem]]:
    token = request.headers.get("token")
    raw = McpService.list_remote_mcps(token)
    data = [McpListItem.model_validate(item) for item in raw]
    return ResponseBase[list[McpListItem]](data=data)


@router.get("/mcp/{mcp_id}", response_model=ResponseBase[McpDetailRead])
def get_mcp_detail(mcp_id: int, request: Request) -> ResponseBase[McpDetailRead]:
    token = request.headers.get("token")
    raw = McpService.get_remote_mcp_detail(mcp_id, token)
    payload = McpDetailRead.model_validate(raw)
    return ResponseBase[McpDetailRead](data=payload)
