# 联网搜索工具（web_search）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 worker（员工）agent 增加一个永远在场、免费无 key 的 `web_search` 一等工具：能连外网时走 Exa 公开 MCP（opencode 同款），连不上自动降级到国内必应/搜狗，返回逻辑参照 opencode（透传后端文本 + 预算截断）。

**Architecture:** 新增 `apps/server/src/service/agent/web_search/` 子包：纯函数解析层（Exa SSE / 必应·搜狗 HTML / HTML→正文）→ 后端层（ExaBackend / DomesticBackend / SearxngBackend，HTTP 客户端可注入便于测试）→ 编排层（WebSearchService：后端顺序、健康缓存、正文补全、透传/格式化、字符+字节预算截断、全失败兜底）→ 工具层（`create_web_search_tool` 返回 LangChain `@tool`）。只在 `employee.py` 的 `extra_tools` 加一行接入；browserctl 不动。

**Tech Stack:** Python 3.11+，httpx（复用 `src/utils/http_client.py`，测试用 `httpx.MockTransport` 离线），LangChain `@tool`，deepagents，pytest，标准库 `html.parser`/`re`/`html`（HTML 解析优先零新依赖）。

参考 spec：`docs/superpowers/specs/2026-06-29-web-search-tool-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `apps/server/src/service/agent/web_search/__init__.py` | 仅 re-export `create_web_search_tool` |
| `apps/server/src/service/agent/web_search/models.py` | `SearchResult`、`SearchOutcome` 数据结构 |
| `apps/server/src/service/agent/web_search/config.py` | `WebSearchConfig` + `load_web_search_config()`（读环境变量，全有默认） |
| `apps/server/src/service/agent/web_search/parsing.py` | 纯函数：`parse_exa_sse`、`parse_bing_html`、`parse_sogou_html`、`html_to_text` |
| `apps/server/src/service/agent/web_search/backends.py` | `SearchBackend` 协议 + `ExaBackend`、`DomesticBackend`、`SearxngBackend` |
| `apps/server/src/service/agent/web_search/content_fetcher.py` | `ContentFetcher`：抓前 N 条页面、抽正文 |
| `apps/server/src/service/agent/web_search/service.py` | `WebSearchService`：编排、健康缓存、格式化、截断、兜底 |
| `apps/server/src/service/agent/web_search/tool.py` | `create_web_search_tool()` → `@tool web_search` |
| `apps/server/src/service/agent/web_search/__main__.py` | 连通性自检 CLI（`python -m src.service.agent.web_search`） |
| `apps/server/src/service/agent/employee.py` | 改：`extra_tools.append(create_web_search_tool())` |
| `apps/server/tests/web_search/test_*.py` | 各单元/集成测试 |

> **interface 说明（细化 spec §3.2）**：后端统一返回 `SearchOutcome`，承载两种形态——Exa 直接给 `text`（透传，已含正文）；国内/searxng 给 `results: list[SearchResult]`（由 service 补正文并格式化）。这样既满足"参照 opencode 透传"，又能对结构化后端补正文。

> **worktree 提示**：依赖需自装；后端 pytest filter 名 `boban-staff`；本工具是 Python，全程用 pytest（非 node:test）。运行测试统一在 `apps/server/` 下：`uv run pytest tests/web_search/ -v`。

---

## Task 1: 数据结构 + 配置加载

**Files:**
- Create: `apps/server/src/service/agent/web_search/__init__.py`
- Create: `apps/server/src/service/agent/web_search/models.py`
- Create: `apps/server/src/service/agent/web_search/config.py`
- Test: `apps/server/tests/web_search/test_config_models.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/web_search/test_config_models.py
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_config_models.py -v`
Expected: FAIL（ModuleNotFoundError: web_search）

- [ ] **Step 3: 写最小实现**

```python
# apps/server/src/service/agent/web_search/__init__.py
from src.service.agent.web_search.tool import create_web_search_tool

__all__ = ["create_web_search_tool"]
```

```python
# apps/server/src/service/agent/web_search/models.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    content: str | None = None
    published: str | None = None


@dataclass
class SearchOutcome:
    """后端搜索结果：Exa 给 text（透传）；结构化后端给 results。"""

    backend: str
    text: str | None = None
    results: list[SearchResult] | None = None
