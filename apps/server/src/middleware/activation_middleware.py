"""激活拦截中间件。

仅当 ``is_activation_enforced()`` 为真时挂载（见 server.py）。未激活 / 过期的请求
除白名单外一律 403。白名单集中维护，新增公开端点只改 ``ACTIVATION_ALLOWLIST``。
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.core.activation_gateway import ActivationGateway, ActivationRequiredError

logger = logging.getLogger(__name__)

# 前缀匹配；激活相关与运行时探测端点必须放行
ACTIVATION_ALLOWLIST: tuple[str, ...] = (
    "/system/runtime",
    "/activation/",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
)


def _is_allowed(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in ACTIVATION_ALLOWLIST)


class ActivationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.scope.get("path", "")
        if _is_allowed(path):
            return await call_next(request)
        try:
            ActivationGateway.ensure_activated()
        except ActivationRequiredError as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"code": exc.status_code, "msg": exc.detail, "data": None},
            )
        return await call_next(request)
