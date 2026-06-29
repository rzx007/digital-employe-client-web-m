from __future__ import annotations

import logging
import time

from src.service.agent.web_search.config import WebSearchConfig
from src.service.agent.web_search.content_fetcher import ContentFetcher
from src.service.agent.web_search.models import SearchOutcome, SearchResult

logger = logging.getLogger(__name__)

_FALLBACK = (
    "未能联网搜索（已尝试 {tried}）。可改用 browser-runtime 技能打开具体网址，"
    "或检查网络后重试。"
)


def _format_results(results: list[SearchResult]) -> str:
    """国内/searxng 结构化结果 → 与 Exa 同款文本块。"""
    blocks: list[str] = []
    for r in results:
        lines = [
            f"Title: {r.title}",
            f"URL: {r.url}",
            f"Published: {r.published or 'N/A'}",
            "Highlights:",
            r.snippet or "",
        ]
        if r.content:
            lines.append(r.content)
        blocks.append("\n".join(lines))
    return "\n\n---\n\n".join(blocks)


class WebSearchService:
    def __init__(
        self,
        config: WebSearchConfig,
        backends: dict | None = None,
        content_fetcher: ContentFetcher | None = None,
    ):
        self._cfg = config
        self._backends = backends or {}
        self._fetcher = content_fetcher or ContentFetcher()
        self._unhealthy: dict[str, float] = {}  # name -> 恢复时间戳

    def _is_skipped(self, name: str) -> bool:
        until = self._unhealthy.get(name)
        return until is not None and time.monotonic() < until

    def _mark_unhealthy(self, name: str) -> None:
        self._unhealthy[name] = time.monotonic() + self._cfg.health_ttl

    async def search(
        self, query: str, fetch_content: bool = True, num_results: int | None = None
    ) -> str:
        n = num_results if (num_results and num_results > 0) else self._cfg.num_results
        tried: list[str] = []
        for name in self._cfg.backends:
            backend = self._backends.get(name)
            if backend is None or self._is_skipped(name):
                continue
            tried.append(name)
            try:
                outcome = await backend.search(query, n)
            except Exception as exc:  # noqa: BLE001
                logger.warning("web_search 后端 %s 失败: %s", name, exc)
                self._mark_unhealthy(name)
                continue
            body = await self._render(outcome, fetch_content)
            if not body:
                continue
            return self._finalize(query, name, body)
        return _FALLBACK.format(tried=", ".join(tried) or "（无可用后端）")

    async def _render(self, outcome: SearchOutcome, fetch_content: bool) -> str:
        if outcome.text is not None:  # Exa 透传
            return outcome.text
        results = outcome.results or []
        if not results:
            return ""
        if fetch_content and self._cfg.fetch_top_n > 0:
            results = await self._fetcher.enrich(results, self._cfg.fetch_top_n)
        return _format_results(results)

    def _finalize(self, query: str, backend: str, body: str) -> str:
        prefix = f"搜索：{query}（后端：{backend}）\n\n"
        text = prefix + body
        if len(text) > self._cfg.max_chars:
            text = text[: self._cfg.max_chars]
        encoded = text.encode("utf-8")
        if len(encoded) > self._cfg.max_bytes:
            text = encoded[: self._cfg.max_bytes].decode("utf-8", "ignore")
        return text
