"""常驻服务就绪检测：移植 Node managed-process.ts 的 stdout/http/wait + fatal 快速失败。
同步阻塞跑工具执行线程（与 shell_wait 同模型），不占 LLM 连接。"""

from __future__ import annotations

import http.client
import logging
import os
import re
import time

logger = logging.getLogger(__name__)

_READINESS_HARD_CAP = 120
_POLL_INTERVAL = 0.5
_READ_CHUNK = 65536
_MAX_READ_BYTES = 64 * 1024


def _read_incremental(tmp_path: str, last_size: int) -> tuple[int, str]:
    """读临时文件自 last_size 起的增量（与注册表 _read_incremental 同语义）。"""
    try:
        size = os.path.getsize(tmp_path)
    except OSError:
        return last_size, ""
    if size <= last_size:
        return last_size, ""
    out = bytearray()
    try:
        with open(tmp_path, "rb") as f:
            f.seek(last_size)
            while len(out) < _MAX_READ_BYTES:
                chunk = f.read(_READ_CHUNK)
                if not chunk:
                    break
                out += chunk
    except OSError:
        return last_size, ""
    return last_size + len(out), out.decode("utf-8", errors="replace")


def _http_probe(host: str, port: int, path: str) -> bool:
    """GET 一次，状态码 2xx-4xx 视为就绪。连不上/超时返回 False。"""
    conn = None
    try:
        conn = http.client.HTTPConnection(host, port, timeout=2)
        conn.request("GET", path if path.startswith("/") else "/" + path)
        resp = conn.getresponse()
        resp.read()
        return 200 <= resp.status < 500
    except Exception:
        return False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def wait_for_service_ready(
    *,
    popen,
    tmp_path: str,
    ready: dict,
    host: str,
    port: int | None,
    ready_timeout: int,
    fatal_patterns: list[str],
    read_offset: int,
) -> dict:
    """阻塞等服务就绪。返回 dict：
    - ready=True  → {ready, new_output, offset}
    - 进程启动即退出 → {ready:False, exited:True, exit_code, new_output, offset}
    - fatal 命中  → {ready:False, fatal:True, fatal_line, new_output, offset}
    - 超时        → {ready:False, timed_out:True, new_output, offset}
    """
    rtype = ready.get("type", "wait")
    cap = max(1, min(int(ready_timeout), _READINESS_HARD_CAP))
    fatal_res = [re.compile(p) for p in (fatal_patterns or [])]
    pattern = re.compile(ready["pattern"]) if rtype == "stdout" else None
    interval = float(ready.get("interval", _POLL_INTERVAL)) if rtype == "http" else _POLL_INTERVAL
    wait_seconds = float(ready.get("seconds", 8)) if rtype == "wait" else None

    start = time.monotonic()
    offset = read_offset
    seen = ""

    while True:
        new_offset, chunk = _read_incremental(tmp_path, offset)
        offset = new_offset
        if chunk:
            seen += chunk

        # ① 进程启动即退出
        rc = popen.poll()
        if rc is not None:
            return {"ready": False, "exited": True, "exit_code": rc,
                    "new_output": seen, "offset": offset}

        # ② fatal 命中
        for fr in fatal_res:
            m = fr.search(seen)
            if m:
                return {"ready": False, "fatal": True, "fatal_line": m.group(0),
                        "new_output": seen, "offset": offset}

        # ③ 就绪判定
        if rtype == "stdout":
            if pattern.search(seen):
                return {"ready": True, "new_output": seen, "offset": offset}
        elif rtype == "http":
            if port and _http_probe(host, port, ready.get("path", "/")):
                return {"ready": True, "new_output": seen, "offset": offset}
        elif rtype == "wait":
            if time.monotonic() - start >= (wait_seconds or 0):
                return {"ready": True, "new_output": seen, "offset": offset}

        # ④ 超时
        if time.monotonic() - start >= cap:
            return {"ready": False, "timed_out": True, "new_output": seen, "offset": offset}

        time.sleep(interval)
