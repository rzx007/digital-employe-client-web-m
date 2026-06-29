from __future__ import annotations

import json
from typing import Callable, Protocol

import httpx

from src.service.agent.web_search.models import SearchOutcome, SearchResult
from src.service.agent.web_search.parsing import (
    parse_bing_html,
    parse_exa_sse,
    parse_sogou_html,
)
from src.utils.http_client import create_http_client

ClientFactory = Callable[[], httpx.AsyncClient]


def _default_client_factory() -> httpx.AsyncClient:
    # Exa：连接 10s / 读 25s（对齐 opencode）
    return create_http_client(timeout_connect=10.0, timeout_read=25.0)


class SearchBackend(Protocol):
    name: str

    async def search(self, query: str, num_results: int) -> SearchOutcome: ...
    async def healthcheck(self) -> bool: ...


class ExaBackend:
    name = "exa"

    def __init__(
        self,
        endpoint: str = "https://mcp.exa.ai/mcp",
        client_factory: ClientFactory | None = None,
    ):
        self.endpoint = endpoint
        self._client_factory = client_factory or _default_client_factory

    def _payload(self, query: str, num_results: int) -> dict:
        return {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "web_search_exa",
                "arguments": {
                    "query": query,
                    "numResults": num_results,
                    "type": "auto",
                    "livecrawl": "fallback",
                },
            },
        }

    async def search(self, query: str, num_results: int) -> SearchOutcome:
        async with self._client_factory() as client:
            resp = await client.post(
                self.endpoint,
                json=self._payload(query, num_results),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
            resp.raise_for_status()
            text = parse_exa_sse(resp.text)
        if not text:
            raise ValueError("Exa 返回空结果")
        return SearchOutcome(backend=self.name, text=text, results=None)

    async def healthcheck(self) -> bool:
        try:
            async with self._client_factory() as client:
                resp = await client.post(
                    self.endpoint,
                    json=self._payload("ping", 1),
                    headers={"Accept": "application/json, text/event-stream"},
                )
                return resp.status_code == 200
        except Exception:
            return False


_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _default_scrape_client_factory() -> httpx.AsyncClient:
    return create_http_client(timeout_connect=10.0, timeout_read=10.0)


class DomesticBackend:
    name = "domestic"

    def __init__(self, client_factory: ClientFactory | None = None):
        self._client_factory = client_factory or _default_scrape_client_factory

    async def _fetch(self, client: httpx.AsyncClient, url: str, params: dict) -> str:
        resp = await client.get(
            url, params=params, headers={"User-Agent": _UA}, follow_redirects=True
        )
        resp.raise_for_status()
        return resp.text

    async def search(self, query: str, num_results: int) -> SearchOutcome:
        async with self._client_factory() as client:
            results: list[SearchResult] = []
            try:
                html = await self._fetch(
                    client, "https://cn.bing.com/search", {"q": query}
                )
                results = parse_bing_html(html, num_results)
            except Exception:
                results = []
            if not results:
                try:
                    html = await self._fetch(
                        client, "https://www.sogou.com/web", {"query": query}
                    )
                    results = parse_sogou_html(html, num_results)
                except Exception:
                    results = []
        if not results:
            raise ValueError("国内后端无结果（必应/搜狗均空或被拦）")
        return SearchOutcome(backend=self.name, text=None, results=results)

    async def healthcheck(self) -> bool:
        try:
            async with self._client_factory() as client:
                resp = await client.get(
                    "https://cn.bing.com/search",
                    params={"q": "ping"},
                    headers={"User-Agent": _UA},
                )
                return resp.status_code == 200
        except Exception:
            return False


class SearxngBackend:
    name = "searxng"

    def __init__(self, endpoint: str, client_factory: ClientFactory | None = None):
        self.endpoint = endpoint
        self._client_factory = client_factory or _default_scrape_client_factory

    async def search(self, query: str, num_results: int) -> SearchOutcome:
        async with self._client_factory() as client:
            resp = await client.get(
                self.endpoint,
                params={"q": query, "format": "json"},
                headers={"User-Agent": _UA},
            )
            resp.raise_for_status()
            data = resp.json()
        items = data.get("results") if isinstance(data, dict) else None
        results: list[SearchResult] = []
        for it in (items or [])[:num_results]:
            if not isinstance(it, dict):
                continue
            url = str(it.get("url") or "")
            title = str(it.get("title") or "")
            if not url or not title:
                continue
            results.append(
                SearchResult(title=title, url=url, snippet=str(it.get("content") or ""))
            )
        if not results:
            raise ValueError("SearXNG 无结果")
        return SearchOutcome(backend=self.name, text=None, results=results)

    async def healthcheck(self) -> bool:
        try:
            async with self._client_factory() as client:
                resp = await client.get(
                    self.endpoint, params={"q": "ping", "format": "json"}
                )
                return resp.status_code == 200
        except Exception:
            return False
