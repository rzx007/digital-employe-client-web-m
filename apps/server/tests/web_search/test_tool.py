from src.service.agent.web_search.tool import create_web_search_tool


def test_create_returns_langchain_tool():
    t = create_web_search_tool()
    assert t.name == "web_search"
    assert "联网搜索" in (t.description or "")


async def test_tool_invoke_runs_service(monkeypatch):
    import src.service.agent.web_search.tool as toolmod

    async def fake_search(self, query, fetch_content=True, num_results=None):
        return f"FAKE::{query}::{fetch_content}"

    monkeypatch.setattr(toolmod.WebSearchService, "search", fake_search)
    t = create_web_search_tool()
    result = await t.ainvoke({"query": "世界杯", "fetch_content": True})
    assert result == "FAKE::世界杯::True"
