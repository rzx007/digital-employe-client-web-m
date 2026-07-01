"""FastAPI 签发服务：POST /license/issue。内置私钥，Bearer token 鉴权。"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from license_issuer.service import IssueService

from license_issuer_server.config import (
    get_api_token,
    get_default_expires,
    get_private_key_path,
)

logger = logging.getLogger(__name__)


class IssueRequest(BaseModel):
    device_code: str
    expires: str | None = None


def _check_auth(authorization: str | None) -> None:
    expected = get_api_token()
    if not expected:
        raise HTTPException(status_code=401, detail="服务未配置 ISSUER_API_TOKEN")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少 Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="token 无效")


def create_app() -> FastAPI:
    app = FastAPI(title="Digital Employee 飞书签发服务")

    @app.post("/license/issue")
    def issue(
        payload: IssueRequest,
        authorization: str | None = Header(default=None),
    ) -> dict:
        _check_auth(authorization)
        expires = payload.expires or get_default_expires()
        priv = get_private_key_path()
        if not priv.exists():
            logger.error("私钥不存在: %s", priv)
            raise HTTPException(status_code=500, detail="签发私钥未配置")
        try:
            result = IssueService().issue(payload.device_code, expires, priv)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"参数非法: {exc}") from exc
        return {
            "code": 200,
            "msg": "操作成功",
            "data": {
                "license_code": result.license_code,
                "device_code_display": result.device_code_display,
                "expires_at": result.expires_at.isoformat().replace("+00:00", "Z"),
            },
        }

    return app


app = create_app()
