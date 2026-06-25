def test_build_wake_message_small_output():
    """小输出注入完整摘要（含 session_id、exit code、command、末尾输出）。"""
    from src.service.agent.orchestrator.background_wake import build_wake_message

    msg = build_wake_message(
        session_id="s1", command="make build", exit_code=0,
        output="line1\nline2\n", output_size=12,
    )
    assert "s1" in msg
    assert "exit" in msg.lower() or "0" in msg
    assert "make build" in msg
    assert "line2" in msg


def test_build_wake_message_large_output_signal_only():
    """超阈值只发完成信号 + 提示 shell_poll，不内联全部输出。"""
    from src.service.agent.orchestrator.background_wake import build_wake_message

    big = "x" * (200 * 1024)
    msg = build_wake_message(
        session_id="s2", command="big", exit_code=0,
        output=big, output_size=len(big),
    )
    assert "shell_poll" in msg
    assert big not in msg  # 不内联超大输出
    assert "s2" in msg


def test_build_wake_message_tail_on_line_boundary():
    """输出超过 tail 上限时按行边界切，且带截断标记。"""
    from src.service.agent.orchestrator.background_wake import build_wake_message

    # 构造一个 < 64KB 但 > 2000 字符的多行输出
    lines = "\n".join(f"line{i}" for i in range(1000))  # 远超 2000 字符但 < 64KB
    msg = build_wake_message(
        session_id="s3", command="x", exit_code=0,
        output=lines, output_size=len(lines),
    )
    # 末尾的行应在，开头的行应被截断
    assert "line999" in msg
    assert "line0\n" not in msg  # 开头被切掉
    assert "截断" in msg or "truncat" in msg.lower()


import asyncio


def test_watcher_injects_on_exit_and_dedupes(monkeypatch):
    """watcher 检测退出 → 调 _inject_wake；若 is_consumed_by_agent 为真则跳过。"""
    from src.service.agent.orchestrator import background_wake as bw

    polls = [
        {"found": True, "running": True, "exit_code": None, "new_output": ""},
        {"found": True, "running": False, "exit_code": 0, "new_output": "done\n"},
    ]
    consumed = {"v": False}
    injected = {"called": False}

    class _Reg:
        def poll(self, sid, from_offset=None, agent_initiated=False):
            return polls.pop(0) if polls else {"found": True, "running": False, "exit_code": 0, "new_output": ""}
        def is_consumed_by_agent(self, sid):
            return consumed["v"]
        def read_output_tail(self, sid, max_bytes=65536):
            return {"output": "done\n", "total_size": 5}

    monkeypatch.setattr(bw, "get_background_shell_registry", lambda: _Reg())
    monkeypatch.setattr(bw, "_inject_wake", lambda **k: injected.__setitem__("called", True))

    asyncio.run(bw.watch_background_command(
        session_id="s1", conversation_id=7, command="make", poll_interval=0.01
    ))
    assert injected["called"] is True

    # 已被 agent 消费 → 不注入
    injected["called"] = False
    consumed["v"] = True
    polls[:] = [{"found": True, "running": False, "exit_code": 0, "new_output": ""}]
    asyncio.run(bw.watch_background_command(
        session_id="s1", conversation_id=7, command="make", poll_interval=0.01
    ))
    assert injected["called"] is False


def test_watcher_no_conversation_skips_injection(monkeypatch):
    """裸 shell（无 conversation_id）→ 不注入。"""
    from src.service.agent.orchestrator import background_wake as bw
    injected = {"called": False}

    class _Reg:
        def poll(self, sid, from_offset=None, agent_initiated=False):
            return {"found": True, "running": False, "exit_code": 0, "new_output": ""}
        def is_consumed_by_agent(self, sid):
            return False
        def read_output_tail(self, sid, max_bytes=65536):
            return {"output": "", "total_size": 0}

    monkeypatch.setattr(bw, "get_background_shell_registry", lambda: _Reg())
    monkeypatch.setattr(bw, "_inject_wake", lambda **k: injected.__setitem__("called", True))

    asyncio.run(bw.watch_background_command(
        session_id="s1", conversation_id=None, command="x", poll_interval=0.01
    ))
    assert injected["called"] is False


def _patch_inject_wake_deps(monkeypatch, *, target_type):
    """共享：mock _inject_wake 的真实依赖，隔离「按 target_type 分发」逻辑。

    返回 calls 字典记录两条路径分别被调几次。
    """
    from src.service.agent.orchestrator import background_wake as bw

    calls = {"employee": 0, "curator": 0}

    # registry.is_active 恒 False（无进行中 turn，不跳过）。
    class _Reg:
        def is_active(self, conv_id):
            return False

    import src.service.stream_registry as sr
    monkeypatch.setattr(sr, "registry", _Reg())

    # Conversation 查询：返回带指定 target_type 的伪 conversation。
    class _Conv:
        id = 42
        target_type = target_type
        target_id = 9
        workspace_id = 3

    class _Query:
        def filter(self, *a, **k):
            return self
        def first(self):
            return _Conv()

    class _Db:
        def query(self, *a, **k):
            return _Query()
        def close(self):
            pass

    import src.db.session as dbs
    monkeypatch.setattr(dbs, "get_session_local", lambda: (lambda: _Db()))

    # 两条续跑路径各自打点。
    monkeypatch.setattr(
        bw, "_inject_wake_employee",
        lambda **k: calls.__setitem__("employee", calls["employee"] + 1),
    )
    monkeypatch.setattr(
        bw, "_inject_wake_curator",
        lambda **k: calls.__setitem__("curator", calls["curator"] + 1),
    )
    return bw, calls


def test_inject_wake_dispatches_employee(monkeypatch):
    """employee 会话 → 只走员工续跑路径。"""
    bw, calls = _patch_inject_wake_deps(monkeypatch, target_type="employee")
    bw._inject_wake(conversation_id=42, message="hi")
    assert calls == {"employee": 1, "curator": 0}


def test_inject_wake_dispatches_curator(monkeypatch):
    """curator 会话 → 只走总管续跑路径。"""
    bw, calls = _patch_inject_wake_deps(monkeypatch, target_type="curator")
    bw._inject_wake(conversation_id=42, message="hi")
    assert calls == {"employee": 0, "curator": 1}


def test_inject_wake_group_does_not_resume(monkeypatch):
    """group（及其它类型）会话 → 两条路径都不调，直接 return。"""
    bw, calls = _patch_inject_wake_deps(monkeypatch, target_type="group")
    bw._inject_wake(conversation_id=42, message="hi")
    assert calls == {"employee": 0, "curator": 0}


def test_inject_wake_active_turn_skips(monkeypatch):
    """有进行中 turn → 直接跳过，不查 conversation、不续跑。"""
    from src.service.agent.orchestrator import background_wake as bw

    calls = {"employee": 0, "curator": 0}

    class _Reg:
        def is_active(self, conv_id):
            return True

    import src.service.stream_registry as sr
    monkeypatch.setattr(sr, "registry", _Reg())
    monkeypatch.setattr(
        bw, "_inject_wake_employee",
        lambda **k: calls.__setitem__("employee", calls["employee"] + 1),
    )
    monkeypatch.setattr(
        bw, "_inject_wake_curator",
        lambda **k: calls.__setitem__("curator", calls["curator"] + 1),
    )
    bw._inject_wake(conversation_id=42, message="hi")
    assert calls == {"employee": 0, "curator": 0}
