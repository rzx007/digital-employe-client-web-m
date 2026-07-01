"""后台 shell 进程注册表：shell_execute 直接后台 / 超时转后台时，把 Popen + 临时输出文件
移交此处，模型用 shell_poll/shell_wait/shell_kill 查状态/读增量/终止；前端后台任务面板用
list_snapshot 渲染 Running/Finished。进程级全局单例。

克制版（2026-06-25）相对被排除的 v2 的改动：
- 去掉 is_service / start_service 相关（本期不做常驻服务）。
- sweep **绝不按龄强杀 running 任务**（小时级长任务合法），只回收 finished 条目，且保留
  一段时间（_FINISHED_RETENTION）供面板显示 Finished。
- 条目带 workspace_id/conversation_id/intent/started_wall，供面板按会话过滤与计时。
- finished 首次被发现时发 shell_task_finished 事件（面板定向失效刷新）。
"""

from __future__ import annotations

import atexit
import logging
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_READ_CHUNK = 65536
_MAX_POLL_BYTES = 64 * 1024
_WAIT_HARD_CAP = 300
_WAIT_POLL_INTERVAL = 0.5
# finished 条目保留时长：供前端面板显示「已完成」一段时间后再移除。
_FINISHED_RETENTION = 1800.0  # 30 min
# 惰性 sweep 节流间隔：poll/wait/list 调用顺带触发，至多每此秒数 sweep 一次。
_SWEEP_INTERVAL = 30.0


@dataclass
class _Session:
    popen: subprocess.Popen
    tmp_path: str
    read_offset: int
    command: str
    started_at: float  # time.monotonic()，算 sweep/elapsed 用
    started_wall: float  # epoch 秒，前端显示/排序用
    workspace_id: int | None = None
    conversation_id: int | None = None
    intent: str | None = None
    status: str = "running"  # running | finished | killed
    exit_code: int | None = None
    finished_at: float | None = None  # monotonic，置 finished 时记，sweep 据此过保留窗
    finished_emitted: bool = False  # 防 finished 事件重复发
    consumed_by_agent: bool = False  # agent 是否已主动 poll/wait 拉过结果（续跑去重用）


def process_group_kwargs() -> dict:
    """独立进程组/会话：转后台后 shell_kill 可整组终止，避免父进程退出留孤儿。"""
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def terminate_process_group(popen: subprocess.Popen) -> None:
    """跨平台杀整个进程组，避免 shell 的子孙进程被孤儿化。前台超时杀与后台 kill 共用。"""
    if popen.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            # CREATE_NEW_PROCESS_GROUP 起的进程：先发 CTRL_BREAK 给组，
            # 再用 taskkill /T 杀整棵进程树（TerminateProcess 只杀组长，
            # 子孙会被孤儿化），最后兜底 popen.kill()。
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
        logger.warning("[bg-shell] terminate_process_group failed pid=%s", popen.pid, exc_info=True)


class BackgroundShellRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.Lock()
        self._last_sweep = 0.0

    # ---- 惰性回收：注册表无后台线程，靠 poll/wait/list 调用顺带 sweep（节流 _SWEEP_INTERVAL）。 ----

    def _maybe_sweep(self) -> None:
        now = time.monotonic()
        if now - self._last_sweep < _SWEEP_INTERVAL:
            return
        self._last_sweep = now
        try:
            self.sweep()
        except Exception:
            logger.warning("[bg-shell] lazy sweep failed", exc_info=True)

    # ---- 登记 ----

    def register(
        self,
        *,
        popen: subprocess.Popen,
        tmp_path: str,
        read_offset: int,
        command: str,
        workspace_id: int | None = None,
        conversation_id: int | None = None,
        intent: str | None = None,
    ) -> str:
        sid = uuid.uuid4().hex
        now = time.monotonic()
        with self._lock:
            self._sessions[sid] = _Session(
                popen=popen,
                tmp_path=tmp_path,
                read_offset=read_offset,
                command=command,
                started_at=now,
                started_wall=time.time(),
                workspace_id=workspace_id,
                conversation_id=conversation_id,
                intent=intent,
            )
        self._emit_event("shell_task_started", sid)
        return sid

    # ---- 读输出 ----

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

    def _settle_if_exited(self, sid: str, s: _Session, rc: int | None) -> None:
        """进程已退出 → 置 finished、记 exit_code/finished_at，首次发 finished 事件。
        调用方须在持锁前先取 rc=popen.poll()。"""
        if rc is None:
            return
        emit = False
        with self._lock:
            if s.status == "running":
                s.status = "finished"
                s.exit_code = rc
                s.finished_at = time.monotonic()
            if not s.finished_emitted:
                s.finished_emitted = True
                emit = True
        if emit:
            self._emit_event("shell_task_finished", sid)

    def poll(
        self,
        session_id: str,
        from_offset: int | None = None,
        agent_initiated: bool = False,
    ) -> dict:
        self._maybe_sweep()
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None:
            return {"found": False}
        offset = from_offset if from_offset is not None else s.read_offset
        new_offset, new_output = self._read_incremental(s.tmp_path, offset)
        rc = s.popen.poll()
        with self._lock:
            s.read_offset = new_offset
            if agent_initiated:
                s.consumed_by_agent = True
        self._settle_if_exited(session_id, s, rc)
        return {
            "found": True,
            "running": rc is None,
            "exit_code": rc,
            "new_output": new_output,
            "offset": new_offset,
        }

    def wait(
        self,
        session_id: str,
        max_seconds: int,
        agent_initiated: bool = False,
    ) -> dict:
        """阻塞等命令结束或最多 max_seconds（硬顶 _WAIT_HARD_CAP）秒。

        同步轮询 popen.poll()，跑在工具执行线程、不占 LLM 连接。
        """
        self._maybe_sweep()
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
            if agent_initiated:
                s.consumed_by_agent = True
        self._settle_if_exited(session_id, s, rc)
        return {
            "found": True,
            "finished": rc is not None,
            "exit_code": rc,
            "new_output": new_output,
            "offset": new_offset,
            "waited_seconds": round(waited, 2),
        }

    def is_consumed_by_agent(self, session_id: str) -> bool:
        """agent 是否已主动 poll/wait 拉过该命令结果（续跑去重用）。未知 session 返回 False。"""
        with self._lock:
            s = self._sessions.get(session_id)
            return bool(s and s.consumed_by_agent)

    # ---- 终止 ----

    def _terminate(self, popen: subprocess.Popen) -> None:
        terminate_process_group(popen)

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
            if s.finished_at is None:
                s.finished_at = time.monotonic()
        # 不在此删文件：留在保留窗内供面板「点开看日志」，超窗由 sweep 清。
        return {"found": True, "killed": killed}

    def _cleanup_file(self, s: _Session) -> None:
        try:
            os.unlink(s.tmp_path)
        except OSError:
            pass

    # ---- 回收 ----

    def sweep(self) -> None:
        """回收 finished/killed 条目：
        - running：**绝不**按龄强杀（小时级长任务合法），完全不动。
        - 刚发现退出：置 finished + 清临时文件（但保留条目供面板显示）。
        - finished/killed 超 _FINISHED_RETENTION：从表移除。
        """
        now = time.monotonic()
        to_remove: list[str] = []
        with self._lock:
            items = list(self._sessions.items())
        for sid, s in items:
            if s.status == "running":
                rc = s.popen.poll()
                if rc is not None:
                    self._settle_if_exited(sid, s, rc)
                # running 未退出 → 不动；刚退出也**不删文件**，留给面板「点开看日志」用。
                continue
            # finished / killed：保留窗内文件留着供回看；超窗才删条目 + 清文件。
            ref = s.finished_at if s.finished_at is not None else s.started_at
            if now - ref >= _FINISHED_RETENTION:
                self._cleanup_file(s)
                to_remove.append(sid)
        if to_remove:
            with self._lock:
                for sid in to_remove:
                    self._sessions.pop(sid, None)

    def kill_all(self) -> int:
        """杀掉所有仍在跑的后台进程组（供 atexit 兜底防泄漏）。返回杀掉个数。"""
        killed = 0
        with self._lock:
            items = list(self._sessions.items())
        for sid, s in items:
            try:
                if s.popen.poll() is None:
                    self._terminate(s.popen)
                    killed += 1
            except Exception:
                logger.warning("[bg-shell] kill_all failed sid=%s", sid, exc_info=True)
            with self._lock:
                s.status = "killed"
            self._cleanup_file(s)
        return killed

    # ---- 面板数据 ----

    def list_snapshot(
        self,
        workspace_id: int | None = None,
        conversation_id: int | None = None,
    ) -> list[dict]:
        """前端后台任务面板数据源：按 workspace_id（必）+ conversation_id（可选）过滤，
        按 started_wall 倒序。running 任务先刷新一次退出态，确保面板状态新鲜。"""
        self._maybe_sweep()
        now = time.monotonic()
        with self._lock:
            items = list(self._sessions.items())
        rows: list[dict] = []
        for sid, s in items:
            if workspace_id is not None and s.workspace_id != workspace_id:
                continue
            if conversation_id is not None and s.conversation_id != conversation_id:
                continue
            if s.status == "running":
                rc = s.popen.poll()
                if rc is not None:
                    self._settle_if_exited(sid, s, rc)
            running = s.status == "running"
            if running:
                elapsed = now - s.started_at
            elif s.finished_at is not None:
                elapsed = s.finished_at - s.started_at
            else:
                elapsed = now - s.started_at
            rows.append(
                {
                    "session_id": sid,
                    "command": s.command,
                    "intent": s.intent,
                    "status": s.status,
                    "running": running,
                    "exit_code": s.exit_code,
                    "started_wall": s.started_wall,
                    "elapsed_seconds": round(elapsed, 1),
                }
            )
        rows.sort(key=lambda r: r["started_wall"], reverse=True)
        return rows

    def read_output_tail(self, session_id: str, max_bytes: int = _MAX_POLL_BYTES) -> dict:
        """面板「点开看日志」：只读返回该 session 的输出末尾 max_bytes（不动 agent 的 read_offset）。
        文件大时取尾部，payload 有界；条目已被回收/文件已清则 output 为空。"""
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None:
            return {"found": False}
        rc = s.popen.poll()
        self._settle_if_exited(session_id, s, rc)
        try:
            size = os.path.getsize(s.tmp_path)
        except OSError:
            size = 0
        output = ""
        truncated_head = False
        if size > 0:
            start = max(0, size - max_bytes)
            truncated_head = start > 0
            try:
                with open(s.tmp_path, "rb") as f:
                    f.seek(start)
                    data = f.read(max_bytes)
                output = data.decode("utf-8", errors="replace")
            except OSError:
                output = ""
        return {
            "found": True,
            "running": rc is None,
            "exit_code": rc,
            "status": s.status,
            "command": s.command,
            "intent": s.intent,
            "output": output,
            "truncated_head": truncated_head,
            "total_size": size,
        }

    # ---- 事件 ----

    def _emit_event(self, event_type: str, session_id: str) -> None:
        """发 workspace 事件让前端面板定向失效刷新。fail-open：无 ws/总线则静默。"""
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None or s.workspace_id is None:
            return
        try:
            from src.service.workspace_events import WorkspaceEventBus

            WorkspaceEventBus.push(
                s.workspace_id,
                {
                    "type": event_type,
                    "session_id": session_id,
                    "workspace_id": s.workspace_id,
                    "conversation_id": s.conversation_id,
                },
            )
        except Exception:
            logger.debug("[bg-shell] emit %s failed", event_type, exc_info=True)


_GLOBAL_REGISTRY: BackgroundShellRegistry | None = None
_GLOBAL_LOCK = threading.Lock()


def get_background_shell_registry() -> BackgroundShellRegistry:
    global _GLOBAL_REGISTRY
    if _GLOBAL_REGISTRY is None:
        with _GLOBAL_LOCK:
            if _GLOBAL_REGISTRY is None:
                _GLOBAL_REGISTRY = BackgroundShellRegistry()
    return _GLOBAL_REGISTRY


_ATEXIT_REGISTERED = False


def _register_atexit_once() -> None:
    global _ATEXIT_REGISTERED
    if _ATEXIT_REGISTERED:
        return
    atexit.register(lambda: get_background_shell_registry().kill_all())
    _ATEXIT_REGISTERED = True


_register_atexit_once()
