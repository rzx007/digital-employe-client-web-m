"""激活防腐层：单点 enforcement。

类比 ``RemoteGateway``：业务 / 中间件只调 ``ensure_activated()``，不直接读
activation.json 或 policy。未强制激活时为 no-op。
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, status

from src.service.activation_service import ActivationService

logger = logging.getLogger(__name__)


class ActivationRequiredError(HTTPException):
    def __init__(self, reason: str | None = None):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"应用未激活或授权已过期: {reason or 'not_activated'}",
        )


class ActivationGateway:
    @staticmethod
    def ensure_activated() -> None:
        result = ActivationService.get_status()
        if not result.enforced:
            return
        if not result.activated:
            logger.info("ActivationGateway 拦截：reason=%s", result.reason)
            raise ActivationRequiredError(result.reason)
