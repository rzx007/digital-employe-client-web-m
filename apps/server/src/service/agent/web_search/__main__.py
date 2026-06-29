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
