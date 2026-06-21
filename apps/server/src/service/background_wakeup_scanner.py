"""后台命令完成唤醒扫描器：apscheduler 周期调 scan_and_wake，发现 watch 的进程已结束且会话空闲时
触发续跑。依赖（shell_registry/watch_registry/stream_registry/wake_fn）可注入，便于单测。"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def scan_and_wake(*, shell_registry=None, watch_registry=None,
                  stream_registry=None, wake_fn=None) -> dict:
    if shell_registry is None:
        from src.service.shell_background_registry import get_background_shell_registry
        shell_registry = get_background_shell_registry()
    if watch_registry is None:
        from src.service.background_watch_registry import get_background_watch_registry
        watch_registry = get_background_watch_registry()
    if stream_registry is None:
        from src.service.stream_registry import registry as stream_registry  # 实现时确认导出名
    if wake_fn is None:
        wake_fn = _default_wake_fn

    scanned = woke = skipped_busy = dropped = 0
    for w in watch_registry.list_watching():
        scanned += 1
        r = shell_registry.poll(w.session_id)
        if not r.get("found"):
            watch_registry.drop(w.session_id)
            dropped += 1
            continue
        if r.get("running"):
            continue
        # finished
        if stream_registry.is_busy(w.conversation_id):
            skipped_busy += 1
            continue
        try:
            wake_fn(w, r)
        except Exception:
            logger.warning("[bg-wake] wake_fn failed sid=%s", w.session_id, exc_info=True)
            watch_registry.drop(w.session_id)
            dropped += 1
            continue
        watch_registry.mark_fired(w.session_id)
        woke += 1

    watch_registry.sweep_stale()
    return {"scanned": scanned, "woke": woke,
            "skipped_busy": skipped_busy, "dropped": dropped}


def _default_wake_fn(watch, poll_result) -> None:  # 下个 task 实现
    raise NotImplementedError
