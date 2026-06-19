from src.service.group_room_service import GroupRoomService, _conclusion_kind


class _FakeMsg:
    def __init__(self, content):
        self.content = content


def test_conclusion_completed_carries_delivered_milestone(monkeypatch):
    """成员流完成 → 投影消息 extra_meta 带 role=worker + milestone.kind=delivered。"""
    captured = {}

    def _fake_post(db, room, *, role, content, sender_id, sender_label,
                   extra_meta=None, **kw):
        captured["role"] = role
        captured["extra_meta"] = extra_meta
        captured["content"] = content
        return _FakeMsg(content)

    monkeypatch.setattr(GroupRoomService, "post_to_timeline", staticmethod(_fake_post))
    monkeypatch.setattr(GroupRoomService, "update_member_state", staticmethod(lambda *a, **k: None))

    GroupRoomService._project_member_milestone(
        room=object(), db=None, member_employee_id=7, sender_label="张三",
        member_conversation_id=42, kind="delivered", text="文案已完成",
        artifacts=["a/report.md"],
    )

    assert captured["extra_meta"]["role"] == "worker"
    assert captured["extra_meta"]["milestone"]["kind"] == "delivered"
    assert captured["extra_meta"]["milestone"]["artifacts"] == ["a/report.md"]


def test_conclusion_kind_maps_status_to_milestone_kind():
    """终态→kind 映射：completed=delivered, cancelled=cancelled,
    interrupted/error 都归 failed（粗粒度桶，精确语义在文案 body）。"""
    assert _conclusion_kind("completed") == "delivered"
    assert _conclusion_kind("cancelled") == "cancelled"
    assert _conclusion_kind("interrupted") == "failed"
    assert _conclusion_kind("error") == "failed"


def test_dispatch_emits_accepted_milestone():
    from src.service.group_room_service import _build_accepted_milestone_text
    text = _build_accepted_milestone_text("帮我写一份关于X的市场调研报告并给出结论建议")
    assert text.startswith("收到")
    assert len(text) <= 40


def test_schedule_stream_start_fires_on_started_only_when_not_rejected(monkeypatch):
    """on_started 仅在非 REJECTED 时触发（accepted 不会为僵尸流误报）。"""
    import src.service.group_room_service as grs
    from src.service.agent_stream_queue import StartResult

    calls = []
    calls_result = {"v": None}

    class _FakeRegistry:
        def request_start(self, **kw):
            return calls_result["v"]

    # request_start 经 from src.service.stream_registry import registry 在
    # _schedule_stream_start 内部引用 → 打 stream_registry 模块属性即可。
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr, "registry", _FakeRegistry())
    # 强制走同步兜底分支（取不到主循环 → 直接 _do_start()）
    import src.service.agent.orchestrator.runtime as rt

    def _boom():
        raise RuntimeError("no loop in test")

    monkeypatch.setattr(rt, "get_main_loop", _boom)

    # 非 REJECTED → 触发
    calls_result["v"] = StartResult.STARTED
    grs._schedule_stream_start(
        conversation_id=1, agent=object(), messages=[], stream_msg_id=2,
        source="test", on_started=lambda: calls.append("ok"),
    )
    assert calls == ["ok"]

    # REJECTED → 不触发
    calls.clear()
    calls_result["v"] = StartResult.REJECTED
    monkeypatch.setattr(grs, "unregister_group_stream_relay", lambda *a, **k: None)
    monkeypatch.setattr(sr, "_mark_stream_state_sync", lambda *a, **k: None, raising=False)
    grs._schedule_stream_start(
        conversation_id=1, agent=object(), messages=[], stream_msg_id=2,
        source="test", on_started=lambda: calls.append("ok"),
    )
    assert calls == []
