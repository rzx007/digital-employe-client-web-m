import logging
from typing import Optional

import jwt
from fastapi import Request

logger = logging.getLogger(__name__)

# 离线/无 token 时的隐式单用户默认 id
DEFAULT_USER_ID = "1"


def get_user_id_from_token(token: str) -> str:
    """从token中提取用户ID"""
    try:
        # 解码token，不验证签名
        decoded = jwt.decode(token, options={"verify_signature": False})
        # 尝试从不同字段获取用户ID
        user_id = decoded.get("tid", "") or decoded.get("userId", "") or decoded.get("user_id", "") or decoded.get("id", "")
        return str(user_id)
    except Exception as e:
        logger.error("解析 token 失败: %s", e, exc_info=True)
        return ""


def get_user_id(request: Request) -> str:
    """从请求头获取用户ID，不存在则从token中提取，再不存在则报错"""
    # 先尝试从userid字段获取
    user_id = request.headers.get("userid")
    if user_id:
        return user_id
    
    # 再尝试从token中获取
    token = request.headers.get("token")
    if token:
        user_id = get_user_id_from_token(token)
        if user_id:
            return user_id

    return DEFAULT_USER_ID
    # 都获取不到则报错
    # raise HTTPException(status_code=401, detail="用户信息为空")


def get_username(request: Request) -> Optional[str]:
    """从请求头获取用户名"""
    return request.headers.get("username")


def get_dept_ids(request: Request) -> Optional[str]:
    """从请求头获取部门ID"""
    return request.headers.get("dptIds")


def get_workspace_id_from_request(request: Request) -> int:
    """
    从请求中解析 workspace_id（软隔离归属回落）。

    优先 request.state.workspace_id（中间件从 X-Workspace-Id 注入）：
    - 若该空间存在且归属当前用户 → 直接返回；
    - 否则（不存在/属他人）不报 403，回落到该用户的默认工作空间。
    无 header 时，仍按原逻辑解析用户默认工作空间。
    """
    from src.db.session import get_session_local
    from src.models.workspace import Workspace
    from src.service.workspace_service import WorkspaceService

    user_id = get_user_id(request)
    ws_id = getattr(request.state, "workspace_id", None)
    db = get_session_local()()
    try:
        if ws_id:
            ws = db.get(Workspace, int(ws_id))
            if ws is not None and ws.user_id == user_id:
                return int(ws_id)
            # X-Workspace-Id 不属当前用户/不存在 → 回落该用户默认空间（非 403，软隔离）
        workspace = WorkspaceService.get_or_create_user_workspace(
            db, user_id, get_username(request)
        )
        return workspace.id
    finally:
        db.close()
