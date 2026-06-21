from __future__ import annotations

from src.service.agent.shell_execute_tool import (
    ShellExecuteInput,
    normalize_shell_intent,
)


def test_normalize_shell_intent_strips_quotes() -> None:
    intent = normalize_shell_intent('"安装python-pptx和Pillow"')
    assert intent == "安装python-pptx和Pillow"
    assert len(intent or "") == 20


def test_normalize_shell_intent_truncates_when_too_long() -> None:
    assert normalize_shell_intent("a" * 25) == "a" * 20


def test_shell_execute_input_accepts_quoted_intent() -> None:
    parsed = ShellExecuteInput(
        command="pip install python-pptx Pillow",
        intent='"安装python-pptx和Pillow"',
    )
    assert parsed.intent == "安装python-pptx和Pillow"


def test_shell_execute_input_accepts_timeout():
    from src.service.agent.shell_execute_tool import ShellExecuteInput
    m = ShellExecuteInput(command="echo hi", timeout=30)
    assert m.timeout == 30
    assert ShellExecuteInput(command="echo hi").timeout is None


def test_poll_and_kill_tools_call_registry(tmp_path):
    import subprocess, sys, tempfile
    from src.service.agent.shell_execute_tool import (
        create_shell_poll_tool, create_shell_kill_tool,
    )
    from src.service.shell_background_registry import get_background_shell_registry

    reg = get_background_shell_registry()
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    h = open(tmp.name, "ab")
    p = subprocess.Popen([sys.executable, "-u", "-c", "print('hi', flush=True)"],
                         stdout=h, stderr=subprocess.STDOUT)
    h.close()
    p.wait()  # 让子进程先退出，避免 kill 走 taskkill /T 把 pytest 自身带走（Windows进程树）
    sid = reg.register(popen=p, tmp_path=tmp.name, read_offset=0, command="t")

    poll_tool = create_shell_poll_tool()
    out = poll_tool.invoke({"session_id": sid})
    assert isinstance(out, str)

    kill_tool = create_shell_kill_tool()
    kout = kill_tool.invoke({"session_id": sid})
    assert isinstance(kout, str)


def test_poll_unknown_session_message():
    from src.service.agent.shell_execute_tool import create_shell_poll_tool
    out = create_shell_poll_tool().invoke({"session_id": "nope"})
    assert "未找到" in out


def test_shell_wait_tool_returns_finished_output():
    import subprocess, sys, tempfile
    from src.service.agent.shell_execute_tool import create_shell_wait_tool
    from src.service.shell_background_registry import get_background_shell_registry

    reg = get_background_shell_registry()
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout")
    tmp.close()
    handle = open(tmp.name, "ab")
    popen = subprocess.Popen(
        [sys.executable, "-u", "-c", "print('done-marker', flush=True)"],
        stdout=handle, stderr=subprocess.STDOUT,
    )
    handle.close()
    sid = reg.register(popen=popen, tmp_path=tmp.name, read_offset=0, command="t")

    tool = create_shell_wait_tool()
    out = tool.invoke({"session_id": sid, "max_seconds": 5})
    assert isinstance(out, str)
    assert "done-marker" in out
    assert "exit_code=0" in out


def test_shell_wait_tool_unknown_session():
    from src.service.agent.shell_execute_tool import create_shell_wait_tool

    tool = create_shell_wait_tool()
    out = tool.invoke({"session_id": "nope", "max_seconds": 1})
    assert isinstance(out, str)
    assert "未找到" in out


def test_arun_uses_default_foreground_timeout_when_none():
    import asyncio
    from src.service.agent.shell_execute_tool import (
        create_shell_execute_tool, DEFAULT_FOREGROUND_TIMEOUT,
    )
    from deepagents.backends.protocol import ExecuteResponse

    captured = {}

    class _FakeShell:
        async def aexecute(self, command, *, timeout=None, tool_call_id=None,
                           allow_background=False):
            captured["timeout"] = timeout
            return ExecuteResponse(output="ok", exit_code=0)

        def format_shell_output(self, response):
            return response.output

    tool = create_shell_execute_tool(_FakeShell())

    def _call(args):
        # 工具含 InjectedToolCallId，须以完整 ToolCall 形式调用
        return {
            "args": args,
            "name": "shell_execute",
            "type": "tool_call",
            "id": "tc-test",
        }

    # 不传 timeout → 应被替换为 DEFAULT_FOREGROUND_TIMEOUT
    asyncio.run(tool.ainvoke(_call({"command": "echo hi"})))
    assert captured["timeout"] == DEFAULT_FOREGROUND_TIMEOUT
    # 传了 timeout → 用传入值
    asyncio.run(tool.ainvoke(_call({"command": "echo hi", "timeout": 5})))
    assert captured["timeout"] == 5


def test_shell_wait_tool_factory_named_correctly():
    from src.service.agent.shell_execute_tool import create_shell_wait_tool
    assert create_shell_wait_tool().name == "shell_wait"


def test_employee_and_orchestrator_modules_import_shell_wait():
    # 注册点导入了 create_shell_wait_tool（冒烟，确保两处都改了）
    import src.service.agent.employee as emp
    import src.service.agent.orchestrator.agent as orch
    assert hasattr(emp, "create_shell_wait_tool")
    assert hasattr(orch, "create_shell_wait_tool")


def test_timeout_description_steers_to_default_and_background():
    from src.service.agent.shell_execute_tool import ShellExecuteInput
    desc = ShellExecuteInput.model_fields["timeout"].description
    assert "默认 60" in desc
    assert "shell_wait" in desc