```

```python
# apps/server/src/service/agent/web_search/config.py
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class WebSearchConfig:
    backends: list[str]
    exa_endpoint: str
    searxng_endpoint: str
    num_results: int
    fetch_top_n: int
    max_chars: int
    max_bytes: int
    health_ttl: int


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def load_web_search_config() -> WebSearchConfig:
    backends_raw = os.getenv("WEB_SEARCH_BACKENDS", "exa,domestic")
    backends = [b.strip() for b in backends_raw.split(",") if b.strip()]
    return WebSearchConfig(
        backends=backends or ["exa", "domestic"],
        exa_endpoint=os.getenv(
            "WEB_SEARCH_EXA_ENDPOINT", "https://mcp.exa.ai/mcp"
        ).strip(),
        searxng_endpoint=os.getenv("WEB_SEARCH_SEARXNG_ENDPOINT", "").strip(),
        num_results=_int("WEB_SEARCH_NUM_RESULTS", 8),
        fetch_top_n=_int("WEB_SEARCH_FETCH_TOP_N", 3),
        max_chars=_int("WEB_SEARCH_MAX_CHARS", 10000),
        max_bytes=_int("WEB_SEARCH_MAX_BYTES", 256 * 1024),
        health_ttl=_int("WEB_SEARCH_HEALTH_TTL", 300),
    )
```

> 注意：`__init__.py` import 了 `tool`（Task 9 才建）。为让本任务可独立跑测试，**先建一个占位 `tool.py`**：

```python
# apps/server/src/service/agent/web_search/tool.py  （Task 9 会替换）
def create_web_search_tool():  # placeholder
    raise NotImplementedError
```
并建空文件 `apps/server/tests/web_search/__init__.py`（若 tests 目录需要包标记，参照现有 tests 结构；不需要则跳过）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_config_models.py -v`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/web_search/ apps/server/tests/web_search/
git commit -m "feat(web-search): 数据结构 + 配置加载(env 默认)"
```

---

## Task 2: Exa SSE/JSON-RPC 解析（纯函数）

**Files:**
- Modify: `apps/server/src/service/agent/web_search/parsing.py`（新建）
- Test: `apps/server/tests/web_search/test_parse_exa.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/web_search/test_parse_exa.py
from src.service.agent.web_search.parsing import parse_exa_sse

GOOD = (
    'event: message\n'
    'data: {"result":{"content":[{"type":"text","text":"Title: A\\nURL: http://a"}]},'
    '"jsonrpc":"2.0","id":1}\n\n'
)


def test_parse_single_frame():
    assert parse_exa_sse(GOOD) == "Title: A\nURL: http://a"


def test_parse_ignores_done_and_noise():
    raw = "data: [DONE]\n" "garbage line\n" + GOOD
    assert "Title: A" in parse_exa_sse(raw)


def test_parse_plain_jsonrpc_without_sse_prefix():
    raw = '{"result":{"content":[{"type":"text","text":"hello"}]},"jsonrpc":"2.0","id":1}'
    assert parse_exa_sse(raw) == "hello"


def test_parse_missing_content_returns_empty():
    assert parse_exa_sse('data: {"result":{}}\n') == ""
    assert parse_exa_sse("") == ""
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_parse_exa.py -v`
Expected: FAIL（ImportError: parse_exa_sse）

- [ ] **Step 3: 写最小实现**

```python
# apps/server/src/service/agent/web_search/parsing.py
from __future__ import annotations

import json


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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_parse_exa.py -v`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/web_search/parsing.py apps/server/tests/web_search/test_parse_exa.py
git commit -m "feat(web-search): Exa SSE/JSON-RPC 解析"
```

---

## Task 3: 必应/搜狗 HTML 解析（纯函数，先抓真样例）

> **scraping 现实**：必应/搜狗 HTML 结构会变。本任务**先抓真实 HTML 存成 fixture，确认结构后再写解析**。下面给的是基于必应长期稳定结构（`li.b_algo` → `h2>a` 标题/链接、`.b_caption p` 摘要）的起点实现；若 fixture 结构不符，按观察到的选择器调整 `_RESULT_RE`/字段正则，并让测试断言贴合 fixture。

