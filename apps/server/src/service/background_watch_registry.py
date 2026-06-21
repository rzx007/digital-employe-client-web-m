"""后台命令完成唤醒的 watch 登记表：模型调 watch_background 登记「某 session 跑完唤醒本会话」，
apscheduler 扫描器读它。自存 conversation_id + target_type，不依赖 shell 注册表的会话归属。进程级单例。"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

_STALE_MAX_AGE_SECONDS = 86400  # 24h 废条目兜底清理


@dataclass
class _Watch:
    session_id: str
    conversation_id: int
    target_type: str  # "curator" | "employee"
    created_at: float = field(default_factory=time.monotonic)
    status: str = "watching"  # watching | fired


class BackgroundWatchRegistry:
    def __init__(self) -> None:
        self._watches: dict[str, _Watch] = {}
        self._lock = threading.Lock()

    def register_watch(self, *, session_id: str, conversation_id: int,
                       target_type: str) -> None:
        with self._lock:
            self._watches[session_id] = _Watch(
                session_id=session_id,
                conversation_id=conversation_id,
                target_type=target_type,
            )

    def list_watching(self) -> list[_Watch]:
        with self._lock:
            return [w for w in self._watches.values() if w.status == "watching"]

    def mark_fired(self, session_id: str) -> None:
        with self._lock:
            self._watches.pop(session_id, None)

    def drop(self, session_id: str) -> None:
        with self._lock:
            self._watches.pop(session_id, None)

    def sweep_stale(self, max_age_seconds: int = _STALE_MAX_AGE_SECONDS) -> int:
        now = time.monotonic()
        with self._lock:
            stale = [sid for sid, w in self._watches.items()
                     if now - w.created_at > max_age_seconds]
            for sid in stale:
                self._watches.pop(sid, None)
        return len(stale)


_GLOBAL_WATCH_REGISTRY: BackgroundWatchRegistry | None = None
_GLOBAL_LOCK = threading.Lock()


def get_background_watch_registry() -> BackgroundWatchRegistry:
    global _GLOBAL_WATCH_REGISTRY
    if _GLOBAL_WATCH_REGISTRY is None:
        with _GLOBAL_LOCK:
            if _GLOBAL_WATCH_REGISTRY is None:
                _GLOBAL_WATCH_REGISTRY = BackgroundWatchRegistry()
    return _GLOBAL_WATCH_REGISTRY
