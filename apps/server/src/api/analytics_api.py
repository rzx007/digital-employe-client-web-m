import logging
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from src.core.config import get_settings
from src.core.deps import require_capability

router = APIRouter(tags=["活跃度埋点"])
logger = logging.getLogger(__name__)


def _forward_token_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    token = (request.headers.get("token") or "").strip()
    if token:
        headers["token"] = token
    userid = (request.headers.get("userid") or "").strip()
    if userid:
        headers["userid"] = userid
    return headers


@router.post(
    "/digital/api/v1/analytics/events",
    summary="客户端活跃度事件上报（转发到远端 actus）",
    response_model=dict[str, Any],
    dependencies=[Depends(require_capability("remote_analytics"))],
)
def report_analytics_events(request: Request, body: dict[str, Any] = Body(...)):
    """将客户端埋点事件转发到 REMOTE_API_BASE_URL + ANALYTICS_EVENTS_PATH。

    与 login/feedback 等转发一致：本地不落库，仅透传 token/userid 到远端 actus。
    """
    events_url = (get_settings().analytics_events_url or "").strip()
    if not events_url:
        logger.error("未配置活跃度上报服务地址。")
        raise HTTPException(status_code=400, detail="未配置活跃度上报服务地址。")
    headers = _forward_token_headers(request)
    try:
        response = httpx.post(
            events_url,
            json=body,
            headers=headers or None,
            timeout=15.0,
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.error("活跃度上报转发 HTTP 失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"活跃度上报服务请求失败：{exc}"
        ) from exc
    except ValueError as exc:
        logger.error("活跃度上报响应解析失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"活跃度上报响应格式错误：{exc}"
        ) from exc
