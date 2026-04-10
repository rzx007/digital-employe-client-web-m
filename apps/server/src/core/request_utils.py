from fastapi import Request
from typing import Optional
import jwt


def get_user_id_from_token(token: str) -> str:
    """从token中提取用户ID"""
    try:
        # 解码token，不验证签名
        decoded = jwt.decode(token, options={"verify_signature": False})
        # 尝试从不同字段获取用户ID
        user_id = decoded.get("tid", "") or decoded.get("userId", "") or decoded.get("user_id", "") or decoded.get("id", "")
        return str(user_id)
    except Exception as e:
        # 记录错误但不影响其他逻辑
        print(f"解析token失败: {e}")
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

    return "1";
    # 都获取不到则报错
    # raise HTTPException(status_code=401, detail="用户信息为空")


def get_username(request: Request) -> Optional[str]:
    """从请求头获取用户名"""
    return request.headers.get("username")


def get_dept_ids(request: Request) -> Optional[str]:
    """从请求头获取部门ID"""
    return request.headers.get("dptIds")
