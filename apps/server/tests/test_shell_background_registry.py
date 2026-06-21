from __future__ import annotations

import subprocess
import sys
import tempfile
import time

from src.service.shell_background_registry import get_background_shell_registry


def _spawn_to_tmpfile(py_code: str):
    """起一个写 stdout 到临时文件的后台进程，返回 (popen, tmp_path)。"""
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout")
    tmp.close()
    handle = open(tmp.name, "ab")
    popen = subprocess.Popen(
        [sys.executable, "-u", "-c", py_code], stdout=handle, stderr=subprocess.STDOUT
    )
    handle.close()
    return popen, tmp.name


def test_register_poll_reads_incremental_and_reports_running_then_exit():
    reg = get_background_shell_registry()
    popen, tmp = _spawn_to_tmpfile(
        "import time; print('line1', flush=True); time.sleep(1); print('line2', flush=True)"
    )
    sid = reg.register(popen=popen, tmp_path=tmp, read_offset=0, command="t")
    assert isinstance(sid, str) and sid

    time.sleep(0.4)
    r1 = reg.poll(sid)
    assert r1["found"] is True
    assert r1["running"] is True
    assert "line1" in r1["new_output"]
    off1 = r1["offset"]

    time.sleep(1.2)
    r2 = reg.poll(sid, from_offset=off1)
    assert r2["running"] is False
    assert r2["exit_code"] is not None
    assert "line2" in r2["new_output"]


def test_poll_unknown_session_returns_not_found():
    reg = get_background_shell_registry()
    r = reg.poll("nonexistent-id")
    assert r["found"] is False


def test_kill_terminates_running_process():
    reg = get_background_shell_registry()
    popen, tmp = _spawn_to_tmpfile("import time; time.sleep(30)")
    sid = reg.register(popen=popen, tmp_path=tmp, read_offset=0, command="sleep")
    r = reg.kill(sid)
    assert r["found"] is True and r["killed"] is True
    time.sleep(0.3)
    assert popen.poll() is not None


def test_kill_terminates_grandchild_process(tmp_path):
    import os, subprocess, sys, tempfile, time
    from src.service.shell_background_registry import get_background_shell_registry

    reg = get_background_shell_registry()
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    handle = open(tmp.name, "ab")
    # 父进程(shell)起一个 python 子进程(grandchild)写自己的 pid 到一个文件, 然后 sleep 30
    pidfile = str(tmp_path / "gc.pid")
    # 用 shell=True + 进程组, 让 shell 起一个长命令 grandchild
    inner = (
        f"import os,time,sys; "
        f"open(r'{pidfile}','w').write(str(os.getpid())); "
        f"sys.stdout.flush(); time.sleep(30)"
    )
    if sys.platform == "win32":
        cmd = f'{sys.executable} -u -c "{inner}"'
        popen = subprocess.Popen(cmd, stdout=handle, stderr=subprocess.STDOUT, shell=True,
                                 creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        cmd = f"{sys.executable} -u -c \"{inner}\""
        popen = subprocess.Popen(cmd, stdout=handle, stderr=subprocess.STDOUT, shell=True,
                                 start_new_session=True)
    handle.close()
    sid = reg.register(popen=popen, tmp_path=tmp.name, read_offset=0, command="gc")

    # 等 grandchild 起来并写 pid
    gc_pid = None
    for _ in range(50):
        time.sleep(0.1)
        try:
            gc_pid = int(open(pidfile).read().strip())
            break
        except (OSError, ValueError):
            continue
    assert gc_pid, "grandchild 未写出 pid"

    reg.kill(sid)
    time.sleep(0.5)

    # 验证 grandchild 已死
    def _alive(pid: int) -> bool:
        if sys.platform == "win32":
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"],
                                 capture_output=True, text=True)
            return str(pid) in out.stdout
        else:
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False
    assert not _alive(gc_pid), f"grandchild pid={gc_pid} 仍存活(被孤儿化)"


