import logging
from typing import Any
import httpx
from fastapi import HTTPException, status
from src.core.runtime_capabilities import get_capabilities

logger = logging.getLogger(__name__)

class OfflineUnavailableError(HTTPException):
    def __init__(self, capability: str):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"离线模式不可用: {capability}"
        )

class RemoteGateway:
    @staticmethod
    def ensure(capability: str) -> None:
        caps = get_capabilities()
        if not getattr(caps, capability, False):
            logger.info("RemoteGateway blocked request due to offline mode: %s", capability)
            raise OfflineUnavailableError(capability)

    @staticmethod
    def sync_get(capability: str, *args, **kwargs) -> httpx.Response:
        RemoteGateway.ensure(capability)
        return httpx.get(*args, **kwargs)

    @staticmethod
    def sync_post(capability: str, *args, **kwargs) -> httpx.Response:
        RemoteGateway.ensure(capability)
        return httpx.post(*args, **kwargs)

    @staticmethod
    async def async_request(capability: str, client: httpx.AsyncClient, method: str, *args, **kwargs) -> httpx.Response:
        RemoteGateway.ensure(capability)
        return await client.request(method, *args, **kwargs)
