from src.service.group_room_service import GroupRoomService


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


def test_relay_group_todo_progress_projects_once_per_new_completion(monkeypatch):
    """LIVE 钩子 relay_group_todo_progress：已登记的群流里 write_todos 出现新完成项
    → 投 progress 里程碑；同一完成项重复喂 → 不再投（prev-todos diff + 去抖）。"""
    import time as _time
    import src.service.group_room_service as grs
    from src.service.group_room_service import (
        GroupRoomService,
        relay_group_todo_progress,
        register_group_stream_relay,
        unregister_group_stream_relay,
    )

    captured = []

    monkeypatch.setattr(
        GroupRoomService,
        "_project_member_milestone",
        staticmethod(lambda **kw: captured.append((kw.get("kind"), kw.get("text")))),
    )
    # 投影内部会 db.get(GroupRoom, ...)；本路径走 registry 直投不需真 room，
    # 但 inline 实现里会开 session 取 room → 打桩 get_session_local 返回假 session。
    class _FakeSession:
        def get(self, *a, **k):
            return object()

        def close(self):
            pass

    import src.db.session as _dbsess
    monkeypatch.setattr(_dbsess, "get_session_local", lambda: (lambda: _FakeSession()))

    # 重置去抖器状态，避免跨测试污染
    grs._milestone_debouncer._last_ts.clear()
    grs._milestone_debouncer._seen_text.clear()

    conv_id = 7777
    register_group_stream_relay(
        conv_id,
        room_id=1,
        room_conversation_id=10,
        workspace_id=100,
        sender_id=5,
        sender_label="李四",
    )
    try:
        # 新完成「检索资料」→ 投一次
        relay_group_todo_progress(conv_id, _make_updates_event([
            {"content": "检索资料", "status": "completed"},
            {"content": "起草", "status": "in_progress"},
        ])["data"])
        # 同一完成项再喂 → 不重复投（diff + 去抖）
        relay_group_todo_progress(conv_id, _make_updates_event([
            {"content": "检索资料", "status": "completed"},
            {"content": "起草", "status": "in_progress"},
        ])["data"])

        assert len(captured) == 1
        assert captured[0][0] == "progress"
        assert "检索资料" in captured[0][1]
    finally:
        unregister_group_stream_relay(conv_id)


def test_relay_group_todo_progress_noop_for_unregistered_conv(monkeypatch):
    """未登记的会话（非群流）→ 快速 no-op，不做任何投影。"""
    import src.service.group_room_service as grs
    from src.service.group_room_service import GroupRoomService, relay_group_todo_progress

    captured = []
    monkeypatch.setattr(
        GroupRoomService,
        "_project_member_milestone",
        staticmethod(lambda **kw: captured.append(kw)),
    )

    # 确保该 conv 未登记
    grs._GROUP_STREAM_RELAY.pop(123456, None)
    relay_group_todo_progress(123456, _make_updates_event([
        {"content": "X", "status": "completed"},
    ])["data"])
    assert captured == []


def test_unregister_relay_clears_todo_prev_state():
    """注销中继时同步清理 _GROUP_TODO_PREV，防止跨会话/重用 conv_id 残留。"""
    import src.service.group_room_service as grs
    from src.service.group_room_service import unregister_group_stream_relay

    grs._GROUP_TODO_PREV[55555] = [{"content": "A", "status": "completed"}]
    unregister_group_stream_relay(55555)
    assert 55555 not in grs._GROUP_TODO_PREV


def test_conclusion_branch_c_cancelled_projects_milestone(monkeypatch):
    """结论路径 Branch C（@直接派）：cancelled/error/interrupted 现在会投一条
    里程碑（此前只 update_member_state、不发消息）。校验 kind 与状态映射。"""
    import src.service.group_room_service as grs
    from src.service.group_room_service import (
        GroupRoomService,
        project_member_conversation_if_in_room,
    )

    captured = []
    monkeypatch.setattr(
        GroupRoomService,
        "_project_member_milestone",
        staticmethod(lambda **kw: captured.append((kw.get("kind"), kw.get("new_member_state"), kw.get("text")))),
    )
    # Branch A/B 都不命中：leader_room=None、编排解析返回 (None, None)
    monkeypatch.setattr(
        grs, "_resolve_room_for_orchestration_conv",
        lambda db, conv_id: (None, None),
    )

    class _FakeMember:
        id = 9
        room_id = 3
        employee_id = 5

    class _FakeEmployee:
        name = "王五"

    class _FakeScalars:
        def __init__(self, val):
            self._val = val

        def first(self):
            return self._val

    member = _FakeMember()

    class _FakeSession:
        def __init__(self):
            self._scalar_calls = 0

        def scalars(self, *a, **k):
            # 第 1 次 = leader_room 查询(None)；第 2 次 = member 查询(命中)
            self._scalar_calls += 1
            if self._scalar_calls == 1:
                return _FakeScalars(None)
            return _FakeScalars(member)

        def get(self, model, key):
            # GroupRoom / Employee 反查
            if getattr(model, "__name__", "") == "GroupRoom":
                class _FakeRoom:
                    id = 3
                return _FakeRoom()
            return _FakeEmployee()

        def close(self):
            pass

    import src.db.session as _dbsess
    monkeypatch.setattr(_dbsess, "get_session_local", lambda: (lambda: _FakeSession()))

    project_member_conversation_if_in_room(4242, "cancelled")
    assert captured == [("cancelled", "ready", "⏹️ 王五的任务已取消")]

    captured.clear()
    import src.db.session as _dbsess
    monkeypatch.setattr(_dbsess, "get_session_local", lambda: (lambda: _FakeSession()))
    project_member_conversation_if_in_room(4242, "error")
    assert captured[0][0] == "failed"
    assert captured[0][1] == "ready"
