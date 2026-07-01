"""Hanhai 本地模型并发压测脚本。

直接绕过 server 端，对 hanhai 的 OpenAI 兼容接口发起 N 路并发流式请求，
测量每路的 TTFT（首 token 延迟）、总耗时、输出 token 数和 token/s 吞吐。

用法：
    python scripts/bench-hanhai.py --concurrency 1
    python scripts/bench-hanhai.py --concurrency 4 --prompt "讲一个关于猫的故事，要详细"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from dataclasses import dataclass
from statistics import mean, median

import httpx


@dataclass
class Result:
    idx: int
    ttft: float
    total: float
    tokens: int
    error: str | None = None

    @property
    def tps(self) -> float:
        gen = self.total - self.ttft
        return self.tokens / gen if gen > 0 and self.tokens > 0 else 0.0


async def one_request(
    client: httpx.AsyncClient,
    idx: int,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    max_tokens: int,
) -> Result:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "max_tokens": max_tokens,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    start = time.perf_counter()
    ttft = 0.0
    tokens = 0
    try:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            json=payload,
            headers=headers,
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0),
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                return Result(idx, 0, 0, 0, error=f"HTTP {resp.status_code}: {body.decode(errors='ignore')[:200]}")
            async for raw_line in resp.aiter_lines():
                line = raw_line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content") or ""
                if content:
                    if tokens == 0:
                        ttft = time.perf_counter() - start
                    tokens += 1
    except Exception as exc:
        return Result(idx, 0, time.perf_counter() - start, tokens, error=f"{type(exc).__name__}: {exc}")
    total = time.perf_counter() - start
    return Result(idx, ttft, total, tokens)


async def bench(args: argparse.Namespace) -> None:
    async with httpx.AsyncClient(http2=False) as client:
        t0 = time.perf_counter()
        tasks = [
            one_request(
                client,
                i,
                args.base_url,
                args.api_key,
                args.model,
                args.prompt,
                args.max_tokens,
            )
            for i in range(args.concurrency)
        ]
        results = await asyncio.gather(*tasks)
        wall = time.perf_counter() - t0

    ok = [r for r in results if r.error is None and r.tokens > 0]
    fail = [r for r in results if r not in ok]

    print(f"\n=== Hanhai 并发压测结果 (concurrency={args.concurrency}) ===")
    print(f"endpoint: {args.base_url} | model: {args.model}")
    print(f"prompt: {args.prompt!r} | max_tokens={args.max_tokens}")
    print(f"wall_clock: {wall:.2f}s | ok: {len(ok)} | fail: {len(fail)}")
    print()
    print(f"{'idx':>4} {'ttft(s)':>9} {'total(s)':>10} {'tokens':>7} {'tok/s':>7}  err")
    for r in results:
        if r.error:
            print(f"{r.idx:>4} {'-':>9} {r.total:>10.2f} {r.tokens:>7} {'-':>7}  {r.error[:80]}")
        else:
            print(f"{r.idx:>4} {r.ttft:>9.3f} {r.total:>10.2f} {r.tokens:>7} {r.tps:>7.1f}")

    if ok:
        ttfts = [r.ttft for r in ok]
        totals = [r.total for r in ok]
        tpss = [r.tps for r in ok]
        print()
        print(f"TTFT  avg={mean(ttfts):.3f}s  median={median(ttfts):.3f}s  min={min(ttfts):.3f}s  max={max(ttfts):.3f}s")
        print(f"TOTAL avg={mean(totals):.2f}s  median={median(totals):.2f}s")
        print(f"TPS   avg={mean(tpss):.1f}    median={median(tpss):.1f}   min={min(tpss):.1f}   max={max(tpss):.1f}")
        total_tokens = sum(r.tokens for r in ok)
        print(f"aggregate throughput: {total_tokens / wall:.1f} tok/s across {len(ok)} streams")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://localhost:12345/v1")
    p.add_argument("--api-key", default="1")
    p.add_argument("--model", default="Hanhai")
    p.add_argument("--prompt", default="请用 200 字左右介绍一下你自己。")
    p.add_argument("--concurrency", type=int, default=1)
    p.add_argument("--max-tokens", type=int, default=256)
    asyncio.run(bench(p.parse_args()))


if __name__ == "__main__":
    main()
