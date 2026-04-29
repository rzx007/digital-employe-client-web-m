from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException, status

from src.core.config import get_settings
from src.service.feishu_token_service import FeishuTokenService

logger = logging.getLogger(__name__)


class FeishuBitableService:
    @staticmethod
    def search_records(
        page_size: int = 100,
        page_token: str | None = None,
        automatic_fields: bool = True,
    ) -> dict[str, Any]:
        settings = get_settings()
        app_token = (settings.feishu_bitable_app_token or "").strip()
        table_id = (settings.feishu_bitable_table_id or "").strip()
        view_id = (settings.feishu_bitable_view_id or "").strip()
        if not app_token or not table_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未配置 FEISHU_BITABLE_APP_TOKEN 或 FEISHU_BITABLE_TABLE_ID。",
            )

        if page_size <= 0:
            page_size = 100
        if page_size > 500:
            page_size = 500

        token = FeishuTokenService.get_tenant_access_token()
        url = (
            "https://open.feishu.cn/open-apis/bitable/v1/apps/"
            f"{app_token}/tables/{table_id}/records/search"
        )
        params: dict[str, Any] = {
            "page_size": page_size,
        }
        if page_token:
            params["page_token"] = page_token
        body: dict[str, Any] = {"automatic_fields": automatic_fields}
        if view_id:
            body["view_id"] = view_id

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        try:
            response = httpx.post(
                url,
                params=params,
                json=body,
                headers=headers,
                timeout=settings.feishu_token_request_timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException as exc:
            logger.error("飞书多维表格查询超时: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"飞书多维表格查询超时：{exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            resp = exc.response
            detail = f"飞书多维表格查询失败：{resp.status_code}"
            try:
                body = resp.json()
                if isinstance(body, dict):
                    feishu_code = body.get("code")
                    feishu_msg = body.get("msg")
                    log_id = (
                        body.get("error", {}).get("log_id")
                        if isinstance(body.get("error"), dict)
                        else None
                    ) or body.get("log_id")
                    detail = (
                        f"飞书多维表格查询失败：HTTP {resp.status_code}"
                        f", code={feishu_code}, msg={feishu_msg}, log_id={log_id}"
                    )
            except ValueError:
                if resp.text:
                    detail = (
                        f"飞书多维表格查询失败：HTTP {resp.status_code}, "
                        f"body={resp.text[:500]}"
                    )
            logger.error(
                "飞书多维表格查询状态码异常: %s",
                detail,
                exc_info=True,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=detail,
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            logger.error("飞书多维表格查询失败: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"飞书多维表格查询异常：{exc}",
            ) from exc

        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="飞书多维表格响应格式错误。",
            )

        code = payload.get("code")
        if code != 0:
            msg = payload.get("msg") or "飞书多维表格接口返回失败。"
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"飞书多维表格接口返回失败：{msg}",
            )

        data = payload.get("data")
        if not isinstance(data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="飞书多维表格 data 字段格式错误。",
            )
        return data

