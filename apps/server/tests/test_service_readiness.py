from __future__ import annotations

import subprocess
import sys
import tempfile
import time


def _spawn(py_code: str):
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout")
    tmp.close()
    handle = open(tmp.name, "ab")
    popen = subprocess.Popen(
        [sys.executable, "-u", "-c", py_code], stdout=handle, stderr=subprocess.STDOUT
    )
    handle.close()
    return popen, tmp.name


def test_stdout_ready_matches_pattern():
    from src.service.service_readiness import wait_for_service_ready
    popen, tmp = _spawn(
        "import time; time.sleep(0.3); print('Application startup complete', flush=True); time.sleep(30)"
    )
    try:
        r = wait_for_service_ready(
            popen=popen, tmp_path=tmp,
            ready={"type": "stdout", "pattern": "startup complete"},
            host="127.0.0.1", port=None, ready_timeout=10,
            fatal_patterns=[], read_offset=0,
        )
        assert r["ready"] is True
        assert "startup complete" in r["new_output"]
    finally:
        popen.kill()


def test_stdout_timeout_when_pattern_never_appears():
    from src.service.service_readiness import wait_for_service_ready
    popen, tmp = _spawn("import time; time.sleep(30)")
    try:
        r = wait_for_service_ready(
            popen=popen, tmp_path=tmp,
            ready={"type": "stdout", "pattern": "NEVER_SHOWS"},
            host="127.0.0.1", port=None, ready_timeout=1,
            fatal_patterns=[], read_offset=0,
        )
        assert r["ready"] is False
        assert r.get("timed_out") is True
    finally:
        popen.kill()


def test_fatal_pattern_fails_fast():
    from src.service.service_readiness import wait_for_service_ready
    popen, tmp = _spawn(
        "import time; time.sleep(0.3); print('ERROR: Address already in use', flush=True); time.sleep(30)"
    )
    try:
        r = wait_for_service_ready(
            popen=popen, tmp_path=tmp,
            ready={"type": "stdout", "pattern": "startup complete"},
            host="127.0.0.1", port=None, ready_timeout=10,
            fatal_patterns=["Address already in use"], read_offset=0,
        )
        assert r["ready"] is False
        assert r.get("fatal") is True
        assert "Address already in use" in r.get("fatal_line", "")
    finally:
        popen.kill()


def test_process_exits_before_ready():
    from src.service.service_readiness import wait_for_service_ready
    popen, tmp = _spawn("import sys; sys.exit(3)")
    time.sleep(0.3)
    r = wait_for_service_ready(
        popen=popen, tmp_path=tmp,
        ready={"type": "stdout", "pattern": "startup complete"},
        host="127.0.0.1", port=None, ready_timeout=10,
        fatal_patterns=[], read_offset=0,
    )
    assert r["ready"] is False
    assert r.get("exited") is True
    assert r.get("exit_code") == 3


def test_wait_mode_returns_ready_after_seconds():
    from src.service.service_readiness import wait_for_service_ready
    popen, tmp = _spawn("import time; time.sleep(30)")
    try:
        start = time.monotonic()
        r = wait_for_service_ready(
            popen=popen, tmp_path=tmp,
            ready={"type": "wait", "seconds": 1},
            host="127.0.0.1", port=None, ready_timeout=10,
            fatal_patterns=[], read_offset=0,
        )
        assert r["ready"] is True
        assert time.monotonic() - start >= 0.9
    finally:
        popen.kill()


def test_http_mode_ready_when_server_responds():
    from src.service.service_readiness import wait_for_service_ready
    port = 58231
    code = (
        "import http.server, socketserver; "
        f"socketserver.TCPServer(('127.0.0.1', {port}), http.server.SimpleHTTPRequestHandler).serve_forever()"
    )
    popen, tmp = _spawn(code)
    try:
        r = wait_for_service_ready(
            popen=popen, tmp_path=tmp,
            ready={"type": "http", "path": "/", "interval": 0.3},
            host="127.0.0.1", port=port, ready_timeout=10,
            fatal_patterns=[], read_offset=0,
        )
        assert r["ready"] is True
    finally:
        popen.kill()