**Files:**
- Modify: `apps/server/src/service/agent/web_search/parsing.py`
- Create (fixture): `apps/server/tests/web_search/fixtures/bing_cn.html`、`apps/server/tests/web_search/fixtures/sogou.html`
- Test: `apps/server/tests/web_search/test_parse_html.py`

- [ ] **Step 1: 抓真实 HTML 存 fixture 并观察结构**

```bash
cd apps/server && mkdir -p tests/web_search/fixtures
curl -sS -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' \
  'https://cn.bing.com/search?q=2026世界杯' -o tests/web_search/fixtures/bing_cn.html
curl -sS -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' \
  'https://www.sogou.com/web?query=2026世界杯' -o tests/web_search/fixtures/sogou.html
# 观察结果容器类名（确认 b_algo / vrwrap 等是否仍适用）
grep -o 'class="b_algo[^"]*"' tests/web_search/fixtures/bing_cn.html | head
grep -oE 'class="(vrwrap|rb|results)[^"]*"' tests/web_search/fixtures/sogou.html | head
```
> 若抓取被反爬挡（返回验证页/空），记录现象——这正是 DomesticBackend 需要兜底/换 UA 的依据；可改用浏览器另存一份正常结果页作 fixture。

- [ ] **Step 2: 写失败测试（断言贴合 fixture 的真实条目）**

```python
# apps/server/tests/web_search/test_parse_html.py
from pathlib import Path
from src.service.agent.web_search.parsing import parse_bing_html, parse_sogou_html

FIX = Path(__file__).parent / "fixtures"


def test_parse_bing_returns_results():
    html = (FIX / "bing_cn.html").read_text(encoding="utf-8", errors="ignore")
    results = parse_bing_html(html, num_results=5)
    assert len(results) >= 1
    first = results[0]
    assert first.url.startswith("http")
    assert first.title.strip()
    # 不应包含 HTML 标签残留
    assert "<" not in first.title


def test_parse_sogou_returns_results():
    html = (FIX / "sogou.html").read_text(encoding="utf-8", errors="ignore")
    results = parse_sogou_html(html, num_results=5)
    assert len(results) >= 1
    assert results[0].title.strip()


def test_parse_bing_respects_num_results():
    html = (FIX / "bing_cn.html").read_text(encoding="utf-8", errors="ignore")
    assert len(parse_bing_html(html, num_results=2)) <= 2


def test_parse_bing_empty_html():
    assert parse_bing_html("", num_results=5) == []
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_parse_html.py -v`
Expected: FAIL（ImportError: parse_bing_html）

- [ ] **Step 4: 写实现（标准库 re + html.unescape；按 fixture 校准选择器）**

```python
# 追加到 apps/server/src/service/agent/web_search/parsing.py
import html as _html
import re

from src.service.agent.web_search.models import SearchResult

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_tags(fragment: str) -> str:
    return _html.unescape(_TAG_RE.sub("", fragment)).strip()


# 必应：每条结果在 <li class="b_algo">…</li>
_BING_BLOCK_RE = re.compile(r'<li class="b_algo".*?</li>', re.S)
# 标题与链接在 <h2><a href="URL">标题</a></h2>
_BING_TITLE_RE = re.compile(r'<h2>.*?<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
# 摘要常在 <p>…</p>（b_caption 内）
_BING_SNIPPET_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.S)


def parse_bing_html(html: str, num_results: int) -> list[SearchResult]:
    out: list[SearchResult] = []
    for block in _BING_BLOCK_RE.findall(html or ""):
        m = _BING_TITLE_RE.search(block)
        if not m:
            continue
        url = _html.unescape(m.group(1))
        title = _strip_tags(m.group(2))
        if not url.startswith("http") or not title:
            continue
        sm = _BING_SNIPPET_RE.search(block)
        snippet = _strip_tags(sm.group(1)) if sm else ""
        out.append(SearchResult(title=title, url=url, snippet=snippet))
        if len(out) >= num_results:
            break
    return out


# 搜狗：结果条目容器（常见 class="vrwrap" 或 "rb"），标题在 <h3><a>
_SOGOU_BLOCK_RE = re.compile(r'<div class="(?:vrwrap|rb)[^"]*".*?</div>\s*</div>', re.S)
_SOGOU_TITLE_RE = re.compile(r'<h3[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_SOGOU_SNIPPET_RE = re.compile(
    r'<(?:p|div)[^>]+class="(?:str_info|fz-mid|space-txt|ft)[^"]*"[^>]*>(.*?)</(?:p|div)>',
    re.S,
)


def parse_sogou_html(html: str, num_results: int) -> list[SearchResult]:
    out: list[SearchResult] = []
    for block in _SOGOU_BLOCK_RE.findall(html or ""):
        m = _SOGOU_TITLE_RE.search(block)
        if not m:
            continue
        url = _html.unescape(m.group(1))
        # 搜狗常用 /link?url=... 跳转；保留原值，正文抓取时跟随重定向
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
```
> 若 fixture 显示选择器不符，**改这里的正则去贴合真实结构**，保持函数签名与返回不变；测试以 fixture 为准。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_parse_html.py -v`
Expected: PASS（4 passed）。若失败多半是选择器与真实 HTML 不符 → 回 Step 4 调正则。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/web_search/parsing.py apps/server/tests/web_search/test_parse_html.py apps/server/tests/web_search/fixtures/
git commit -m "feat(web-search): 必应/搜狗 HTML 解析(fixture 校准)"
```

