from __future__ import annotations

from dataclasses import dataclass


@dataclass
class _FakeWatch:
    session_id: str
    conversation_id: int
    target_type: str = "curator"
    status: str = "watching"


class _FakeWatchRegistry:
    def __init__(self, watches):
        self._watches = {w.session_id: w for w in watches}
        self.fired = []
        self.dropped = []
        self.swept = 0

    def list_watching(self):
        return [w for w in self._watches.values() if w.status == "watching"]

    def mark_fired(self, sid):
        self.fired.append(sid)
        self._watches.pop(sid, None)

    def drop(self, sid):
        self.dropped.append(sid)
        self._watches.pop(sid, None)

    def sweep_stale(self, max_age_seconds=86400):
        self.swept += 1
        return 0


class _FakeShellRegistry:
    def __init__(self, poll_results):
        self._poll = poll_results  # sid -> dict

    def poll(self, sid):
        return self._poll.get(sid, {"found": False})


class _FakeStreamRegistry:
    def __init__(self, busy_ids):
        self._busy = set(busy_ids)

    def is_busy(self, conv_id):
        return conv_id in self._busy


def _scan(**kw):
    from src.service.background_wakeup_scanner import scan_and_wake
    return scan_and_wake(**kw)


def test_finished_idle_session_wakes_and_marks_fired():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": False,
                                           "exit_code": 0, "new_output": "done"}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    res = _scan(shell_registry=shell_reg, watch_registry=watch_reg,
                stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == ["s1"]
    assert watch_reg.fired == ["s1"]
    assert res["woke"] == 1


def test_finished_busy_session_skipped_and_kept():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": False,
                                           "exit_code": 0, "new_output": ""}})
    stream_reg = _FakeStreamRegistry(busy_ids=[10])  # 会话忙
    res = _scan(shell_registry=shell_reg, watch_registry=watch_reg,
                stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == []
    assert watch_reg.fired == []
    assert watch_reg.list_watching()  # 仍保留
    assert res["skipped_busy"] == 1


def test_running_session_not_woken():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": True}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    _scan(shell_registry=shell_reg, watch_registry=watch_reg,
          stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == []
    assert watch_reg.list_watching()


def test_not_found_session_dropped():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": False}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    _scan(shell_registry=shell_reg, watch_registry=watch_reg,
          stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == []
    assert watch_reg.dropped == ["s1"]


def test_wake_fn_exception_drops_watch():
    def boom(w, r):
        raise RuntimeError("boom")
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": False,
                                           "exit_code": 0, "new_output": ""}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    res = _scan(shell_registry=shell_reg, watch_registry=watch_reg,
                stream_registry=stream_reg, wake_fn=boom)
    assert watch_reg.dropped == ["s1"]
    assert res["woke"] == 0


def test_sweep_stale_called():
    watch_reg = _FakeWatchRegistry([])
    shell_reg = _FakeShellRegistry({})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    _scan(shell_registry=shell_reg, watch_registry=watch_reg,
          stream_registry=stream_reg, wake_fn=lambda w, r: None)
    assert watch_reg.swept == 1
