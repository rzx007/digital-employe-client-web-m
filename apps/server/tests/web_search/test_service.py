import pytest
from src.service.agent.web_search.config import WebSearchConfig
from src.service.agent.web_search.models import SearchOutcome, SearchResult
from src.service.agent.web_search.service import WebSearchService


def _cfg(backends, max_chars=10000):
    return WebSearchConfig(
        backends=backends, exa_endpoint="", searxng_endpoint="",
        num_results=8, fetch_top_n=0, max_chars=max_chars,
        max_bytes=256 * 1024, health_ttl=300,
    )


class _FakeBackend:
    def __init__(self, name, outcome=None, fail=False, healthy=True):
        self.name = name
        self._outcome = outcome
        self._fail = fail
        self._healthy = healthy
        self.calls = 0

    async def search(self, query, num_results):
        self.calls += 1
        if self._fail:
            raise ValueError("boom")
        return self._outcome

    async def healthcheck(self):
        return self._healthy


@pytest.mark.asyncio
async def test_passthrough_exa_text():
    exa = _FakeBackend("exa", SearchOutcome("exa", text="Title: A\nURL: http://a"))
    svc = WebSearchService(_cfg(["exa"]), backends={"exa": exa})
    out = await svc.search("世界杯", fetch_content=False)
    assert "Title: A" in out
    assert "世界杯" in out  # 顶部前缀含 query


@pytest.mark.asyncio
async def test_falls_back_to_next_backend():
    exa = _FakeBackend("exa", fail=True)
    dom = _FakeBackend(
        "domestic",
        SearchOutcome("domestic", results=[SearchResult("T", "http://u", "snip")]),
    )
    svc = WebSearchService(_cfg(["exa", "domestic"]), backends={"exa": exa, "domestic": dom})
    out = await svc.search("q", fetch_content=False)
    assert "Title: T" in out and "http://u" in out


@pytest.mark.asyncio
async def test_all_fail_returns_fallback_text():
    exa = _FakeBackend("exa", fail=True)
    svc = WebSearchService(_cfg(["exa"]), backends={"exa": exa})
    out = await svc.search("q", fetch_content=False)
    assert "未能联网搜索" in out and "browser-runtime" in out


@pytest.mark.asyncio
async def test_truncates_to_max_chars():
    big = "x" * 50000
    exa = _FakeBackend("exa", SearchOutcome("exa", text=big))
    svc = WebSearchService(_cfg(["exa"], max_chars=100), backends={"exa": exa})
    out = await svc.search("q", fetch_content=False)
    assert len(out) <= 200  # 前缀 + 截断后正文


@pytest.mark.asyncio
async def test_unhealthy_backend_skipped_within_ttl():
    exa = _FakeBackend("exa", fail=True)
    dom = _FakeBackend("domestic", SearchOutcome("domestic", results=[SearchResult("T", "http://u", "s")]))
    svc = WebSearchService(_cfg(["exa", "domestic"]), backends={"exa": exa, "domestic": dom})
    await svc.search("q", fetch_content=False)  # exa 失败 → 标记不健康
    await svc.search("q2", fetch_content=False)  # 第二次应跳过 exa
    assert exa.calls == 1  # 未被再次调用


@pytest.mark.asyncio
async def test_num_results_override_passed_to_backend():
    seen = {}

    class _RecordingBackend:
        name = "exa"

        async def search(self, query, num_results):
            seen["n"] = num_results
            return SearchOutcome("exa", text="ok")

        async def healthcheck(self):
            return True

    svc = WebSearchService(_cfg(["exa"]), backends={"exa": _RecordingBackend()})
    await svc.search("q", fetch_content=False, num_results=20)
    assert seen["n"] == 20
    await svc.search("q", fetch_content=False)  # default → cfg.num_results (8)
    assert seen["n"] == 8