---

## Task 4: HTML→正文（纯函数）

**Files:**
- Modify: `apps/server/src/service/agent/web_search/parsing.py`
- Test: `apps/server/tests/web_search/test_html_to_text.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/web_search/test_html_to_text.py
from src.service.agent.web_search.parsing import html_to_text


def test_strips_tags_scripts_styles():
    html = (
        "<html><head><style>.x{color:red}</style>"
        "<script>var a=1;</script></head>"
        "<body><h1>标题</h1><p>正文&amp;内容</p></body></html>"
    )
    text = html_to_text(html, max_chars=1000)
    assert "标题" in text and "正文&内容" in text
    assert "color:red" not in text and "var a" not in text
    assert "<" not in text


def test_collapses_whitespace_and_truncates():
    html = "<p>" + ("ab " * 100) + "</p>"
    text = html_to_text(html, max_chars=10)
    assert len(text) <= 10


def test_empty():
    assert html_to_text("", max_chars=100) == ""
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_html_to_text.py -v`
Expected: FAIL（ImportError: html_to_text）

- [ ] **Step 3: 写实现**

```python
# 追加到 apps/server/src/service/agent/web_search/parsing.py
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.S | re.I)
_WS_RE = re.compile(r"\s+")


def html_to_text(html: str, max_chars: int) -> str:
    if not html:
        return ""
    cleaned = _SCRIPT_STYLE_RE.sub(" ", html)
    cleaned = _TAG_RE.sub(" ", cleaned)
    text = _WS_RE.sub(" ", _html.unescape(cleaned)).strip()
    if max_chars > 0 and len(text) > max_chars:
        text = text[:max_chars]
    return text
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_html_to_text.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/web_search/parsing.py apps/server/tests/web_search/test_html_to_text.py
git commit -m "feat(web-search): HTML→正文 抽取"
```

---

## Task 5: ExaBackend（HTTP 客户端可注入）

**Files:**
- Create: `apps/server/src/service/agent/web_search/backends.py`
- Test: `apps/server/tests/web_search/test_exa_backend.py`

- [ ] **Step 1: 写失败测试（用 httpx.MockTransport 离线）**

```python
# apps/server/tests/web_search/test_exa_backend.py
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
```

> `pytest-asyncio` 若未装：worktree 内 `uv add --dev pytest-asyncio` 或在测试文件用 `asyncio.run()` 包装替代 `@pytest.mark.asyncio`。先确认现有 tests 是否已有 async 测试模式，沿用之。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_exa_backend.py -v`
Expected: FAIL（ImportError: ExaBackend）

- [ ] **Step 3: 写实现**

```python
# apps/server/src/service/agent/web_search/backends.py
from __future__ import annotations

import json
from typing import Callable, Protocol

import httpx

from src.service.agent.web_search.models import SearchOutcome, SearchResult
from src.service.agent.web_search.parsing import (
    parse_bing_html,
    parse_exa_sse,
    parse_sogou_html,
)
from src.utils.http_client import create_http_client

ClientFactory = Callable[[], httpx.AsyncClient]


def _default_client_factory() -> httpx.AsyncClient:
    # Exa：连接 10s / 读 25s（对齐 opencode）
    return create_http_client(timeout_connect=10.0, timeout_read=25.0)


