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
