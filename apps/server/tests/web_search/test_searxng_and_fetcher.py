import httpx
import pytest
from src.service.agent.web_search.backends import SearxngBackend
from src.service.agent.web_search.content_fetcher import ContentFetcher
from src.service.agent.web_search.models import SearchResult

SEARX_JSON = {
    "results": [
        {"title": "S1", "url": "http://s1", "content": "snippet1"},
        {"title": "S2", "url": "http://s2", "content": "snippet2"},
    ]
}


@pytest.mark.asyncio
async def test_searxng_parses_json():
    def handler(req):
        return httpx.Response(200, json=SEARX_JSON)

    factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    be = SearxngBackend(endpoint="http://searx.local/search", client_factory=factory)
    outcome = await be.search("q", num_results=5)
    assert outcome.results[0].title == "S1"
    assert outcome.results[0].snippet == "snippet1"


@pytest.mark.asyncio
async def test_fetcher_fills_content_top_n():
    def handler(req):
        return httpx.Response(200, text="<p>正文内容 X</p>")

    factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    fetcher = ContentFetcher(client_factory=factory, per_page_max_chars=3000)
    results = [SearchResult("t1", "http://a", "s1"), SearchResult("t2", "http://b", "s2")]
    enriched = await fetcher.enrich(results, top_n=1)
    assert enriched[0].content and "正文内容 X" in enriched[0].content
    assert enriched[1].content is None  # 只补 top_n=1


@pytest.mark.asyncio
async def test_fetcher_skips_failing_page():
    def handler(req):
        raise httpx.ConnectError("boom")

    factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    fetcher = ContentFetcher(client_factory=factory, per_page_max_chars=3000)
    results = [SearchResult("t1", "http://a", "s1")]
    enriched = await fetcher.enrich(results, top_n=1)
    assert enriched[0].content is None  # 失败跳过不抛
