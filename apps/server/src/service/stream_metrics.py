"""Agent 流执行的轻量级指标收集。

记录每条流的 TTFT、总耗时、token 数（按 chunk 计）和最终状态。
保留最近 N 条历史 + 当前在飞流，用于 /system/runtime 监控面板。
线程安全；不引入任何外部依赖。
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Any


_MAX_HISTORY = 100


@dataclass
class StreamRecord:
    conversation_id: int
    source: str
    started_at: float
    started_mono: float
    first_token_mono: float | None = None
    finished_mono: float | None = None
    tokens: int = 0
    status: str | None = None
    error: str | None = None

    @property
    def ttft_ms(self) -> int | None:
        if self.first_token_mono is None:
            return None
        return int((self.first_token_mono - self.started_mono) * 1000)

    @property
    def total_ms(self) -> int | None:
        if self.finished_mono is None:
            return None
        return int((self.finished_mono - self.started_mono) * 1000)

    @property
    def tps(self) -> float | None:
        if (
            self.tokens <= 0
            or self.first_token_mono is None
            or self.finished_mono is None
        ):
            return None
        gen = self.finished_mono - self.first_token_mono
        if gen <= 0:
            return None
        return round(self.tokens / gen, 1)

    def to_dict(self) -> dict[str, Any]:
        return {
            "conversation_id": self.conversation_id,
            "source": self.source,
            "started_at": self.started_at,
            "ttft_ms": self.ttft_ms,
            "total_ms": self.total_ms,
            "tokens": self.tokens,
            "tps": self.tps,
            "status": self.status,
            "error": self.error,
        }


class StreamMetrics:
    def __init__(self, max_history: int = _MAX_HISTORY) -> None:
        self._lock = threading.Lock()
        self._inflight: dict[int, StreamRecord] = {}
        self._history: deque[StreamRecord] = deque(maxlen=max_history)

    def record_start(self, conversation_id: int, source: str) -> None:
        rec = StreamRecord(
            conversation_id=conversation_id,
            source=source,
            started_at=time.time(),
            started_mono=time.monotonic(),
        )
        with self._lock:
            self._inflight[conversation_id] = rec

    def get_started_at(self, conversation_id: int) -> float | None:
        """当前在飞流的 wall-clock 启动时间（time.time()），无则 None。"""
        with self._lock:
            rec = self._inflight.get(conversation_id)
            return rec.started_at if rec is not None else None

    def record_first_token(self, conversation_id: int) -> None:
        with self._lock:
            rec = self._inflight.get(conversation_id)
            if rec is not None and rec.first_token_mono is None:
                rec.first_token_mono = time.monotonic()

    def add_tokens(self, conversation_id: int, n: int = 1) -> None:
        if n <= 0:
            return
        with self._lock:
            rec = self._inflight.get(conversation_id)
            if rec is not None:
                rec.tokens += n

    def record_finish(
        self,
        conversation_id: int,
        status: str,
        error: str | None = None,
    ) -> None:
        with self._lock:
            rec = self._inflight.pop(conversation_id, None)
            if rec is None:
                return
            rec.finished_mono = time.monotonic()
            rec.status = status
            rec.error = error
            self._history.append(rec)

    def snapshot(self) -> dict[str, Any]:
        now_mono = time.monotonic()
        with self._lock:
            inflight = [
                {
                    "conversation_id": rec.conversation_id,
                    "source": rec.source,
                    "started_at": rec.started_at,
                    "elapsed_ms": int((now_mono - rec.started_mono) * 1000),
                    "ttft_ms": rec.ttft_ms,
                    "tokens": rec.tokens,
                }
                for rec in self._inflight.values()
            ]
            history = [r.to_dict() for r in self._history]
        history_recent = history[-20:]
        history_recent.reverse()
        return {
            "inflight": inflight,
            "recent": history_recent,
            "summary": self._summarize(history),
        }

    @staticmethod
    def _summarize(history: list[dict[str, Any]]) -> dict[str, Any]:
        if not history:
            return {"count": 0}
        ttfts = sorted(
            h["ttft_ms"] for h in history if h.get("ttft_ms") is not None
        )
        totals = sorted(
            h["total_ms"] for h in history if h.get("total_ms") is not None
        )
        tpss = [h["tps"] for h in history if h.get("tps") is not None]
        errors = sum(1 for h in history if h.get("status") not in (None, "completed"))

        def pct(arr: list[int], p: int) -> int | None:
            if not arr:
                return None
            k = max(0, min(len(arr) - 1, int(round(p / 100 * (len(arr) - 1)))))
            return arr[k]

        return {
            "count": len(history),
            "non_completed": errors,
            "ttft_ms": {
                "p50": pct(ttfts, 50),
                "p95": pct(ttfts, 95),
                "max": ttfts[-1] if ttfts else None,
            },
            "total_ms": {
                "p50": pct(totals, 50),
                "p95": pct(totals, 95),
                "max": totals[-1] if totals else None,
            },
            "tps_avg": round(sum(tpss) / len(tpss), 1) if tpss else None,
        }


metrics = StreamMetrics()
