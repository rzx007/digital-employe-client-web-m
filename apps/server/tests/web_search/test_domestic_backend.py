import httpx
import pytest
from src.service.agent.web_search.backends import DomesticBackend

BING_HTML = (
    '<li class="b_algo"><h2><a href="http://a.com">Alpha</a></h2>'
    '<div class="b_caption"><p class="b_lineclamp2">alpha 摘要</p></div></li>'
)
SOGOU_HTML = (
    '<div class="vrwrap" id="sogou_vr_30000000_wrap_0"><h3 class="vr-title">'
    '<a href="http://b.com">Beta</a></h3>'
    '<div class="fz-mid space-txt" id="cacheresult_summary_0">beta 摘要</div></div>'
)


def _factory(route: dict[str, tuple[int, str]]):
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        status, body = route.get(host, (404, ""))
        return httpx.Response(status, text=body)

    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_domestic_uses_bing_first():
    be = DomesticBackend(client_factory=_factory({"cn.bing.com": (200, BING_HTML)}))
    outcome = await be.search("q", num_results=5)
    assert outcome.backend == "domestic"
    assert outcome.text is None
    assert outcome.results[0].title == "Alpha"
    assert outcome.results[0].url == "http://a.com"


@pytest.mark.asyncio
async def test_domestic_falls_back_to_sogou_when_bing_empty():
    be = DomesticBackend(
        client_factory=_factory(
            {"cn.bing.com": (200, "<html>无结果</html>"),
             "www.sogou.com": (200, SOGOU_HTML)}
        )
    )
    outcome = await be.search("q", num_results=5)
    assert outcome.results[0].title == "Beta"


@pytest.mark.asyncio
async def test_domestic_raises_when_all_empty():
    be = DomesticBackend(
        client_factory=_factory(
            {"cn.bing.com": (200, "x"), "www.sogou.com": (200, "y")}
        )
    )
    with pytest.raises(Exception):
        await be.search("q", num_results=5)
