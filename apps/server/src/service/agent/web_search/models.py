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
