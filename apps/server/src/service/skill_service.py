from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from src.core.config import get_settings, join_base_and_path
from src.core.remote_gateway import RemoteGateway
from src.utils.http_client import (
    create_agent_interface_http_client,
    create_agent_interface_upload_http_client,
)

logger = logging.getLogger(__name__)


class SkillService:
    @staticmethod
    def _build_url(path: str) -> str:
        settings = get_settings()
        merged = join_base_and_path(settings.skill_remote_base_url, path)
        if not merged:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置远程技能服务地址（REMOTE_API_BASE_URL）。",
            )
        return merged

    @staticmethod
    def _ensure_success_payload(payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能服务响应格式错误。",
            )
        code = payload.get("code")
        if code not in (1, 200, "1", "200", None):
            msg = payload.get("msg") or "远程技能服务返回失败。"
            logger.error("远程技能服务返回失败: %s", msg)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(msg),
            )
        return payload

    @staticmethod
    def _request_remote(path: str, token: str) -> dict[str, Any]:
        try:
            settings = get_settings()
            url = SkillService._build_url(path)
            headers = {"token": f"{token}"}
            timeout = settings.skill_remote_timeout

            response = RemoteGateway.sync_get("remote_skills", url, headers=headers, timeout=timeout)
            response.raise_for_status()
            payload = SkillService._ensure_success_payload(response.json())
        except httpx.TimeoutException as exc:
            logger.error("远程技能服务超时: %s", exc, exc_info=True)
            return {}
        except httpx.HTTPStatusError as exc:
            logger.error(
                "远程技能服务 HTTP 错误: %s", exc.response.status_code, exc_info=True
            )
            return {}
        except (httpx.HTTPError, ValueError, HTTPException) as exc:
            logger.error("远程技能服务请求失败: %s", exc, exc_info=True)
            return {}
        except Exception as exc:
            logger.error("远程技能服务请求异常: %s", exc, exc_info=True)
            return {}

        return payload

    @staticmethod
    def list_remote_skills(token: str) -> list[dict[str, Any]]:
        settings = get_settings()
        payload = SkillService._request_remote(settings.skill_remote_list_path, token)
        data = payload.get("data")
        if not isinstance(data, list):
            logger.error("远程技能列表数据格式错误: %s", data)
            return []
        return [item for item in data if isinstance(item, dict)]

    @staticmethod
    def _extract_skill_tags(raw: dict[str, Any]) -> list[str]:
        def normalize_list(value: Any) -> list[str]:
            if not isinstance(value, list):
                return []
            out: list[str] = []
            for item in value:
                if item is None:
                    continue
                if isinstance(item, str) and item.strip():
                    out.append(item.strip())
                elif isinstance(item, dict):
                    name = item.get("name") or item.get("tagName") or item.get("label")
                    if isinstance(name, str) and name.strip():
                        out.append(name.strip())
            return out

        for key in ("tags", "tagList", "skillTags", "labelList"):
            tags = normalize_list(raw.get(key))
            if tags:
                return tags
        names = raw.get("tagNames")
        if isinstance(names, str) and names.strip():
            parts = [p.strip() for p in names.replace("，", ",").split(",") if p.strip()]
            if parts:
                return parts
        cat = raw.get("category") or raw.get("categories")
        if isinstance(cat, str) and cat.strip():
            return [cat.strip()]
        if isinstance(cat, list):
            return normalize_list(cat)
        return []

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
            "tags": SkillService._extract_skill_tags(raw),
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

    @staticmethod
    async def get_remote_directories(flat: bool, token: str | None) -> Any:
        settings = get_settings()
        url = SkillService._build_url(settings.skill_dir_path)
        headers = {"token": token or ""}
        params = {"flat": "true" if flat else "false"}
        try:
            async with create_agent_interface_http_client() as client:
                response = await RemoteGateway.async_request("remote_skills", client, "GET", url, headers=headers, params=params)
                response.raise_for_status()
                payload = SkillService._ensure_success_payload(response.json())
                return payload.get("data")
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"远程技能目录请求超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能目录请求失败：{exc.response.status_code}",
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能目录请求异常：{exc}",
            ) from exc

    @staticmethod
    async def remote_skill_name_exists(skill_name: str, token: str | None) -> bool:
        settings = get_settings()
        url = SkillService._build_url(settings.skill_name_validate_path)
        headers = {"token": token or ""}
        payload = {"skillName": skill_name}
        try:
            async with create_agent_interface_http_client() as client:
                response = await RemoteGateway.async_request("remote_skills", client, "POST", url, headers=headers, json=payload)
                response.raise_for_status()
                data = SkillService._ensure_success_payload(response.json()).get("data")
                if not isinstance(data, dict):
                    return False
                exists = data.get("exists")
                if isinstance(exists, bool):
                    return exists
                name = data.get("skillName") or data.get("skill_name")
                return bool(name)
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"远程技能重名校验超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能重名校验失败：{exc.response.status_code}",
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能重名校验异常：{exc}",
            ) from exc

    @staticmethod
    async def remote_import_skill(
        file_name: str,
        file_bytes: bytes,
        directory_id: int,
        display_name_zh: str | None,
        uploaded_by_user_id: str | None,
        token: str | None,
    ) -> dict[str, Any]:
        settings = get_settings()
        url = SkillService._build_url(settings.skill_remote_import_path)
        headers = {"token": token or ""}
        form_data = {
            "directoryId": str(directory_id),
            "uploadedByUserId": str(uploaded_by_user_id or "1"),
        }
        if display_name_zh:
            form_data["displayNameZh"] = display_name_zh
        files = {
            "file": (file_name, file_bytes, "application/zip"),
        }
        try:
            async with create_agent_interface_upload_http_client() as client:
                response = await RemoteGateway.async_request(
                    "remote_skills",
                    client,
                    "POST",
                    url,
                    headers=headers,
                    data=form_data,
                    files=files,
                )
                response.raise_for_status()
                payload = SkillService._ensure_success_payload(response.json())
                return {
                    "code": payload.get("code", 1),
                    "msg": payload.get("msg", "操作成功"),
                    "data": payload.get("data"),
                }
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"远程技能导入超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能导入失败：{exc.response.status_code}",
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程技能导入异常：{exc}",
            ) from exc
