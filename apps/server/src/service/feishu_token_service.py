from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import HTTPException, status

from src.core.config import get_settings
from src.core.remote_gateway import RemoteGateway

logger = logging.getLogger(__name__)


class FeishuTokenService:
    _lock = threading.Lock()
    _tenant_access_token: str | None = None
    _expires_at_utc: datetime | None = None

    @classmethod
    def get_tenant_access_token(cls) -> str:
        now = datetime.now(timezone.utc)
        if cls._should_use_cached_token(now):
            return str(cls._tenant_access_token)

        with cls._lock:
            now = datetime.now(timezone.utc)
            if cls._should_use_cached_token(now):
                return str(cls._tenant_access_token)
            cls._refresh_token(now)
            return str(cls._tenant_access_token)

    @classmethod
    def get_token_state(cls) -> dict[str, Any]:
        token = cls.get_tenant_access_token()
        now = datetime.now(timezone.utc)
        expires_at = cls._expires_at_utc
        expires_in = 0
        if expires_at is not None:
            expires_in = max(0, int((expires_at - now).total_seconds()))
        return {
            "tenant_access_token": token,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "expires_in_seconds": expires_in,
        }

    @classmethod
    def invalidate_cache(cls) -> None:
        with cls._lock:
            cls._tenant_access_token = None
            cls._expires_at_utc = None

    @classmethod
    def _should_use_cached_token(cls, now: datetime) -> bool:
        token = cls._tenant_access_token
        expires_at = cls._expires_at_utc
        if not token or expires_at is None:
            return False
        settings = get_settings()
        refresh_before = settings.feishu_token_refresh_before_seconds
        refresh_deadline = expires_at - timedelta(seconds=refresh_before)
        return now < refresh_deadline

    @classmethod
    def _refresh_token(cls, now: datetime) -> None:
        settings = get_settings()
        app_id = settings.feishu_app_id.strip()
        app_secret = settings.feishu_app_secret.strip()
        if not app_id or not app_secret:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET。",
            )

        payload = {"app_id": app_id, "app_secret": app_secret}
        try:
            response = RemoteGateway.sync_post(
                "feishu_platform",
                settings.feishu_tenant_access_token_url,
                json=payload,
                timeout=settings.feishu_token_request_timeout,
            )
            response.raise_for_status()
            body = response.json()
        except httpx.TimeoutException as exc:
            logger.error("获取飞书 tenant_access_token 超时: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"获取飞书 token 超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.error(
                "飞书 token 接口状态码异常: %s",
                exc.response.status_code,
                exc_info=True,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"飞书 token 接口返回错误状态码：{exc.response.status_code}",
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            logger.error("飞书 token 接口请求失败: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"获取飞书 token 失败：{exc}",
            ) from exc

        if not isinstance(body, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="飞书 token 接口响应格式错误。",
            )

        code = body.get("code")
        if code != 0:
            msg = body.get("msg") or "飞书 token 接口返回失败。"
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"飞书 token 接口返回失败：{msg}",
            )

        token = body.get("tenant_access_token")
        expire_seconds_raw = body.get("expire")
        if not isinstance(token, str) or not token.strip():
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="飞书 token 接口未返回 tenant_access_token。",
            )

        try:
            expire_seconds = int(expire_seconds_raw or 7200)
        except (TypeError, ValueError):
            expire_seconds = 7200
        if expire_seconds <= 0:
            expire_seconds = 7200

        cls._tenant_access_token = token.strip()
        cls._expires_at_utc = now + timedelta(seconds=expire_seconds)
        logger.info(
            "飞书 tenant_access_token 已刷新，将在 %s 过期",
            cls._expires_at_utc.isoformat(),
        )
