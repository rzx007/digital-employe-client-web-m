import logging

import httpx
from fastapi import APIRouter, HTTPException

from src.core.config import get_settings
from src.models.response import ResponseBase
from src.schemas.login import LoginRequest

router = APIRouter(tags=["登录"])
logger = logging.getLogger(__name__)


@router.post("/login", summary="登录", response_model=ResponseBase)
def login(request: LoginRequest):
    """登录接口：将登录参数转发到配置的 URL，并返回登录结果。"""
    login_params = request.model_dump()
    logger.info("登录请求 keys=%s", list(login_params.keys()))
    login_url = get_settings().login_url or ""
    try:
        response = httpx.post(login_url, json=login_params, timeout=30.0)
        response.raise_for_status()
        return ResponseBase(data=response.json())
    except httpx.HTTPError as exc:
        logger.error("登录转发 HTTP 失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"登录服务请求失败：{exc}") from exc
    except ValueError as exc:
        logger.error("登录响应解析失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"登录响应格式错误：{exc}") from exc
