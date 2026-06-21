from __future__ import annotations


def _fresh_registry():
    # 每个测试用独立实例，避免全局单例串味
    from src.service.background_watch_registry import BackgroundWatchRegistry
    return BackgroundWatchRegistry()


def test_register_and_list_watching():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    watching = reg.list_watching()
    assert len(watching) == 1
    assert watching[0].session_id == "s1"
    assert watching[0].conversation_id == 10
    assert watching[0].target_type == "curator"
    assert watching[0].status == "watching"


def test_register_same_session_overwrites():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    reg.register_watch(session_id="s1", conversation_id=11, target_type="employee")
    watching = reg.list_watching()
    assert len(watching) == 1
    assert watching[0].conversation_id == 11
    assert watching[0].target_type == "employee"


def test_mark_fired_removes_from_watching():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    reg.mark_fired("s1")
    assert reg.list_watching() == []


def test_drop_removes_entry():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    reg.drop("s1")
    assert reg.list_watching() == []


def test_sweep_stale_removes_old_entries(monkeypatch):
    import src.service.background_watch_registry as mod
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    w = reg.list_watching()[0]
    w.created_at = 0.0  # monotonic 远古
    removed = reg.sweep_stale(max_age_seconds=1)
    assert removed == 1
    assert reg.list_watching() == []


def test_singleton_accessor_returns_same_instance():
    from src.service.background_watch_registry import get_background_watch_registry
    a = get_background_watch_registry()
    b = get_background_watch_registry()
    assert a is b
