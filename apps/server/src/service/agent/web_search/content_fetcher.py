from __future__ import annotations

from typing import Callable

import httpx

from src.service.agent.web_search.models import SearchResult
from src.service.agent.web_search.parsing import html_to_text
from src.utils.http_client import create_http_client

ClientFactory = Callable[[], httpx.AsyncClient]

# 与 backends._UA 同值；本地定义以保持模块解耦、避免循环导入
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _default_factory() -> httpx.AsyncClient:
    return create_http_client(timeout_connect=8.0, timeout_read=8.0)


class ContentFetcher:
    def __init__(
        self,
        client_factory: ClientFactory | None = None,
        per_page_max_chars: int = 3000,
    ):
        self._client_factory = client_factory or _default_factory
        self._per_page_max_chars = per_page_max_chars

    async def enrich(
        self, results: list[SearchResult], top_n: int
    ) -> list[SearchResult]:
        async with self._client_factory() as client:
            for r in results[: max(0, top_n)]:
                try:
                    resp = await client.get(
                        r.url,
                        headers={"User-Agent": _UA},
                        follow_redirects=True,
                    )
                    resp.raise_for_status()
                    r.content = html_to_text(resp.text, self._per_page_max_chars)
                except Exception:
                    continue  # 单页失败跳过，不阻断
        return results
