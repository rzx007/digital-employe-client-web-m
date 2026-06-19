"""后台 shell 进程注册表：shell_execute 超时转后台时把 Popen + 临时输出文件移交此处，
模型用 shell_poll/shell_kill 查状态/读增量/终止。进程级全局单例。"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_READ_CHUNK = 65536
_MAX_POLL_BYTES = 64 * 1024
_MAX_AGE_SECONDS = 3600


@dataclass
class _Session:
    popen: subprocess.Popen
    tmp_path: str
    read_offset: int
    command: str
    started_at: float
    status: str = "running"  # running | finished | killed


class BackgroundShellRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.Lock()

    def register(self, *, popen: subprocess.Popen, tmp_path: str,
                 read_offset: int, command: str) -> str:
        sid = uuid.uuid4().hex
        with self._lock:
            self._sessions[sid] = _Session(
                popen=popen, tmp_path=tmp_path, read_offset=read_offset,
                command=command, started_at=time.monotonic(),
            )
        return sid

    def _read_incremental(self, tmp_path: str, last_size: int) -> tuple[int, str]:
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
                while len(out) < _MAX_POLL_BYTES:
                    chunk = f.read(_READ_CHUNK)
                    if not chunk:
                        break
                    out += chunk
        except OSError:
            return last_size, ""
        new_offset = last_size + len(out)
        return new_offset, out.decode("utf-8", errors="replace")

    def poll(self, session_id: str, from_offset: int | None = None) -> dict:
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None:
            return {"found": False}
        offset = from_offset if from_offset is not None else s.read_offset
        new_offset, new_output = self._read_incremental(s.tmp_path, offset)
        rc = s.popen.poll()
        running = rc is None
        with self._lock:
            s.read_offset = new_offset
            if not running and s.status == "running":
                s.status = "finished"
        return {
            "found": True,
            "running": running,
            "exit_code": rc,
            "new_output": new_output,
            "offset": new_offset,
        }

    def kill(self, session_id: str) -> dict:
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None:
            return {"found": False, "killed": False}
        killed = False
        try:
            if s.popen.poll() is None:
                s.popen.kill()
                s.popen.wait(timeout=5)
                killed = True
        except Exception:
            logger.warning("[bg-shell] kill failed sid=%s", session_id, exc_info=True)
        with self._lock:
            s.status = "killed"
        self._cleanup_file(s)
        return {"found": True, "killed": killed}

    def _cleanup_file(self, s: _Session) -> None:
        try:
            os.unlink(s.tmp_path)
        except OSError:
            pass

    def sweep(self) -> None:
        now = time.monotonic()
        to_remove: list[str] = []
        with self._lock:
            items = list(self._sessions.items())
        for sid, s in items:
            rc = s.popen.poll()
            if rc is None and now - s.started_at > _MAX_AGE_SECONDS:
                try:
                    s.popen.kill()
                except Exception:
                    pass
                rc = -1
            if rc is not None:
                self._cleanup_file(s)
                to_remove.append(sid)
        with self._lock:
            for sid in to_remove:
                self._sessions.pop(sid, None)


_GLOBAL_REGISTRY: BackgroundShellRegistry | None = None
_GLOBAL_LOCK = threading.Lock()


def get_background_shell_registry() -> BackgroundShellRegistry:
    global _GLOBAL_REGISTRY
    if _GLOBAL_REGISTRY is None:
        with _GLOBAL_LOCK:
            if _GLOBAL_REGISTRY is None:
                _GLOBAL_REGISTRY = BackgroundShellRegistry()
    return _GLOBAL_REGISTRY
