from __future__ import annotations

import html as _html
import json
import re


def _extract_text_from_jsonrpc(obj: dict) -> str:
    result = obj.get("result")
    if not isinstance(result, dict):
        return ""
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if isinstance(text, str) and text:
                return text
    return ""


def parse_exa_sse(raw: str) -> str:
    """从 Exa MCP 响应（SSE 或裸 JSON-RPC）抽出 result.content[0].text。

    解析顺序：先按整体当 JSON-RPC 试；失败再逐行找 `data: {json}` 帧。
    忽略 `[DONE]`、非 JSON 帧、缺字段；找不到返回空串。
    """
    if not raw or not raw.strip():
        return ""
    # 1) 整体直接是 JSON-RPC
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            text = _extract_text_from_jsonrpc(obj)
            if text:
                return text
    except json.JSONDecodeError:
        pass
    # 2) 逐行 SSE：取 data: 后的 JSON 帧
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            text = _extract_text_from_jsonrpc(obj)
            if text:
                return text
    return ""


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_TAG_RE = re.compile(r"<[^>]+>")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def _strip_tags(fragment: str) -> str:
    """Strip HTML tags and HTML-entity-decode, returning clean text."""
    fragment = _COMMENT_RE.sub("", fragment)
    return _html.unescape(_TAG_RE.sub("", fragment)).strip()


# ---------------------------------------------------------------------------
# 必应 cn.bing.com HTML parser
#
# Real structure (captured 2026-06-29, cn.bing.com/search?q=2026世界杯):
#   container : <li class="b_algo" ...>...</li>
#   title+url : <h2 class="..."><a ... href="URL">TITLE_HTML</a></h2>
#   snippet   : <p class="b_lineclamp2 ...">SNIPPET</p>
# ---------------------------------------------------------------------------

# Each organic result lives inside <li class="b_algo" ...>
_BING_BLOCK_RE = re.compile(
    r'<li\s+class="b_algo"[^>]*>.*?</li\s*>', re.S
)

# Title link is the first <a href="http..."> inside an <h2> tag
_BING_TITLE_RE = re.compile(
    r'<h2[^>]*>.*?<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>', re.S
)

# Snippet is in a <p class="b_lineclamp..."> paragraph
_BING_SNIPPET_RE = re.compile(
    r'<p[^>]+class="b_lineclamp[^"]*"[^>]*>(.*?)</p>', re.S
)


def parse_bing_html(html: str, num_results: int) -> "list[SearchResult]":
    """Parse cn.bing.com SERP HTML and return up to *num_results* SearchResult."""
    from src.service.agent.web_search.models import SearchResult

    out: list[SearchResult] = []
    for block in _BING_BLOCK_RE.findall(html or ""):
        m = _BING_TITLE_RE.search(block)
        if not m:
            continue
        url = _html.unescape(m.group(1))
        title = _strip_tags(m.group(2))
        if not title:
            continue
        sm = _BING_SNIPPET_RE.search(block)
        snippet = _strip_tags(sm.group(1)) if sm else ""
        out.append(SearchResult(title=title, url=url, snippet=snippet))
        if len(out) >= num_results:
            break
    return out


# ---------------------------------------------------------------------------
# 搜狗 sogou.com HTML parser
#
# Real structure (captured 2026-06-29, www.sogou.com/web?query=2026世界杯):
#   container : <div class="vrwrap" id="sogou_vr_30000000_wrap_N">
#   title+url : <h3 class="vr-title"><!--awbgN--><a ... href="/link?url=ENC">TITLE</a></h3>
#               (first result may use absolute URL, rest use /link?url= redirect)
#   snippet   : <div class="fz-mid space-txt base-ellipsis clamp2"
#                    id="cacheresult_summary_N">SNIPPET</div>
# ---------------------------------------------------------------------------

# Only match the standard organic result blocks (id pattern sogou_vr_30000000_wrap_N)
_SOGOU_BLOCK_RE = re.compile(
    r'<div\s+class="vrwrap"\s+id="sogou_vr_30000000_wrap_\d+"[^>]*>.*?(?=<div\s+class="vrwrap"|$)',
    re.S,
)

# h3 class="vr-title" — title link (href may be absolute or /link?url=...)
_SOGOU_TITLE_RE = re.compile(
    r'<h3[^>]+class="vr-title[^"]*"[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
    re.S,
)

# Snippet: div with id "cacheresult_summary_*"
_SOGOU_SNIPPET_RE = re.compile(
    r'<div[^>]+id="cacheresult_summary_\d+"[^>]*>(.*?)</div>', re.S
)


def parse_sogou_html(html: str, num_results: int) -> "list[SearchResult]":
    """Parse sogou.com SERP HTML and return up to *num_results* SearchResult."""
    from src.service.agent.web_search.models import SearchResult

    out: list[SearchResult] = []
    for block in _SOGOU_BLOCK_RE.findall(html or ""):
        m = _SOGOU_TITLE_RE.search(block)
        if not m:
            continue
        url = _html.unescape(m.group(1))
        # Relative /link?url= redirect → make absolute
        if url.startswith("/"):
            url = "https://www.sogou.com" + url
        title = _strip_tags(m.group(2))
        if not title:
            continue
        sm = _SOGOU_SNIPPET_RE.search(block)
        snippet = _strip_tags(sm.group(1)) if sm else ""
        out.append(SearchResult(title=title, url=url, snippet=snippet))
        if len(out) >= num_results:
            break
    return out


# ---------------------------------------------------------------------------
# HTML → 正文 抽取
# ---------------------------------------------------------------------------

_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.S | re.I)
_WS_RE = re.compile(r"\s+")


def html_to_text(html: str, max_chars: int) -> str:
    """Strip all tags/scripts/styles from *html*, collapse whitespace, and
    truncate to *max_chars* characters.  Returns plain text."""
    if not html:
        return ""
    cleaned = _SCRIPT_STYLE_RE.sub(" ", html)
    cleaned = _TAG_RE.sub(" ", cleaned)
    text = _WS_RE.sub(" ", _html.unescape(cleaned)).strip()
    if max_chars > 0 and len(text) > max_chars:
        text = text[:max_chars]
    return text
