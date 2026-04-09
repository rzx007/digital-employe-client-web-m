from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

from src.core.config import get_settings


class SkillService:
    @staticmethod
    def _build_url(path: str) -> str:
        settings = get_settings()
        base_url = (settings.skill_remote_base_url or "").strip().rstrip("/")
        if not base_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置远程技能服务地址（SKILL_REMOTE_BASE_URL）。",
            )
        return f"{base_url}{path}"

    @staticmethod
    def _request_remote(path: str) -> dict[str, Any]:
        settings = get_settings()
        token = (settings.skill_remote_token or "").strip()
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置远程技能服务令牌（SKILL_REMOTE_TOKEN）。",
            )

        url = SkillService._build_url(path)
        headers = {"Authorization": f"Bearer {token}"}
        timeout = settings.skill_remote_timeout

        try:
            response = httpx.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"远程技能服务超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能服务返回错误状态码：{exc.response.status_code}",
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能服务请求失败：{exc}",
            ) from exc

        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能服务响应格式错误。",
            )
        if payload.get("code") != 1:
            msg = payload.get("msg") or "远程技能服务返回失败。"
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(msg),
            )
        return payload

    @staticmethod
    def list_remote_skills() -> list[dict[str, Any]]:
        payload = SkillService._request_remote("/aios/skill/page/list")
        data = payload.get("data")
        if not isinstance(data, list):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能列表数据格式错误。",
            )
        return [item for item in data if isinstance(item, dict)]

    @staticmethod
    def get_remote_skill(skill_id: int) -> dict[str, Any]:
        payload = SkillService._request_remote(f"/aios/skill/page/content/{skill_id}")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能详情数据格式错误。",
            )
        return data
