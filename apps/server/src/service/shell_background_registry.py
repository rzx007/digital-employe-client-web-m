"""后台 shell 进程注册表：shell_execute 超时转后台时把 Popen + 临时输出文件移交此处，
模型用 shell_poll/shell_kill 查状态/读增量/终止。进程级全局单例。"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_READ_CHUNK = 65536
_MAX_POLL_BYTES = 64 * 1024
_MAX_AGE_SECONDS = 3600
_WAIT_HARD_CAP = 300
_WAIT_POLL_INTERVAL = 0.5


@dataclass
class _Session:
    popen: subprocess.Popen
    tmp_path: str
    read_offset: int
    command: str
    started_at: float
    status: str = "running"  # running | finished | killed
    is_service: bool = False


class BackgroundShellRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.Lock()

    def register(self, *, popen: subprocess.Popen, tmp_path: str,
                 read_offset: int, command: str, is_service: bool = False) -> str:
        sid = uuid.uuid4().hex
        with self._lock:
            self._sessions[sid] = _Session(
                popen=popen, tmp_path=tmp_path, read_offset=read_offset,
                command=command, started_at=time.monotonic(),
                is_service=is_service,
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

    def wait(self, session_id: str, max_seconds: int) -> dict:
        """阻塞等命令结束或最多 max_seconds（硬顶 _WAIT_HARD_CAP）秒。

        同步轮询 popen.poll()，跑在工具执行线程、不占 LLM 连接。
        读增量复用 _read_incremental + 推进 read_offset（与 poll 共用 offset）。
        """
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None:
            return {"found": False}
        cap = max(0, min(int(max_seconds), _WAIT_HARD_CAP))
        start = time.monotonic()
        rc = s.popen.poll()
        while rc is None and (time.monotonic() - start) < cap:
            time.sleep(_WAIT_POLL_INTERVAL)
            rc = s.popen.poll()
        waited = time.monotonic() - start
        new_offset, new_output = self._read_incremental(s.tmp_path, s.read_offset)
        with self._lock:
            s.read_offset = new_offset
            if rc is not None and s.status == "running":
                s.status = "finished"
        return {
            "found": True,
            "finished": rc is not None,
            "exit_code": rc,
            "new_output": new_output,
            "offset": new_offset,
            "waited_seconds": round(waited, 2),
        }

    def _terminate(self, popen: subprocess.Popen) -> None:
        """跨平台杀整个进程组，避免 shell 的子孙进程被孤儿化。"""
        import sys
        if popen.poll() is not None:
            return
        try:
            if sys.platform == "win32":
                # CREATE_NEW_PROCESS_GROUP 起的进程：先发 CTRL_BREAK 给组，
                # 再用 taskkill /T 杀整棵进程树(TerminateProcess 只杀 shell 组长，
                # 子孙会被孤儿化)，最后兜底 popen.kill()。
                try:
                    popen.send_signal(signal.CTRL_BREAK_EVENT)
                except Exception:
                    pass
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(popen.pid)],
                        capture_output=True,
                        timeout=10,
                    )
                except Exception:
                    pass
                popen.kill()
            else:
                # start_new_session=True → 子进程是新会话/进程组组长，pgid == pid。
                try:
                    os.killpg(os.getpgid(popen.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    popen.kill()  # 兜底：组不存在则直接杀进程
        except Exception:
            logger.warning("[bg-shell] _terminate failed pid=%s", popen.pid, exc_info=True)

    def kill(self, session_id: str) -> dict:
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None:
            return {"found": False, "killed": False}
        killed = False
        try:
            if s.popen.poll() is None:
                self._terminate(s.popen)
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
            if rc is None and not s.is_service and now - s.started_at > _MAX_AGE_SECONDS:
                self._terminate(s.popen)
                rc = -1
            if rc is not None:
                self._cleanup_file(s)
                to_remove.append(sid)
        with self._lock:
            for sid in to_remove:
                self._sessions.pop(sid, None)

    def kill_all_services(self) -> int:
        """杀掉所有 is_service 且仍在跑的服务进程组（供 atexit 兜底）。返回杀掉个数。"""
        killed = 0
        with self._lock:
            items = list(self._sessions.items())
        for sid, s in items:
            if not s.is_service:
                continue
            try:
                if s.popen.poll() is None:
                    self._terminate(s.popen)
                    killed += 1
            except Exception:
                logger.warning("[bg-shell] kill_all_services failed sid=%s", sid, exc_info=True)
            with self._lock:
                s.status = "killed"
            self._cleanup_file(s)
        return killed


_GLOBAL_REGISTRY: BackgroundShellRegistry | None = None
_GLOBAL_LOCK = threading.Lock()


def get_background_shell_registry() -> BackgroundShellRegistry:
    global _GLOBAL_REGISTRY
    if _GLOBAL_REGISTRY is None:
        with _GLOBAL_LOCK:
            if _GLOBAL_REGISTRY is None:
                _GLOBAL_REGISTRY = BackgroundShellRegistry()
    return _GLOBAL_REGISTRY
