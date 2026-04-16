from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from src.models.response import ResponseBase
from src.service.mcp_service import McpService

router = APIRouter(tags=["MCP"])


@router.get("/mcp/list", response_model=ResponseBase[list[dict[str, Any]]])
def list_mcp_servers(request: Request) -> ResponseBase[list[dict[str, Any]]]:
    token = request.headers.get("token")
    data = McpService.list_remote_mcps(token)
    return ResponseBase[list[dict[str, Any]]](data=data)


@router.get("/mcp/{mcp_id}", response_model=ResponseBase[dict[str, Any]])
def get_mcp_detail(mcp_id: int, request: Request) -> ResponseBase[dict[str, Any]]:
    token = request.headers.get("token")
    data = McpService.get_remote_mcp_detail(mcp_id, token)
    return ResponseBase[dict[str, Any]](data=data)
