from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from src.core.config import get_settings

logger = logging.getLogger(__name__)


class SkillService:
    @staticmethod
    def _build_url(path: str) -> str:
        settings = get_settings()
        base_url = (settings.skill_remote_base_url or "").strip().rstrip("/")
        if not base_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置远程技能服务地址（REMOTE_API_BASE_URL）。",
            )
        return f"{base_url}{path}"

    @staticmethod
    def _request_remote(path: str, token: str) -> dict[str, Any]:
        settings = get_settings()
        # token = (settings.skill_remote_token or "").strip()
        # if not token:
        #     raise HTTPException(
        #         status_code=status.HTTP_400_BAD_REQUEST,
        #         detail="未配置远程技能服务令牌（SKILL_REMOTE_TOKEN）。",
        #     )

        url = SkillService._build_url(path)
        headers = {"token": f"{token}"}
        timeout = settings.skill_remote_timeout

        try:
            response = httpx.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException as exc:
            logger.error("远程技能服务超时: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"远程技能服务超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.error(
                "远程技能服务 HTTP 错误: %s", exc.response.status_code, exc_info=True
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能服务返回错误状态码：{exc.response.status_code}",
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            logger.error("远程技能服务请求失败: %s", exc, exc_info=True)
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
            logger.error("远程技能服务返回失败: %s", msg, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(msg),
            )
        return payload

    @staticmethod
    def list_remote_skills(token: str) -> list[dict[str, Any]]:
        settings = get_settings()
        payload = SkillService._request_remote(settings.skill_remote_list_path, token)
        data = payload.get("data")
        if not isinstance(data, list):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能列表数据格式错误。",
            )
        return [item for item in data if isinstance(item, dict)]

    @staticmethod
    def map_remote_to_list_item(raw: dict[str, Any]) -> dict[str, Any]:
        """将远程技能字典转为列表接口字段（camelCase，兼容 snake_case）。"""

        def first_present(*keys: str) -> Any:
            for k in keys:
                if k in raw:
                    return raw[k]
            return None

        if "id" not in raw:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能列表项缺少 id。",
            )

        skill_name = first_present("skillName", "skill_name")
        dir_id = first_present("directoryId", "directory_id")
        return {
            "id": int(raw["id"]),
            "skillName": "" if skill_name is None else str(skill_name),
            "displayNameZh": first_present("displayNameZh", "display_name_zh"),
            "description": first_present("description"),
            "directoryId": int(dir_id) if dir_id is not None else None,
            "directoryName": first_present("directoryName", "directory_name"),
        }

    @staticmethod
    def get_remote_skill(skill_id: int, token: str) -> dict[str, Any]:
        settings = get_settings()
        payload = SkillService._request_remote(
            settings.skill_remote_detail_path.format(skill_id=skill_id),
            token,
        )
        data = payload.get("data")
        if not isinstance(data, dict):
            logger.error("远程技能详情数据格式错误: %s", data, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能详情数据格式错误。",
            )
        return data
