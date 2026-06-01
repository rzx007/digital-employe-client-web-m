"""HTTP client for Electron browser CDP bridge (port 58555)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_BRIDGE_URL = "http://127.0.0.1:58555"
DEFAULT_SESSION = "default"


def default_bridge_url() -> str:
    return os.getenv("BROWSER_RUNTIME_BRIDGE_URL", DEFAULT_BRIDGE_URL).rstrip("/")


@dataclass
class CdpResult:
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class BrowserRuntimeClient:
    """Calls Electron browser HTTP bridge."""

    def __init__(self, base_url: str | None = None):
        self._base = (base_url or default_bridge_url()).rstrip("/")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def navigate(self, session_id: str, url: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/navigate",
            {"url": url},
        )

    async def snapshot(
        self, session_id: str, max_nodes: int = 200
    ) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/snapshot",
            {"max_nodes": max_nodes},
        )

    async def click(
        self,
        session_id: str,
        ref_or_selector: str,
        *,
        confirmation_required: bool = False,
        confirmation_message: str | None = None,
    ) -> CdpResult:
        payload: dict[str, Any] = {"ref_or_selector": ref_or_selector}
        if confirmation_required:
            payload["confirmation_required"] = True
        if confirmation_message:
            payload["confirmation_message"] = confirmation_message
        return await self._post(
            f"/internal/browser/{session_id}/click",
            payload,
        )

    async def fill(
        self, session_id: str, ref_or_selector: str, text: str
    ) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/fill",
            {"ref_or_selector": ref_or_selector, "text": text},
        )

    async def extract_text(self, session_id: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/extract-text",
            {},
        )

    async def screenshot(self, session_id: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/screenshot",
            {},
        )

    async def get_url(self, session_id: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/get-url",
            {},
        )

    async def get_title(self, session_id: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/get-title",
            {},
        )

    async def _post(self, path: str, payload: dict[str, Any]) -> CdpResult:
        try:
            resp = await self._client.post(
                f"{self._base}{path}",
                json=payload,
            )
            body = resp.json()
            if resp.status_code >= 400:
                return CdpResult(
                    ok=False,
                    error=body.get("error") or resp.reason_phrase,
                )
            return CdpResult(
                ok=bool(body.get("ok", True)),
                data=body.get("data") or {},
                error=body.get("error"),
            )
        except httpx.HTTPError as exc:
            logger.warning(
                "browser runtime request failed: %s %s → %s",
                self._base,
                path,
                exc,
            )
            return CdpResult(ok=False, error=str(exc))

    async def close(self) -> None:
        await self._client.aclose()


def default_session_id() -> str:
    return DEFAULT_SESSION
