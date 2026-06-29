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