def test_poll_description_points_to_wait_for_waiting():
    from src.service.agent.shell_execute_tool import create_shell_poll_tool
    desc = create_shell_poll_tool().description
    assert "shell_wait" in desc


def test_start_service_tool_stdout_ready_returns_service_id():
    import sys
    from src.service.agent.shell_execute_tool import create_start_service_tool
    from src.service.shell_background_registry import get_background_shell_registry

    tool = create_start_service_tool()
    cmd = (
        f'{sys.executable} -u -c "import time;print(\'Application startup complete\',flush=True);time.sleep(30)"'
    )
    out = tool.invoke({
        "command": cmd,
        "ready": {"type": "stdout", "pattern": "startup complete"},
        "ready_timeout": 10,
    })
    assert isinstance(out, str)
    assert "已就绪" in out
    assert "service_id=" in out
    import re
    m = re.search(r"service_id=([0-9a-f]+)", out)
    assert m
    sid = m.group(1)
    reg = get_background_shell_registry()
    assert reg.poll(sid)["found"] is True
    reg.kill(sid)


def test_start_service_tool_rejects_non_local_host():
    from src.service.agent.shell_execute_tool import create_start_service_tool
    tool = create_start_service_tool()
    out = tool.invoke({
        "command": "echo hi",
        "ready": {"type": "wait", "seconds": 1},
        "host": "0.0.0.0",
    })
    assert isinstance(out, str)
    assert "127.0.0.1" in out or "localhost" in out
    assert "失败" in out or "只允许" in out


def test_start_service_tool_http_requires_port():
    from src.service.agent.shell_execute_tool import create_start_service_tool
    tool = create_start_service_tool()
    out = tool.invoke({
        "command": "echo hi",
        "ready": {"type": "http", "path": "/"},
    })
    assert isinstance(out, str)
    assert "port" in out.lower()


def test_start_service_factory_named_correctly():
    from src.service.agent.shell_execute_tool import create_start_service_tool
    assert create_start_service_tool().name == "start_service"


def test_modules_import_start_service():
    import src.service.agent.employee as emp
    import src.service.agent.orchestrator.agent as orch
    assert hasattr(emp, "create_start_service_tool")
    assert hasattr(orch, "create_start_service_tool")


def test_registry_registers_atexit_kill_all_services():
    import src.service.shell_background_registry as reg_mod
    assert getattr(reg_mod, "_ATEXIT_REGISTERED", False) is True


def test_watch_background_registers_when_running(monkeypatch):
    import sys, subprocess, tempfile
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    from src.service.shell_background_registry import get_background_shell_registry
    from src.service.background_watch_registry import get_background_watch_registry

    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    handle = open(tmp.name, "ab")
    _grp = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
            if sys.platform == "win32" else {"start_new_session": True})
    popen = subprocess.Popen([sys.executable, "-u", "-c", "import time; time.sleep(30)"],
                             stdout=handle, stderr=subprocess.STDOUT, **_grp)
    handle.close()
    reg = get_background_shell_registry()
    sid = reg.register(popen=popen, tmp_path=tmp.name, read_offset=0, command="svc")

    import src.service.agent.shell_execute_tool as mod
    monkeypatch.setattr(mod, "_resolve_watch_context",
                        lambda runtime: (123, "curator"))

    tool = create_watch_background_tool()
    out = tool.invoke({"session_id": sid})
    assert isinstance(out, str)
    assert "已登记" in out or "自动" in out
    wreg = get_background_watch_registry()
    assert any(w.session_id == sid and w.conversation_id == 123
               for w in wreg.list_watching())
    reg.kill(sid)
    wreg.drop(sid)


def test_watch_background_rejects_finished_session():
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    tool = create_watch_background_tool()
    out = tool.invoke({"session_id": "nonexistent-id"})
    assert isinstance(out, str)
    assert "已结束" in out or "未找到" in out or "无需" in out


def test_watch_background_no_context_does_not_crash(monkeypatch):
    import sys, subprocess, tempfile
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    from src.service.shell_background_registry import get_background_shell_registry

    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    handle = open(tmp.name, "ab")
    _grp = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
            if sys.platform == "win32" else {"start_new_session": True})
    popen = subprocess.Popen([sys.executable, "-u", "-c", "import time; time.sleep(30)"],
                             stdout=handle, stderr=subprocess.STDOUT, **_grp)
    handle.close()
    reg = get_background_shell_registry()
    sid = reg.register(popen=popen, tmp_path=tmp.name, read_offset=0, command="svc")

    import src.service.agent.shell_execute_tool as mod
    monkeypatch.setattr(mod, "_resolve_watch_context", lambda runtime: (None, None))

    tool = create_watch_background_tool()
    out = tool.invoke({"session_id": sid})
    assert isinstance(out, str)
    assert "无法登记" in out or "缺会话" in out
    reg.kill(sid)


def test_watch_background_factory_named_correctly():
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    assert create_watch_background_tool().name == "watch_background"


def test_modules_import_watch_background():
    import src.service.agent.employee as emp
    import src.service.agent.orchestrator.agent as orch
    assert hasattr(emp, "create_watch_background_tool")
    assert hasattr(orch, "create_watch_background_tool")


def test_scheduler_has_run_scan_and_wake_job():
    from src.service.task_scheduler_service import TaskSchedulerService
    assert hasattr(TaskSchedulerService, "run_scan_and_wake_job")
