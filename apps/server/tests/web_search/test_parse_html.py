"""Tests for parse_bing_html and parse_sogou_html.

Fixtures are real HTML pages captured 2026-06-29:
  - bing_cn.html   : cn.bing.com/search?q=2026世界杯  (10 b_algo blocks, real results)
  - sogou.html     : www.sogou.com/web?query=2026世界杯 (6 vrwrap organic blocks)
"""
from pathlib import Path

from src.service.agent.web_search.parsing import parse_bing_html, parse_sogou_html

FIX = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Bing tests
# ---------------------------------------------------------------------------


def test_parse_bing_returns_results():
    html = (FIX / "bing_cn.html").read_text(encoding="utf-8", errors="ignore")
    results = parse_bing_html(html, num_results=5)
    assert len(results) >= 1
    first = results[0]
    assert first.url.startswith("http")
    assert first.title.strip()
    assert "<" not in first.title  # no HTML tag leakage


def test_parse_bing_respects_num_results():
    html = (FIX / "bing_cn.html").read_text(encoding="utf-8", errors="ignore")
    assert len(parse_bing_html(html, num_results=2)) <= 2


def test_parse_bing_empty_html():
    assert parse_bing_html("", num_results=5) == []


def test_parse_bing_title_no_html_entities():
    """Title should be clean text with HTML entities decoded."""
    html = (FIX / "bing_cn.html").read_text(encoding="utf-8", errors="ignore")
    results = parse_bing_html(html, num_results=5)
    for r in results:
        assert "&amp;" not in r.title
        assert "&lt;" not in r.title
        assert "&gt;" not in r.title


# ---------------------------------------------------------------------------
# Sogou tests
# ---------------------------------------------------------------------------


def test_parse_sogou_returns_results():
    html = (FIX / "sogou.html").read_text(encoding="utf-8", errors="ignore")
    results = parse_sogou_html(html, num_results=5)
    assert len(results) >= 1
    first = results[0]
    assert first.url.startswith("http")
    assert first.title.strip()
    assert "<" not in first.title  # no HTML tag leakage


def test_parse_sogou_respects_num_results():
    html = (FIX / "sogou.html").read_text(encoding="utf-8", errors="ignore")
    assert len(parse_sogou_html(html, num_results=3)) <= 3


def test_parse_sogou_empty_html():
    assert parse_sogou_html("", num_results=5) == []


def test_parse_sogou_relative_links_become_absolute():
    """Links starting with /link?url= should be prefixed with sogou domain."""
    html = (FIX / "sogou.html").read_text(encoding="utf-8", errors="ignore")
    results = parse_sogou_html(html, num_results=10)
    for r in results:
        assert r.url.startswith("http"), f"Non-absolute URL: {r.url}"


# ---------------------------------------------------------------------------
# Synthetic snippet test (verifies parser logic even without live fixture)
# ---------------------------------------------------------------------------

_BING_SYNTHETIC = """
<li class="b_algo" data-id iid=SERP.1>
  <h2 class=""><a target="_blank" href="https://example.com/page">Example <strong>Title</strong></a></h2>
  <p class="b_lineclamp2">This is the snippet text &amp; more.</p>
</li>
"""

_SOGOU_SYNTHETIC = """
<div class="vrwrap" id="sogou_vr_30000000_wrap_6"><h3 class="vr-title"><!--awbg6--><a name="dttl" target="_blank" href="/link?url=ENCODED_URL" id="sogou_vr_30000000_6"><!--awbg6--><em>Example</em>搜狗结果</a></h3><div class="fz-mid space-txt base-ellipsis clamp2" id="cacheresult_summary_6">搜狗摘要内容示例。</div></div>
"""


def test_parse_bing_synthetic():
    results = parse_bing_html(_BING_SYNTHETIC, num_results=5)
    assert len(results) == 1
    assert results[0].url == "https://example.com/page"
    assert results[0].title == "Example Title"
    assert "snippet text" in results[0].snippet
    assert "&amp;" not in results[0].snippet  # entity decoded


def test_parse_sogou_synthetic():
    results = parse_sogou_html(_SOGOU_SYNTHETIC, num_results=5)
    assert len(results) == 1
    assert results[0].url == "https://www.sogou.com/link?url=ENCODED_URL"
    assert "搜狗结果" in results[0].title
    assert "摘要" in results[0].snippet
