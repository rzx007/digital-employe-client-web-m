"""BrowserRuntimeClient unit tests (mock httpx)."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from src.service.browser.browser_runtime_client import BrowserRuntimeClient


def test_navigate_success(monkeypatch):
    async def mock_post(self, url, **kwargs):
        assert "/internal/browser/default/navigate" in url
        assert kwargs["json"] == {"url": "https://example.com"}
        return httpx.Response(
            200,
            json={
                "ok": True,
                "data": {"url": "https://example.com", "title": "Ex"},
            },
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    client = BrowserRuntimeClient("http://127.0.0.1:34555")

    async def run():
        result = await client.navigate("default", "https://example.com")
        await client.close()
        return result

    result = asyncio.run(run())
    assert result.ok
    assert result.data["title"] == "Ex"


def test_click_element_not_found(monkeypatch):
    async def mock_post(self, url, **kwargs):
        return httpx.Response(
            404,
            json={"ok": False, "error": "ELEMENT_NOT_FOUND"},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    client = BrowserRuntimeClient("http://127.0.0.1:34555")

    async def run():
        result = await client.click("default", "#missing")
        await client.close()
        return result

    result = asyncio.run(run())
    assert not result.ok
    assert result.error == "ELEMENT_NOT_FOUND"


def test_post_empty_body_returns_clear_error(monkeypatch):
    async def mock_post(self, url, **kwargs):
        return httpx.Response(200, content=b"")

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    client = BrowserRuntimeClient("http://127.0.0.1:34555")

    async def run():
        result = await client.navigate("default", "https://www.bilibili.com")
        await client.close()
        return result

    result = asyncio.run(run())
    assert not result.ok
    assert "空响应" in (result.error or "")
