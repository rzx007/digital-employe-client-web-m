"""HTTP client for Electron browser CDP bridge (port 34555)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_BRIDGE_URL = "http://127.0.0.1:34555"
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
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            # 本地 Electron bridge 必须直连。httpx 默认 trust_env=True 会读取
            # Windows/系统代理配置，可能把 127.0.0.1 也发到代理并得到空 502。
            trust_env=False,
        )

    async def navigate(self, session_id: str, url: str) -> CdpResult:
        return await self._post(
            f"/internal/browser/{session_id}/navigate",
            {"url": url},
            timeout=55.0,
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

    async def _post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> CdpResult:
        url = f"{self._base}{path}"
        try:
            resp = await self._client.post(url, json=payload, timeout=timeout)
        except httpx.ConnectError:
            return CdpResult(
                ok=False,
                error=(
                    f"无法连接浏览器桥接服务 {self._base}。"
                    "请确认桌面端 Electron 已启动（pnpm dev:app），"
                    "且主进程已监听 34555 端口。"
                ),
            )
        except httpx.TimeoutException:
            return CdpResult(
                ok=False,
                error=f"浏览器桥接请求超时: {url}",
            )
        except httpx.HTTPError as exc:
            logger.warning(
                "browser runtime request failed: %s %s → %s",
                self._base,
                path,
                exc,
            )
            return CdpResult(ok=False, error=str(exc))

        raw = (resp.text or "").strip()
        if not raw:
            return CdpResult(
                ok=False,
                error=(
                    f"浏览器桥接返回空响应 (HTTP {resp.status_code})。"
                    f"请查看 Electron 日志 [browser-http]。"
                ),
            )
        try:
            body = resp.json()
        except ValueError:
            return CdpResult(
                ok=False,
                error=(
                    f"浏览器桥接返回非 JSON (HTTP {resp.status_code}): "
                    f"{raw[:200]!r}"
                ),
            )
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

    async def close(self) -> None:
        await self._client.aclose()


def default_session_id() -> str:
    return DEFAULT_SESSION
