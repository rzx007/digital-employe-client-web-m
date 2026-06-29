import httpx
import pytest
from src.service.agent.web_search.backends import ExaBackend

SSE = (
    'event: message\n'
    'data: {"result":{"content":[{"type":"text","text":"Title: A\\nURL: http://a"}]},'
    '"jsonrpc":"2.0","id":1}\n\n'
)


def _client_returning(status=200, body=SSE):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=body)

    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_exa_search_returns_text_outcome():
    be = ExaBackend(endpoint="http://fake/mcp", client_factory=_client_returning())
    outcome = await be.search("q", num_results=3)
    assert outcome.backend == "exa"
    assert outcome.results is None
    assert "Title: A" in outcome.text


@pytest.mark.asyncio
async def test_exa_healthcheck_true_on_200():
    be = ExaBackend(endpoint="http://fake/mcp", client_factory=_client_returning())
    assert await be.healthcheck() is True


@pytest.mark.asyncio
async def test_exa_raises_on_non_200():
    be = ExaBackend(
        endpoint="http://fake/mcp",
        client_factory=_client_returning(status=500, body="err"),
    )
    with pytest.raises(Exception):
        await be.search("q", num_results=3)
