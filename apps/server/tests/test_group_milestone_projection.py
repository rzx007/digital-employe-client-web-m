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


def test_milestone_debouncer_collapses_rapid_progress():
    from src.service.group_room_service import _MilestoneDebouncer
    d = _MilestoneDebouncer(min_interval_s=3.0)
    now = 1000.0
    assert d.allow(conv_id=42, kind="progress", text="A", now=now) is True
    # 同会话同类短时间内第二条被抑制
    assert d.allow(conv_id=42, kind="progress", text="B", now=now + 1) is False
    # 超过间隔后放行
    assert d.allow(conv_id=42, kind="progress", text="C", now=now + 4) is True
    # 重复文本永远抑制
    assert d.allow(conv_id=42, kind="progress", text="C", now=now + 100) is False
    # accepted/delivered 不参与去抖，永远放行
    assert d.allow(conv_id=42, kind="delivered", text="done", now=now + 4.1) is True
    assert d.allow(conv_id=42, kind="accepted", text="x", now=now + 4.2) is True


def test_diff_completed_todos_detects_new_completions():
    from src.service.group_room_service import _diff_completed_todos
    prev = [
        {"content": "检索资料", "status": "completed"},
        {"content": "起草", "status": "in_progress"},
    ]
    cur = [
        {"content": "检索资料", "status": "completed"},
        {"content": "起草", "status": "completed"},
        {"content": "校对", "status": "in_progress"},
    ]
    newly = _diff_completed_todos(prev, cur)
    assert newly == ["起草"]


def test_diff_completed_todos_handles_empty_and_none():
    from src.service.group_room_service import _diff_completed_todos
    assert _diff_completed_todos(None, None) == []
    assert _diff_completed_todos([], [{"content": "A", "status": "completed"}]) == ["A"]
    # 已完成的不重复报
    assert _diff_completed_todos(
        [{"content": "A", "status": "completed"}],
        [{"content": "A", "status": "completed"}],
    ) == []


def _make_updates_event(todos):
    """构造一个与真实流一致的 updates 事件（buffer 包了一层 {seq,data}）。

    成员流 stream_mode=["messages","updates","custom"]，updates 事件携带完整、
    已解析的 tool_calls.args。AIMessage 走 LC constructor 序列化，todos 在
    kwargs.tool_calls[].args.todos（节点名不固定，这里用 'model'）。
    """
    ai_msg = {
        "type": "constructor",
        "id": ["langchain", "schema", "messages", "AIMessage"],
        "kwargs": {
            "content": "",
            "tool_calls": [
                {"name": "write_todos", "args": {"todos": todos}, "id": "tc1"}
            ],
        },
    }
    return {
        "seq": 1,
        "data": {
            "type": "updates",
            "data": {"model": {"messages": [ai_msg]}},
        },
    }


def test_extract_write_todos_from_event_reads_updates_tool_args():
    from src.service.group_room_service import _extract_write_todos_from_event
    todos = [
        {"content": "检索资料", "status": "completed"},
        {"content": "起草", "status": "in_progress"},
    ]
    evt = _make_updates_event(todos)
    assert _extract_write_todos_from_event(evt["data"]) == todos
    # messages 模式 / 非 write_todos / 无 tool_calls 一律 None
    assert _extract_write_todos_from_event({"type": "messages", "data": []}) is None
    assert _extract_write_todos_from_event({"type": "updates", "data": {}}) is None


def test_on_event_projects_progress_for_newly_completed_todos(monkeypatch):
    """驱动 _attach_projector 注册的 _on_event：write_todos 里某条新 completed →
    调 _project_progress_milestone 投 progress；已完成的不重复、in_progress 不投。"""
    import src.service.stream_registry as sr
    from src.service.group_room_service import GroupRoomService

    captured = []
    monkeypatch.setattr(
        GroupRoomService,
        "_project_progress_milestone",
        staticmethod(lambda room_id, member_id, conv_id, content: captured.append(content)),
    )

    # 假 task：只需 subscribe 能把 _on_event 收下来供我们手动喂事件。
    class _FakeTask:
        def __init__(self):
            self.fn = None

        def subscribe(self, fn):
            self.fn = fn

    fake = _FakeTask()
    monkeypatch.setitem(sr.registry._tasks, 999, fake)

    GroupRoomService._attach_projector(room_id=1, member_id=2, member_conv_id=999)
    assert fake.fn is not None

    # 第 1 个事件：「检索资料」已 completed、「起草」in_progress → 投「检索资料」
    fake.fn(_make_updates_event([
        {"content": "检索资料", "status": "completed"},
        {"content": "起草", "status": "in_progress"},
    ]))
    # 第 2 个事件：「起草」也 completed → 只新投「起草」（检索资料不重复）
    fake.fn(_make_updates_event([
        {"content": "检索资料", "status": "completed"},
        {"content": "起草", "status": "completed"},
        {"content": "校对", "status": "in_progress"},
    ]))

    assert captured == ["检索资料", "起草"]
