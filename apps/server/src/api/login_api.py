from fastapi import APIRouter
from src.models.response import ResponseBase
from src.schemas.login import LoginRequest
from src.core.config import get_settings
import httpx

router = APIRouter(tags=["登录"])

@router.post("/login", summary="登录", response_model=ResponseBase)
def login(request: LoginRequest):
    """ 登录接口，直接将登录参数转发到指定的URL，并且直接返回登录结果 """
    # 获取登录参数
    login_params = request.model_dump()
    # 从setting里面获取login_url
    login_url = get_settings().login_url or ""
    # 将登录参数转发到指定的URL
    response = httpx.post(login_url, json=login_params)
    # 直接返回登录结果
    return ResponseBase(data=response.json())