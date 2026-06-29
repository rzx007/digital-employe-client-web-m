from __future__ import annotations

from langchain_core.tools import tool

from src.service.agent.web_search.backends import (
    DomesticBackend,
    ExaBackend,
    SearxngBackend,
)
from src.service.agent.web_search.config import load_web_search_config
from src.service.agent.web_search.service import WebSearchService


def _build_service() -> WebSearchService:
    cfg = load_web_search_config()
    order = list(cfg.backends)
    if cfg.searxng_endpoint and "searxng" not in order:
        order.append("searxng")
    backends: dict = {}
    for name in order:
        if name == "exa":
            backends["exa"] = ExaBackend(endpoint=cfg.exa_endpoint)
        elif name == "domestic":
            backends["domestic"] = DomesticBackend()
        elif name == "searxng" and cfg.searxng_endpoint:
            backends["searxng"] = SearxngBackend(endpoint=cfg.searxng_endpoint)
    cfg.backends = order
    return WebSearchService(cfg, backends=backends)


def create_web_search_tool():
    service = _build_service()

    @tool
    async def web_search(
        query: str, num_results: int = 8, fetch_content: bool = True
    ) -> str:
        """联网搜索并返回结果摘要（含前几条正文）。需要查最新/外部信息时用本工具，
        比开浏览器更快更稳。要对某个具体网页做点击/填表等交互，才用 browser-runtime 技能。

        Args:
            query: 搜索关键词
            num_results: 期望结果条数（默认 8）
            fetch_content: 是否抓取前几条正文（默认 True；只要链接/摘要可设 False 更快）
        """
        return await service.search(
            query, fetch_content=fetch_content, num_results=num_results
        )

    return web_search
