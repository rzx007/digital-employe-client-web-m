"""后台 shell 命令注册表 + aexecute 转后台/直接后台 + 工具层 测试。

跨平台：用 sys.executable -c 起子进程；进程组起、整组 kill。
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
import tempfile
import time

from src.service.shell_background_registry import (
    BackgroundShellRegistry,
    process_group_kwargs,
)


def _spawn(py_code: str, tmp_path: str) -> subprocess.Popen:
    """起一个把 stdout 写入 tmp_path 的进程组子进程（模拟 backend 的起进程方式）。"""
    handle = open(tmp_path, "ab")
    try:
        proc = subprocess.Popen(  # noqa: S603
            [sys.executable, "-u", "-c", py_code],
            stdout=handle,
            stderr=subprocess.STDOUT,
            **process_group_kwargs(),
        )
    finally:
        handle.close()
    return proc


def _new_tmp() -> str:
    t = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout")
    t.close()
    return t.name


def _register(reg: BackgroundShellRegistry, proc, tmp, **kw) -> str:
    return reg.register(
        popen=proc, tmp_path=tmp, read_offset=0, command="test-cmd", **kw
    )


def test_poll_reads_increment_and_settles_finished():
    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("print('hello-world')", tmp)
    sid = _register(reg, proc, tmp, workspace_id=1, conversation_id=2)
    # 等子进程结束
    proc.wait(timeout=10)
    time.sleep(0.1)
    r = reg.poll(sid)
    assert r["found"] is True
    assert r["running"] is False
    assert r["exit_code"] == 0
    assert "hello-world" in r["new_output"]


def test_wait_returns_on_finish():
    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("import time;time.sleep(0.4);print('done')", tmp)
    sid = _register(reg, proc, tmp)
    r = reg.wait(sid, 5)
    assert r["found"] is True
    assert r["finished"] is True
    assert r["exit_code"] == 0
    assert "done" in r["new_output"]


def test_wait_times_out_then_kill():
    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("import time;time.sleep(30)", tmp)
    sid = _register(reg, proc, tmp)
    r = reg.wait(sid, 1)
    assert r["found"] is True
    assert r["finished"] is False
    assert r["waited_seconds"] >= 0.5
    k = reg.kill(sid)
    assert k["found"] is True
    assert k["killed"] is True


def test_kill_unknown_and_poll_unknown():
    reg = BackgroundShellRegistry()
    assert reg.poll("nope") == {"found": False}
    assert reg.wait("nope", 1) == {"found": False}
    assert reg.kill("nope") == {"found": False, "killed": False}


def test_sweep_never_age_kills_running():
    """核心 redesign：sweep 绝不按龄强杀仍在跑的任务（小时级长任务合法）。"""
    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("import time;time.sleep(30)", tmp)
    sid = _register(reg, proc, tmp)
    # 伪造成「很久以前启动」
    with reg._lock:
        reg._sessions[sid].started_at = time.monotonic() - 99999
    reg.sweep()
    assert proc.poll() is None, "running 任务被 sweep 误杀了"
    assert reg.poll(sid)["found"] is True
    reg.kill(sid)


def test_sweep_retains_then_removes_finished(monkeypatch):
    import src.service.shell_background_registry as mod

    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("print('x')", tmp)
    sid = _register(reg, proc, tmp)
    proc.wait(timeout=10)
    # 第一次 sweep：发现 finished，清文件但保留条目（保留窗很大）
    monkeypatch.setattr(mod, "_FINISHED_RETENTION", 1000.0)
    reg.sweep()
    assert reg.poll(sid)["found"] is True
    # 保留窗设 0 后再 sweep：移除
    monkeypatch.setattr(mod, "_FINISHED_RETENTION", 0.0)
    reg.sweep()
    assert reg.poll(sid)["found"] is False


def test_list_snapshot_filters_by_workspace_and_conversation():
    reg = BackgroundShellRegistry()
    tmp1, tmp2 = _new_tmp(), _new_tmp()
    p1 = _spawn("import time;time.sleep(20)", tmp1)
    p2 = _spawn("import time;time.sleep(20)", tmp2)
    sid1 = _register(reg, p1, tmp1, workspace_id=1, conversation_id=10, intent="任务A")
    _register(reg, p2, tmp2, workspace_id=2, conversation_id=20)
    rows = reg.list_snapshot(workspace_id=1)
    assert [r["session_id"] for r in rows] == [sid1]
    assert rows[0]["intent"] == "任务A"
    assert rows[0]["running"] is True
    assert rows[0]["elapsed_seconds"] >= 0
    assert reg.list_snapshot(workspace_id=1, conversation_id=999) == []
    assert reg.list_snapshot(workspace_id=2) != []
    reg.kill(sid1)
    reg.kill_all()


def test_kill_all_terminates_running():
    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("import time;time.sleep(30)", tmp)
    _register(reg, proc, tmp)
    n = reg.kill_all()
    assert n == 1
    assert proc.poll() is not None


def test_read_output_tail_unknown():
    reg = BackgroundShellRegistry()
    assert reg.read_output_tail("nope") == {"found": False}


def test_read_output_tail_readable_after_finish_and_sweep():
    """点开看日志：命令结束、且 sweep 跑过（保留窗内）后，日志仍可读（文件未被提前清）。"""
    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("print('log-line-xyz')", tmp)
    sid = _register(reg, proc, tmp)
    proc.wait(timeout=10)
    reg.sweep()  # 保留窗内：绝不删文件
    r = reg.read_output_tail(sid)
    assert r["found"] is True
    assert r["running"] is False
    assert "log-line-xyz" in r["output"]


def test_lazy_sweep_removes_expired_finished(monkeypatch):
    """poll/wait/list 顺带触发的惰性 sweep 会移除超保留窗的 finished 条目。"""
    import src.service.shell_background_registry as mod

    reg = BackgroundShellRegistry()
    tmp = _new_tmp()
    proc = _spawn("print('x')", tmp)
    sid = _register(reg, proc, tmp)
    proc.wait(timeout=10)
    reg.poll(sid)  # settle 到 finished
    monkeypatch.setattr(mod, "_FINISHED_RETENTION", 0.0)
    reg._last_sweep = 0.0  # 解除节流，确保下次 poll 触发 sweep
    reg.poll("trigger-dummy")  # 惰性 sweep 在此触发，移除超窗 finished
    assert reg.poll(sid)["found"] is False


# ---- aexecute 转后台 / 直接后台 ----


def _make_backend(tmp_root):
    from pathlib import Path

    from src.service.skill_shell_backend import SkillAwareShellBackend

    return SkillAwareShellBackend(
        root_dir=str(tmp_root),
        skills_root=Path(tmp_root),
        draft_root=None,
        conversation_id=42,
        workspace_id=7,
        virtual_mode=False,
        inherit_env=True,
        timeout=30,
    )


def test_aexecute_run_in_background_returns_immediately(tmp_path):
    from src.service.shell_background_registry import get_background_shell_registry

    backend = _make_backend(tmp_path)
    cmd = f'{sys.executable} -c "import time;time.sleep(20)"'
    resp = asyncio.run(
        backend.aexecute(
            cmd, run_in_background=True, allow_background=True, intent="后台任务"
        )
    )
    assert "session_id=" in resp.output
    rows = get_background_shell_registry().list_snapshot(workspace_id=7, conversation_id=42)
    assert any(r["running"] for r in rows)
    # 收尾
    for r in rows:
        get_background_shell_registry().kill(r["session_id"])


def test_aexecute_timeout_hands_off_to_background(tmp_path):
    from src.service.shell_background_registry import get_background_shell_registry

    backend = _make_backend(tmp_path)
    cmd = f'{sys.executable} -c "import time;time.sleep(20)"'
    resp = asyncio.run(
        backend.aexecute(cmd, timeout=1, allow_background=True, intent="慢命令")
    )
    # 转后台：返回 session_id、exit_code 非 124（不是失败），进程仍在跑
    assert "session_id=" in resp.output
    assert resp.exit_code != 124
    reg = get_background_shell_registry()
    rows = reg.list_snapshot(workspace_id=7, conversation_id=42)
    running = [r for r in rows if r["running"]]
    assert running, "超时未转后台或进程被误杀"
    for r in rows:
        reg.kill(r["session_id"])


def test_aexecute_no_background_kills_on_timeout(tmp_path):
    backend = _make_backend(tmp_path)
    cmd = f'{sys.executable} -c "import time;time.sleep(20)"'
    resp = asyncio.run(backend.aexecute(cmd, timeout=1, allow_background=False))
    # 不允许后台 → 维持超时 kill + 124
    assert resp.exit_code == 124


# ---- 工具层 ----


def test_shell_tools_smoke():
    from src.service.agent.shell_execute_tool import (
        ShellExecuteInput,
        create_shell_kill_tool,
        create_shell_poll_tool,
        create_shell_wait_tool,
    )

    # schema 接受新字段
    inp = ShellExecuteInput(command="echo hi", timeout=120, run_in_background=True)
    assert inp.run_in_background is True
    assert inp.timeout == 120

    poll = create_shell_poll_tool()
    wait = create_shell_wait_tool()
    kill = create_shell_kill_tool()
    assert "未找到" in poll.invoke({"session_id": "nope"})
    assert "未找到" in wait.invoke({"session_id": "nope", "max_seconds": 1})
    assert "未找到" in kill.invoke({"session_id": "nope"})
