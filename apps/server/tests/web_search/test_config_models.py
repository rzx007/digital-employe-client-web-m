import os
from src.service.agent.web_search.models import SearchResult, SearchOutcome
from src.service.agent.web_search.config import load_web_search_config


def test_search_result_defaults():
    r = SearchResult(title="t", url="u", snippet="s")
    assert r.content is None and r.published is None


def test_outcome_holds_text_or_results():
    o1 = SearchOutcome(backend="exa", text="blob", results=None)
    o2 = SearchOutcome(backend="domestic", text=None, results=[])
    assert o1.text == "blob" and o2.results == []


def test_config_defaults(monkeypatch):
    for k in list(os.environ):
        if k.startswith("WEB_SEARCH_"):
            monkeypatch.delenv(k, raising=False)
    c = load_web_search_config()
    assert c.backends == ["exa", "domestic"]
    assert c.exa_endpoint == "https://mcp.exa.ai/mcp"
    assert c.num_results == 8
    assert c.fetch_top_n == 3
    assert c.max_chars == 10000
    assert c.max_bytes == 256 * 1024
    assert c.health_ttl == 300
    assert c.searxng_endpoint == ""


def test_config_env_override(monkeypatch):
    monkeypatch.setenv("WEB_SEARCH_BACKENDS", "searxng, domestic")
    monkeypatch.setenv("WEB_SEARCH_NUM_RESULTS", "5")
    monkeypatch.setenv("WEB_SEARCH_SEARXNG_ENDPOINT", "http://x:8080")
    c = load_web_search_config()
    assert c.backends == ["searxng", "domestic"]
    assert c.num_results == 5
    assert c.searxng_endpoint == "http://x:8080"
