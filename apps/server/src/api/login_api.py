import logging
from typing import Any

import httpx
from fastapi import APIRouter, Body, HTTPException, Request

from src.core.config import get_settings
from src.schemas.login import LoginRequest, UpdatePasswordRequest

router = APIRouter(tags=["登录"])
logger = logging.getLogger(__name__)


def _forward_token_headers(request: Request) -> dict[str, str]:
    token = (request.headers.get("token") or "").strip()
    if not token:
        return {}
    return {"token": token}


@router.post("/login", summary="登录", response_model=dict[str, Any])
def login(request: LoginRequest):
    """登录接口：将登录参数转发到配置的 URL，并返回登录结果。"""
    login_params = request.model_dump()
    logger.info("登录请求 keys=%s", list(login_params.keys()))
    login_url = get_settings().login_url or ""
    logger.info("login_url=%s", login_url)
    if not login_url:
        logger.error("未配置登录服务地址。")
        raise HTTPException(status_code=400, detail="未配置登录服务地址。")
    try:
        response = httpx.post(login_url, json=login_params, timeout=30.0)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.error("登录转发 HTTP 失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"登录服务请求失败：{exc}") from exc
    except ValueError as exc:
        logger.error("登录响应解析失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"登录响应格式错误：{exc}") from exc


@router.post("/yc/login", summary="登录（/yc 路径，与 /login 相同）", response_model=dict[str, Any])
def login_yc_path(request: LoginRequest) -> dict[str, Any]:
    """兼容前端 POST /yc/login，转发逻辑与 POST /login 一致。"""
    return login(request)


@router.post("/update-password", summary="更新用户密码", response_model=dict[str, Any])
def update_password(request: UpdatePasswordRequest):
    """更新用户密码接口：将更新密码参数转发到配置的 URL，并返回更新密码结果。"""
    update_password_params = request.model_dump()
    logger.info("更新密码请求 keys=%s", list(update_password_params.keys()))
    update_password_url = get_settings().update_user_password_url or ""
    logger.info("update_password_url=%s", update_password_url)
    if not update_password_url:
        logger.error("未配置更新密码服务地址。")
        raise HTTPException(status_code=400, detail="未配置更新密码服务地址。")
    try:
        response = httpx.post(update_password_url, json=update_password_params, timeout=30.0)
        response.raise_for_status()
        data = response.json()
        return response.json()
    except httpx.HTTPError as exc:
        logger.error("更新密码转发 HTTP 失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"更新密码服务请求失败：{exc}") from exc
    except ValueError as exc:
        logger.error("更新密码响应解析失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"更新密码响应格式错误：{exc}") from exc


@router.post("/yc/register", summary="用户注册（转发）", response_model=dict[str, Any])
def register_proxy(request: Request, body: dict[str, Any] = Body(...)):
    """将注册请求转发到 REMOTE_API_BASE_URL + REGISTER_PATH。"""
    register_url = (get_settings().register_url or "").strip()
    logger.info("注册转发 keys=%s", list(body.keys()))
    if not register_url:
        logger.error("未配置注册服务地址。")
        raise HTTPException(status_code=400, detail="未配置注册服务地址。")
    headers = _forward_token_headers(request)
    try:
        response = httpx.post(
            register_url,
            json=body,
            headers=headers or None,
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.error("注册转发 HTTP 失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"注册服务请求失败：{exc}") from exc
    except ValueError as exc:
        logger.error("注册响应解析失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"注册响应格式错误：{exc}") from exc


@router.get("/yc/getDeptTree", summary="部门树（转发）", response_model=dict[str, Any])
def get_dept_tree_proxy(request: Request):
    """将部门树请求转发到 REMOTE_API_BASE_URL + GET_DEPT_TREE_PATH。"""
    tree_url = (get_settings().get_dept_tree_url or "").strip()
    if not tree_url:
        logger.error("未配置部门树服务地址。")
        raise HTTPException(status_code=400, detail="未配置部门树服务地址。")
    params = list(request.query_params.multi_items())
    headers = _forward_token_headers(request)
    try:
        response = httpx.get(
            tree_url,
            params=params or None,
            headers=headers or None,
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.error("部门树转发 HTTP 失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"部门树服务请求失败：{exc}"
        ) from exc
    except ValueError as exc:
        logger.error("部门树响应解析失败: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"部门树响应格式错误：{exc}"
        ) from exc