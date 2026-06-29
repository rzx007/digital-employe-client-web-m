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
