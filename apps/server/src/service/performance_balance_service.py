from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings, join_base_and_path
from src.core.remote_gateway import RemoteGateway
from src.models.config_kv import ConfigKv

logger = logging.getLogger(__name__)


class PerformanceBalanceService:
    @staticmethod
    def _get_username_from_config(db: Session) -> str:
        upper_value = db.scalar(
            select(ConfigKv.config_value).where(ConfigKv.config_key == "USERNAME")
        )
        normalized = str(upper_value or "").strip()
        if normalized:
            return normalized

        lower_value = db.scalar(
            select(ConfigKv.config_value).where(ConfigKv.config_key == "username")
        )
        lower_normalized = str(lower_value or "").strip()
        if lower_normalized:
            return lower_normalized

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到配置 username，请先在 config_kvs 表配置 USERNAME 或 username。",
        )

    @staticmethod
    def get_username_from_config(db: Session) -> str:
        return PerformanceBalanceService._get_username_from_config(db)

    @staticmethod
    async def _request_remote_by_path(path: str | None, missing_path_message: str, db: Session) -> Any:
        settings = get_settings()
        username = PerformanceBalanceService._get_username_from_config(db)

        url = join_base_and_path(
            settings.remote_api_base_url,
            path,
        )
        if not url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=missing_path_message,
            )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await RemoteGateway.async_request("remote_performance", client, "GET", url, params={"name": username})
                response.raise_for_status()
                try:
                    return response.json()
                except ValueError:
                    payload_text = response.text
                    logger.warning(
                        "Monthly balance remote response is not JSON. url=%s text=%s",
                        url,
                        payload_text[:2000],
                    )
                    return payload_text
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"远程月结算接口请求超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程月结算接口返回错误状态码：{exc.response.status_code}",
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"远程绩效接口请求失败：{exc}",
            ) from exc

    @staticmethod
    async def get_remote_monthly_balance(db: Session) -> Any:
        settings = get_settings()
        return await PerformanceBalanceService._request_remote_by_path(
            settings.performance_monthly_balance_path,
            "未配置远程 API（REMOTE_API_BASE_URL）或月结算接口路径（PERFORMANCE_MONTHLY_BALANCE_PATH）。",
            db,
        )

    @staticmethod
    async def get_remote_dispatch_orders(db: Session) -> Any:
        settings = get_settings()
        return await PerformanceBalanceService._request_remote_by_path(
            settings.performance_dispatch_orders_path,
            "未配置远程 API（REMOTE_API_BASE_URL）或派单接口路径（PERFORMANCE_DISPATCH_ORDERS_PATH）。",
            db,
        )