def test_wait_returns_finished_when_process_completes_within_window():
    reg = get_background_shell_registry()
    popen, tmp = _spawn_to_tmpfile(
        "import time; print('a', flush=True); time.sleep(0.5); print('b', flush=True)"
    )
    sid = reg.register(popen=popen, tmp_path=tmp, read_offset=0, command="t")
    r = reg.wait(sid, 5)
    assert r["found"] is True
    assert r["finished"] is True
    assert r["exit_code"] == 0
    assert "a" in r["new_output"] and "b" in r["new_output"]
    assert r["waited_seconds"] <= 5


def test_wait_returns_unfinished_when_window_too_short():
    reg = get_background_shell_registry()
    popen, tmp = _spawn_to_tmpfile("import time; time.sleep(30)")
    sid = reg.register(popen=popen, tmp_path=tmp, read_offset=0, command="t")
    r = reg.wait(sid, 1)
    assert r["found"] is True
    assert r["finished"] is False
    assert r["exit_code"] is None
    assert 0.5 <= r["waited_seconds"] <= 3
    reg.kill(sid)  # 收尾：先杀掉再让测试结束，避免 sleep(30) 拖住/被孤儿


def test_wait_unknown_session_returns_not_found():
    reg = get_background_shell_registry()
    r = reg.wait("nonexistent-id", 1)
    assert r["found"] is False


def _spawn_to_tmpfile_own_group(py_code: str):
    """同 _spawn_to_tmpfile，但子进程独占进程组（Win: CREATE_NEW_PROCESS_GROUP /
    POSIX: start_new_session），这样 _terminate 发 CTRL_BREAK 不会回灌到 pytest 自身。
    age-sweep 会真的 _terminate 这个进程，故必须隔离，否则杀到测试运行器(Win exit 58)。"""
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout")
    tmp.close()
    handle = open(tmp.name, "ab")
    kwargs: dict = {"stdout": handle, "stderr": subprocess.STDOUT}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    popen = subprocess.Popen([sys.executable, "-u", "-c", py_code], **kwargs)
    handle.close()
    return popen, tmp.name


def test_service_session_is_exempt_from_age_sweep(monkeypatch):
    import src.service.shell_background_registry as reg_mod
    reg = get_background_shell_registry()
    # 普通会话会被 age-sweep 真杀掉，必须独占进程组(否则 _terminate 的 CTRL_BREAK 杀到 pytest)。
    popen_a, tmp_a = _spawn_to_tmpfile_own_group("import time; time.sleep(30)")
    popen_b, tmp_b = _spawn_to_tmpfile("import time; time.sleep(30)")
    sid_normal = reg.register(popen=popen_a, tmp_path=tmp_a, read_offset=0, command="n")
    sid_service = reg.register(popen=popen_b, tmp_path=tmp_b, read_offset=0,
                               command="svc", is_service=True)
    monkeypatch.setattr(reg_mod, "_MAX_AGE_SECONDS", 0)
    time.sleep(0.05)  # Win monotonic 粒度 15.6ms: 让 now-started_at 真大于 0 才会被 age-sweep
    reg.sweep()
    assert reg.poll(sid_normal)["found"] is False
    assert reg.poll(sid_service)["found"] is True
    assert reg.poll(sid_service)["running"] is True
    reg.kill(sid_service)


def test_kill_all_services_terminates_only_services():
    reg = get_background_shell_registry()
    popen_a, tmp_a = _spawn_to_tmpfile("import time; time.sleep(30)")
    # 服务进程会被 kill_all_services 真杀，独占进程组避免 CTRL_BREAK 杀到 pytest。
    popen_b, tmp_b = _spawn_to_tmpfile_own_group("import time; time.sleep(30)")
    sid_normal = reg.register(popen=popen_a, tmp_path=tmp_a, read_offset=0, command="n")
    sid_service = reg.register(popen=popen_b, tmp_path=tmp_b, read_offset=0,
                               command="svc", is_service=True)
    n = reg.kill_all_services()
    assert n >= 1
    time.sleep(0.5)
    assert popen_b.poll() is not None
    assert popen_a.poll() is None
    reg.kill(sid_normal)
