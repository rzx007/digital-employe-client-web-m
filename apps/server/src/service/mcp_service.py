from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from src.core.config import get_settings

logger = logging.getLogger(__name__)


class McpService:
    @staticmethod
    def _build_url(path: str) -> str:
        settings = get_settings()
        base_url = (settings.skill_remote_base_url or "").strip().rstrip("/")
        if not base_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置远程服务地址（REMOTE_API_BASE_URL）。",
            )
        normalized = path if path.startswith("/") else f"/{path}"
        return f"{base_url}{normalized}"

    @staticmethod
    def _request_remote(path: str, token: str | None) -> dict[str, Any]:
        settings = get_settings()
        url = McpService._build_url(path)
        headers = {"token": token or ""}
        timeout = settings.skill_remote_timeout
        try:
            response = httpx.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException as exc:
            logger.error("远程 MCP 服务超时: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"远程 MCP 服务超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.error(
                "远程 MCP 服务 HTTP 错误: %s", exc.response.status_code, exc_info=True
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程 MCP 服务返回错误状态码：{exc.response.status_code}",
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            logger.error("远程 MCP 服务请求失败: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程 MCP 服务请求失败：{exc}",
            ) from exc

        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程 MCP 服务响应格式错误。",
            )
        code = payload.get("code")
        if code not in (1, 200):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(payload.get("msg") or "远程 MCP 服务返回失败。"),
            )
        return payload

    @staticmethod
    def list_remote_mcps(token: str | None) -> list[dict[str, Any]]:
        settings = get_settings()
        path = (settings.mcp_remote_list_url or "").strip()
        if not path:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置 MCP 列表地址（MCP_REMOTE_LIST_URL）。",
            )
        payload = McpService._request_remote(path, token)
        data = payload.get("data")
        if not isinstance(data, list):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程 MCP 列表数据格式错误。",
            )
        return [item for item in data if isinstance(item, dict)]

    @staticmethod
    def get_remote_mcp_detail(mcp_id: int, token: str | None) -> dict[str, Any]:
        settings = get_settings()
        path = (settings.mcp_remote_detail_url or "").strip()
        if not path:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置 MCP 详情地址（MCP_REMOTE_DETAIL_URL）。",
            )
        payload = McpService._request_remote(path.format(mcp_id=mcp_id), token)
        data = payload.get("data")
        if not isinstance(data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程 MCP 详情数据格式错误。",
            )
        return data