class SearchBackend(Protocol):
    name: str

    async def search(self, query: str, num_results: int) -> SearchOutcome: ...
    async def healthcheck(self) -> bool: ...


class ExaBackend:
    name = "exa"

    def __init__(
        self,
        endpoint: str = "https://mcp.exa.ai/mcp",
        client_factory: ClientFactory | None = None,
    ):
        self.endpoint = endpoint
        self._client_factory = client_factory or _default_client_factory

    def _payload(self, query: str, num_results: int) -> dict:
        return {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "web_search_exa",
                "arguments": {
                    "query": query,
                    "numResults": num_results,
                    "type": "auto",
                    "livecrawl": "fallback",
                },
            },
        }

    async def search(self, query: str, num_results: int) -> SearchOutcome:
        async with self._client_factory() as client:
            resp = await client.post(
                self.endpoint,
                json=self._payload(query, num_results),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
            resp.raise_for_status()
            text = parse_exa_sse(resp.text)
        if not text:
            raise ValueError("Exa 返回空结果")
        return SearchOutcome(backend=self.name, text=text, results=None)

    async def healthcheck(self) -> bool:
        try:
            async with self._client_factory() as client:
                resp = await client.post(
                    self.endpoint,
                    json=self._payload("ping", 1),
                    headers={"Accept": "application/json, text/event-stream"},
                )
                return resp.status_code == 200
        except Exception:
            return False
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_exa_backend.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/web_search/backends.py apps/server/tests/web_search/test_exa_backend.py
git commit -m "feat(web-search): ExaBackend(公开 MCP, 客户端可注入)"
```

---

## Task 6: DomesticBackend（必应主 + 搜狗兜底）

**Files:**
- Modify: `apps/server/src/service/agent/web_search/backends.py`
- Test: `apps/server/tests/web_search/test_domestic_backend.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/web_search/test_domestic_backend.py
import httpx
import pytest
from src.service.agent.web_search.backends import DomesticBackend

BING_HTML = (
    '<li class="b_algo"><h2><a href="http://a.com">Alpha</a></h2>'
    '<div class="b_caption"><p>alpha 摘要</p></div></li>'
)
SOGOU_HTML = (
    '<div class="vrwrap"><h3><a href="http://b.com">Beta</a></h3>'
    '<p class="str_info">beta 摘要</p></div></div>'
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_domestic_backend.py -v`
Expected: FAIL（ImportError: DomesticBackend）

- [ ] **Step 3: 写实现（追加到 backends.py）**

```python
# 追加到 apps/server/src/service/agent/web_search/backends.py

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _default_scrape_client_factory() -> httpx.AsyncClient:
    return create_http_client(timeout_connect=10.0, timeout_read=10.0)


class DomesticBackend:
    name = "domestic"

    def __init__(self, client_factory: ClientFactory | None = None):
        self._client_factory = client_factory or _default_scrape_client_factory

    async def _fetch(self, client: httpx.AsyncClient, url: str, params: dict) -> str:
        resp = await client.get(
            url, params=params, headers={"User-Agent": _UA}, follow_redirects=True
        )
        resp.raise_for_status()
        return resp.text

    async def search(self, query: str, num_results: int) -> SearchOutcome:
        async with self._client_factory() as client:
            results: list[SearchResult] = []
            try:
                html = await self._fetch(
                    client, "https://cn.bing.com/search", {"q": query}
                )
                results = parse_bing_html(html, num_results)
            except Exception:
                results = []
            if not results:
                try:
                    html = await self._fetch(
                        client, "https://www.sogou.com/web", {"query": query}
                    )
                    results = parse_sogou_html(html, num_results)
                except Exception:
                    results = []
        if not results:
            raise ValueError("国内后端无结果（必应/搜狗均空或被拦）")
        return SearchOutcome(backend=self.name, text=None, results=results)

    async def healthcheck(self) -> bool:
        try:
            async with self._client_factory() as client:
                resp = await client.get(
                    "https://cn.bing.com/search",
                    params={"q": "ping"},
                    headers={"User-Agent": _UA},
                )
                return resp.status_code == 200
        except Exception:
            return False
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_domestic_backend.py -v`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/web_search/backends.py apps/server/tests/web_search/test_domestic_backend.py
git commit -m "feat(web-search): DomesticBackend(必应主+搜狗兜底)"
```

---

## Task 7: SearxngBackend（可选企业后端）+ ContentFetcher

**Files:**
- Modify: `apps/server/src/service/agent/web_search/backends.py`（加 SearxngBackend）
- Create: `apps/server/src/service/agent/web_search/content_fetcher.py`
- Test: `apps/server/tests/web_search/test_searxng_and_fetcher.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/web_search/test_searxng_and_fetcher.py
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_searxng_and_fetcher.py -v`
Expected: FAIL（ImportError）

- [ ] **Step 3: 写实现**

```python
# 追加到 apps/server/src/service/agent/web_search/backends.py

class SearxngBackend:
    name = "searxng"

    def __init__(self, endpoint: str, client_factory: ClientFactory | None = None):
        self.endpoint = endpoint
        self._client_factory = client_factory or _default_scrape_client_factory

    async def search(self, query: str, num_results: int) -> SearchOutcome:
        async with self._client_factory() as client:
            resp = await client.get(
                self.endpoint,
                params={"q": query, "format": "json"},
                headers={"User-Agent": _UA},
            )
            resp.raise_for_status()
            data = resp.json()
        items = data.get("results") if isinstance(data, dict) else None
        results: list[SearchResult] = []
        for it in (items or [])[:num_results]:
            if not isinstance(it, dict):
                continue
            url = str(it.get("url") or "")
            title = str(it.get("title") or "")
            if not url or not title:
                continue
            results.append(
                SearchResult(title=title, url=url, snippet=str(it.get("content") or ""))
            )
        if not results:
            raise ValueError("SearXNG 无结果")
        return SearchOutcome(backend=self.name, text=None, results=results)

    async def healthcheck(self) -> bool:
        try:
            async with self._client_factory() as client:
                resp = await client.get(
                    self.endpoint, params={"q": "ping", "format": "json"}
                )
                return resp.status_code == 200
        except Exception:
            return False
```

```python
# apps/server/src/service/agent/web_search/content_fetcher.py
from __future__ import annotations

from typing import Callable

import httpx

from src.service.agent.web_search.models import SearchResult
from src.service.agent.web_search.parsing import html_to_text
from src.utils.http_client import create_http_client

ClientFactory = Callable[[], httpx.AsyncClient]


def _default_factory() -> httpx.AsyncClient:
    return create_http_client(timeout_connect=8.0, timeout_read=8.0)


class ContentFetcher:
    def __init__(
        self,
        client_factory: ClientFactory | None = None,
        per_page_max_chars: int = 3000,
    ):
        self._client_factory = client_factory or _default_factory
        self._per_page_max_chars = per_page_max_chars

    async def enrich(
        self, results: list[SearchResult], top_n: int
    ) -> list[SearchResult]:
        async with self._client_factory() as client:
            for r in results[: max(0, top_n)]:
                try:
                    resp = await client.get(
                        r.url,
                        headers={"User-Agent": _UA},
                        follow_redirects=True,
                    )
                    resp.raise_for_status()
                    r.content = html_to_text(resp.text, self._per_page_max_chars)
                except Exception:
                    continue  # 单页失败跳过，不阻断
        return results
```

> 注：`_UA` 在 backends.py 定义；content_fetcher 内单独再定义同值常量或从 backends 导入。为避免循环导入，**在 content_fetcher.py 顶部本地定义** `_UA = "Mozilla/5.0 ..."`（与 backends 同值）。修正上面实现：补一行本地 `_UA`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_searxng_and_fetcher.py -v`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/web_search/ apps/server/tests/web_search/test_searxng_and_fetcher.py
git commit -m "feat(web-search): SearxngBackend + ContentFetcher 正文补全"
```

---

## Task 8: WebSearchService（编排/健康缓存/格式化/截断/兜底）

**Files:**
- Create: `apps/server/src/service/agent/web_search/service.py`
- Test: `apps/server/tests/web_search/test_service.py`

- [ ] **Step 1: 写失败测试（用假后端，不碰网络）**

```python
# apps/server/tests/web_search/test_service.py
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_service.py -v`
Expected: FAIL（ImportError: WebSearchService）

- [ ] **Step 3: 写实现**

```python
# apps/server/src/service/agent/web_search/service.py
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

    async def search(self, query: str, fetch_content: bool = True) -> str:
        tried: list[str] = []
        for name in self._cfg.backends:
            backend = self._backends.get(name)
            if backend is None or self._is_skipped(name):
                continue
            tried.append(name)
            try:
                outcome = await backend.search(query, self._cfg.num_results)
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_service.py -v`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/web_search/service.py apps/server/tests/web_search/test_service.py
git commit -m "feat(web-search): WebSearchService(降级链+健康缓存+透传/格式化+截断)"
```

---

## Task 9: 工具封装 + 接入 worker

**Files:**
- Modify: `apps/server/src/service/agent/web_search/tool.py`（替换占位）
- Modify: `apps/server/src/service/agent/employee.py`
- Test: `apps/server/tests/web_search/test_tool.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/web_search/test_tool.py
from src.service.agent.web_search.tool import create_web_search_tool


def test_create_returns_langchain_tool():
    tool = create_web_search_tool()
    assert tool.name == "web_search"
    assert "联网搜索" in (tool.description or "")


def test_tool_invoke_runs_service(monkeypatch):
    import src.service.agent.web_search.tool as toolmod

    async def fake_search(self, query, fetch_content=True):
        return f"FAKE::{query}::{fetch_content}"

    monkeypatch.setattr(toolmod.WebSearchService, "search", fake_search)
    tool = create_web_search_tool()
    result = tool.invoke({"query": "世界杯", "fetch_content": True})
    assert result == "FAKE::世界杯::True"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && uv run pytest tests/web_search/test_tool.py -v`
Expected: FAIL（占位 create_web_search_tool 抛 NotImplementedError）

- [ ] **Step 3: 写实现（替换占位 tool.py）**

```python
# apps/server/src/service/agent/web_search/tool.py
from __future__ import annotations

import asyncio

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
    backends: dict = {}
    for name in cfg.backends:
        if name == "exa":
            backends["exa"] = ExaBackend(endpoint=cfg.exa_endpoint)
        elif name == "domestic":
            backends["domestic"] = DomesticBackend()
        elif name == "searxng" and cfg.searxng_endpoint:
            backends["searxng"] = SearxngBackend(endpoint=cfg.searxng_endpoint)
    return WebSearchService(cfg, backends=backends)


def create_web_search_tool():
    service = _build_service()

    @tool
    def web_search(query: str, num_results: int = 8, fetch_content: bool = True) -> str:
        """联网搜索并返回结果摘要（含前几条正文）。需要查最新/外部信息时用本工具，
        比开浏览器更快更稳。要对某个具体网页做点击/填表等交互，才用 browser-runtime 技能。

        Args:
            query: 搜索关键词
            num_results: 期望结果条数（默认 8）
            fetch_content: 是否抓取前几条正文（默认 True；只要链接/摘要可设 False 更快）
        """
        try:
            return asyncio.run(service.search(query, fetch_content=fetch_content))
        except RuntimeError:
            # 已在事件循环内（agent 异步上下文）：用独立循环跑
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(
                    service.search(query, fetch_content=fetch_content)
                )
            finally:
                loop.close()

    return web_search
```

> **注意**：`num_results` 暴露给模型但当前 service 用 config 的 `num_results`。本期保持简单：参数作提示，实际条数走配置。若要让参数生效，后续在 `service.search` 增 `num_results` 透传（YAGNI，暂不做）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && uv run pytest tests/web_search/test_tool.py -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 接入 employee.py**

在 `apps/server/src/service/agent/employee.py` import 区（约 line 22 `get_current_time_tool` 附近）加：
```python
from src.service.agent.web_search import create_web_search_tool
```
在 `extra_tools = [...]`（约 line 246-253）之后、`if employee_id is not None:` 之前加：
```python
    extra_tools.append(create_web_search_tool())
```

- [ ] **Step 6: 跑全量 web_search 测试 + 冒烟**

Run: `cd apps/server && uv run pytest tests/web_search/ -v`
Expected: 全 PASS。
Run（import 冒烟，确认 employee.py 无语法/循环导入问题）: `cd apps/server && uv run python -c "from src.service.agent.employee import get_agent; print('ok')"`
Expected: 打印 `ok`

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/service/agent/web_search/tool.py apps/server/src/service/agent/employee.py apps/server/tests/web_search/test_tool.py
git commit -m "feat(web-search): web_search 一等工具 + 接入 worker extra_tools"
```

---

## Task 10: 连通性自检 CLI

**Files:**
- Create: `apps/server/src/service/agent/web_search/__main__.py`
- Test: 手动运行（网络相关，不纳入 CI）

- [ ] **Step 1: 写实现**

```python
# apps/server/src/service/agent/web_search/__main__.py
"""连通性自检：在真实部署环境跑一次，确认各后端是否可达。

用法：cd apps/server && uv run python -m src.service.agent.web_search "查询词"
"""
from __future__ import annotations

import asyncio
import sys
import time

from src.service.agent.web_search.backends import (
    DomesticBackend,
    ExaBackend,
    SearxngBackend,
)
from src.service.agent.web_search.config import load_web_search_config


async def _probe(name: str, backend, query: str) -> None:
    t0 = time.monotonic()
    try:
        healthy = await backend.healthcheck()
    except Exception as exc:  # noqa: BLE001
        print(f"[{name}] healthcheck 异常: {exc}")
        return
    dt = time.monotonic() - t0
    print(f"[{name}] healthcheck={'OK' if healthy else 'FAIL'} ({dt:.2f}s)")
    if not healthy:
        return
    try:
        outcome = await backend.search(query, 3)
        n = len(outcome.results) if outcome.results else ("text" if outcome.text else 0)
        print(f"[{name}] search OK → {n} 条/块")
    except Exception as exc:  # noqa: BLE001
        print(f"[{name}] search 失败: {exc}")


async def _main() -> None:
    query = sys.argv[1] if len(sys.argv) > 1 else "2026世界杯"
    cfg = load_web_search_config()
    print(f"配置后端顺序: {cfg.backends}  exa={cfg.exa_endpoint}  searxng={cfg.searxng_endpoint or '(未配)'}")
    probes = {
        "exa": ExaBackend(endpoint=cfg.exa_endpoint),
        "domestic": DomesticBackend(),
    }
    if cfg.searxng_endpoint:
        probes["searxng"] = SearxngBackend(endpoint=cfg.searxng_endpoint)
    for name, be in probes.items():
        await _probe(name, be, query)


if __name__ == "__main__":
    asyncio.run(_main())
```

- [ ] **Step 2: 手动运行验证（开发机）**

Run: `cd apps/server && uv run python -m src.service.agent.web_search "2026世界杯"`
Expected: 逐后端打印 healthcheck/search 结果。开发机上 exa 应 OK；记录实际输出供"真实部署环境再跑一次"参照。

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/service/agent/web_search/__main__.py
git commit -m "feat(web-search): 连通性自检 CLI(python -m ...web_search)"
```

---

## 收尾验证

- [ ] 全量测试：`cd apps/server && uv run pytest tests/web_search/ -v` 全绿
- [ ] 类型/格式（若项目有）：按仓库习惯跑 lint
- [ ] 自检脚本在开发机跑通，输出存档
- [ ] 真实部署环境跑一次 `python -m src.service.agent.web_search`，据结果决定是否调整 `WEB_SEARCH_BACKENDS`（如终端连不上 exa → 设 `domestic` 或 `searxng,domestic`）

---

## Self-Review 记录

- **Spec 覆盖**：Exa 主力(T5)、国内兜底(T6)、SearXNG 可选(T7)、正文补全(T7)、编排/健康缓存/降级/兜底(T8)、透传+格式化+字节字符截断(T8)、一等工具不走技能发现+接入 worker(T9)、配置项(T1)、连通性自检(T10)、HTML 解析优先标准库(T3/T4)。全部有对应任务。
- **占位扫描**：无 TBD；T1 的占位 tool.py 在 T9 被真实实现替换，已显式说明。
- **类型一致**：`SearchResult`/`SearchOutcome`(T1) 贯穿全程；`ClientFactory` 在 backends/content_fetcher 各自定义同型；`create_web_search_tool` 在 `__init__`(T1) 导出、T9 实现，名称一致。
- **已知风险**：T3 国内 HTML 选择器依赖真实页面，已用"先抓 fixture 再校准"消解；Exa 终端可达性靠 T10 自检在真实环境确认。
