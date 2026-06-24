# shell_execute 超时转后台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 的 shell_execute 在命令超过 timeout 仍未完成时不杀进程、转后台并返回 session_id，模型用 shell_poll/shell_kill 查/杀；随后把上一轮临时改坏的 LLM read_timeout=None 恢复为有限值。

**Architecture:** 进程级全局后台注册表（新文件）持有移交来的 Popen+临时文件；改 aexecute 超时分支：`allow_background=True` 时移交注册表而非 kill，返回 session_id；工具层加 timeout 参数 + 新增 poll/kill 两工具并在员工/总管两处注册；最后独立提交把 factory read_timeout 从 None 改回 180s。

**Tech Stack:** Python FastAPI + asyncio/subprocess + pytest（`cd apps/server && uv run pytest`）。

**关联 spec:** `docs/superpowers/specs/2026-06-19-shell-timeout-to-background-design.md`

**前置已确认事实（代码核查，dev 分支）：**
- `skill_shell_backend.py`：`aexecute(self, command, *, timeout=None, tool_call_id=None)`（:335-341），`effective_timeout`（:343）。线程侧 `_read_lines_sync`（:407-482）：`Popen(rewritten, stdout=临时文件 handle, stderr=STDOUT, shell=True, env, cwd)`（:415-422），`_proc_ref.append(proc)`（:424）；finally（:470-481）`if cancel_requested.is_set() and proc.poll() is None: proc.kill(); proc.wait()`，`put(None)`，`os.unlink(_tmp_path)`。增量读 helper `_read_incremental_from_tmp(last_size, partial_line)→(last_size, partial_line, lines)`（:363-393，模块内闭包，用 `_tmp_path`/`_READ_CHUNK=65536`）。async 侧 finally（:565-585）：`if not completed_normally: cancel_requested.set(); proc.kill()`。超时返回（:594-603）`ExecuteResponse(output, exit_code=124, truncated)`。`completed_normally`（:541）、`timed_out`（:488）、`lines`（:486）、`_proc_ref`（:354）、`cancel_requested`（:352）均在 aexecute 作用域。
- `shell_execute_tool.py`：`ShellExecuteInput`（:37-52，command/intent），`create_shell_execute_tool(shell, *, artifacts_dir="")`（:55）返回 `StructuredTool.from_function(coroutine=_arun, func=_run, name="shell_execute", args_schema=ShellExecuteInput)`（:83-96）。`_arun`（:66-73）`await shell.aexecute(command, tool_call_id=tool_call_id or None)`。
- 工具注册：`employee.py:226` extra_tools append、`orchestrator/agent.py:281` orchestrator_tools append → `create_deep_agent(tools=...)`。
- `factory.py:136`：当前 `read_timeout = None`（上一轮）。
- 测试夹具（`tests/test_shell_stream_output.py`）：`_backend(tmp_path)` 造 `SkillAwareShellBackend(root_dir, skills_root, draft_root=None, timeout=10)`；`asyncio.run(backend.aexecute(cmd))`。跨平台命令：有 `/bin/sh` 用 sh，否则用 `python -c`。

**测试命令：** `cd apps/server && uv run pytest tests/<file> -v`

---

## File Structure

- Create `apps/server/src/service/shell_background_registry.py` — 全局后台进程注册表（Task 1）。
- Modify `apps/server/src/service/skill_shell_backend.py` — aexecute 超时转后台（Task 2）。
- Modify `apps/server/src/service/agent/shell_execute_tool.py` — timeout 参数 + poll/kill 工具（Task 3）。
- Modify `apps/server/src/service/agent/employee.py` + `orchestrator/agent.py` — 注册新工具（Task 4）。
- Modify `apps/server/src/llm/factory.py` — read_timeout 恢复 180s（Task 5，独立）。
- Tests: 新建 `tests/test_shell_background_registry.py`、扩 `tests/test_shell_stream_output.py`、扩 `tests/test_shell_execute_tool.py`、改 `tests/test_llm_factory_timeout.py`。

---

## Task 1: 后台进程注册表（新文件 + 测试）

**Files:**
- Create: `apps/server/src/service/shell_background_registry.py`
- Create: `apps/server/tests/test_shell_background_registry.py`

- [ ] **Step 1: 写失败测试**

新建 `apps/server/tests/test_shell_background_registry.py`：
```python
from __future__ import annotations

import os
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
    popen = subprocess.Popen([sys.executable, "-u", "-c", py_code], stdout=handle, stderr=subprocess.STDOUT)
    handle.close()
    return popen, tmp.name


def test_register_poll_reads_incremental_and_reports_running_then_exit():
    reg = get_background_shell_registry()
    # 进程先打印一行，睡 1s，再打印一行后退出
    popen, tmp = _spawn_to_tmpfile(
        "import time,sys; print('line1',flush=True); time.sleep(1); print('line2',flush=True)"
    )
    sid = reg.register(popen=popen, tmp_path=tmp, read_offset=0, command="t")
    assert isinstance(sid, str) and sid

    time.sleep(0.4)
    r1 = reg.poll(sid)
    assert r1["found"] is True
    assert r1["running"] is True
    assert "line1" in r1["new_output"]
    off1 = r1["offset"]

    time.sleep(1.2)  # 进程应已退出
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
    assert popen.poll() is not None  # 已被杀
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -v`
Expected: FAIL —— 模块/`get_background_shell_registry` 不存在。

- [ ] **Step 3: 实现注册表**

新建 `apps/server/src/service/shell_background_registry.py`：
```python
"""后台 shell 进程注册表：shell_execute 超时转后台时把 Popen + 临时输出文件移交此处，
模型用 shell_poll/shell_kill 查状态/读增量/终止。进程级全局单例。"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_READ_CHUNK = 65536
# 后台长跑命令输出可能很大；poll 单次最多回带这么多字节的新增量（防一次塞爆模型）。
_MAX_POLL_BYTES = 64 * 1024
# 超龄强杀阈值：远超常规执行上限，兜底回收忘了 kill 的后台进程。
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
        """从 tmp_path 的 last_size 偏移读增量（最多 _MAX_POLL_BYTES），按 utf-8 容错解码。"""
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
        """回收已退出 / 超龄的后台进程，删临时文件。可被定期调用。"""
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
```

> 注意：本任务**不删 sweep 调用点的接入**（sweep 由 Task 2/手动触发或后续接定时器）；register 不在此起进程组——进程已由 aexecute 起好移交，进程组在 Task 2 的 Popen 起处加（见 Task 2 Step 4）。kill 杀整组也在 Task 2 落地后于此处增强（见 Task 2 备注）。

- [ ] **Step 4: 运行,确认转绿**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -v`
Expected: PASS（3 用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/shell_background_registry.py apps/server/tests/test_shell_background_registry.py
git commit -m "feat(server): 后台shell进程注册表(register/poll/kill/sweep),供超时转后台用"
```

---

## Task 2: aexecute 超时转后台

**Files:**
- Modify: `apps/server/src/service/skill_shell_backend.py`（aexecute）
- Test: `apps/server/tests/test_shell_stream_output.py`（追加）

- [ ] **Step 1: 写失败测试**

在 `tests/test_shell_stream_output.py` 追加（复用其 `_backend`）：
```python
def test_aexecute_hands_to_background_on_timeout(tmp_path):
    import asyncio
    from src.service.shell_background_registry import get_background_shell_registry

    backend = _backend(tmp_path)
    # 命令跑 5s，但 timeout=1s 且允许转后台 → 应返回 session_id、不杀进程、exit_code 非 124
    code = "import time; print('start', flush=True); time.sleep(5); print('done', flush=True)"
    cmd = f'python -u -c "{code}"' if not __import__("pathlib").Path("/bin/sh").exists() \
        else f"python3 -u -c \\"{code}\\""
    resp = asyncio.run(backend.aexecute(cmd, timeout=1, allow_background=True))
    assert resp.exit_code != 124  # 不是超时失败码
    assert "session_id" in resp.output or "后台" in resp.output
    # 从输出里抠 session_id（实现里格式固定为 session_id=<hex>）
    import re
    m = re.search(r"session_id=([0-9a-f]+)", resp.output)
    assert m, f"未找到 session_id: {resp.output}"
    sid = m.group(1)
    reg = get_background_shell_registry()
    r = reg.poll(sid)
    assert r["found"] is True
    assert r["running"] is True  # 进程仍在后台跑，没被 kill
    reg.kill(sid)  # 收尾，别留后台进程


def test_aexecute_timeout_without_background_still_kills(tmp_path):
    import asyncio
    backend = _backend(tmp_path)
    code = "import time; time.sleep(5)"
    cmd = f'python -u -c "{code}"'
    resp = asyncio.run(backend.aexecute(cmd, timeout=1, allow_background=False))
    assert resp.exit_code == 124  # 维持原超时 kill 行为
```
（跨平台命令构造按文件既有 `/bin/sh` 判断风格调整；关键是「跑得比 timeout 久」。）

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_stream_output.py -k background -v`
Expected: FAIL —— aexecute 无 `allow_background` 参数（TypeError）。

- [ ] **Step 3: aexecute 加参数 + 转后台分支**

`aexecute` 签名（:335-341）加 `allow_background: bool = False`：
```python
    async def aexecute(
        self,
        command: str,
        *,
        timeout: int | None = None,
        tool_call_id: str | None = None,
        allow_background: bool = False,
    ):
```
在 aexecute 作用域加一个「转后台」标志（与 `completed_normally`/`timed_out` 并列，:541 附近）：
```python
        handed_to_background = False
        background_session_id: str | None = None
        background_offset = 0
```
async 侧 finally（:565-585）改为：超时(`timed_out`) 且 `allow_background` 且进程仍在跑时，移交后台、**不** set cancel、**不** kill：
```python
        finally:
            _keepalive_task.cancel()
            if not completed_normally:
                proc = _proc_ref[0] if _proc_ref else None
                can_bg = (
                    timed_out and allow_background and proc is not None
                    and proc.poll() is None and _tmp_path_holder.get("path")
                )
                if can_bg:
                    from src.service.shell_background_registry import (
                        get_background_shell_registry,
                    )
                    # 已读到的字节偏移交给注册表续读（current_output_size 不是字节offset，
                    # 用线程侧维护的 last_size——见 Step 4 把 last_size 暴露出来）。
                    background_offset = _tmp_path_holder.get("last_size", 0)
                    handed_to_background = True
                    background_session_id = get_background_shell_registry().register(
                        popen=proc,
                        tmp_path=_tmp_path_holder["path"],
                        read_offset=background_offset,
                        command=command,
                    )
                else:
                    cancel_requested.set()
                    if proc is not None and proc.poll() is None:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                    try:
                        _emit_batch()
                    except Exception:
                        pass
                    try:
                        await asyncio.wait_for(asyncio.shield(future), timeout=10)
                    except Exception:
                        pass
```
转后台时**不要** await future（让线程自然随进程结束），并在返回处（:594-603 前）加：
```python
        if handed_to_background:
            partial = "\n".join(lines) if lines else ""
            note = (
                f"\n[命令仍在后台运行，session_id={background_session_id}。"
                f"用 shell_poll(session_id) 查询进度/读取新输出，shell_kill(session_id) 终止。"
                f"无需立即轮询——可先继续其它步骤，需要结果时再 poll。]"
            )
            return ExecuteResponse(output=(partial + note), exit_code=0, truncated=bool(lines))
```
（放在 `if timed_out:`（:594）之前，让转后台优先于普通超时返回。）

- [ ] **Step 4: 线程侧——暴露 last_size + 转后台时不删文件/不杀进程**

线程函数 `_read_lines_sync`（:407-482）需要把 `_tmp_path` 和当前 `last_size` 暴露给 async 侧（async 侧 finally 要拿来移交）。最小改法：在 aexecute 作用域加一个共享 dict（在 `_read_lines_sync` 定义前）：
```python
        _tmp_path_holder: dict = {"path": None, "last_size": 0}
```
线程内 `_tmp_path = tmp.name`（:411）后补 `_tmp_path_holder["path"] = _tmp_path`；循环里每次更新 `last_size` 后补 `_tmp_path_holder["last_size"] = last_size`（在 :449 和 :436 赋值后各加一行）。
finally（:470-481）改为：转后台（`handed_to_background`）时跳过 kill 和 unlink——但线程 finally 早于 async 设 `handed_to_background`？**顺序问题**：线程 finally 在进程结束或 cancel 时触发；转后台场景下进程**还在跑**，线程仍在 while 循环里阻塞（未进 finally）。故转后台时线程根本没到 finally——它会继续跑直到进程结束。届时 `cancel_requested` 未 set → 不 kill；但 finally 仍会 `os.unlink(_tmp_path)` 删文件、`put(None)`。这会删掉注册表要读的文件。
**解法**：加一个 `_background_handoff = threading.Event()`，async 转后台时 set 它；线程 finally 改为：
```python
            finally:
                if cancel_requested.is_set() and proc.poll() is None:
                    proc.kill()
                    proc.wait()
                loop.call_soon_threadsafe(queue.put_nowait, None)
                if not _background_handoff.is_set():
                    try:
                        os.unlink(_tmp_path)
                    except Exception:
                        logger.warning("[shell] failed to delete tmpfile %s", _tmp_path, exc_info=True)
```
转后台后文件交由注册表 kill/sweep 删（注册表 `_cleanup_file` 已做）。在 async finally 移交成功后 set：`_background_handoff.set()`（在 register 之后）。
进程组（防孤儿）：Popen（:415-422）加跨平台进程组——
```python
            import sys as _sys
            _popen_kwargs = {}
            if _sys.platform == "win32":
                _popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                _popen_kwargs["start_new_session"] = True
            proc = subprocess.Popen(
                rewritten, stdout=stdout_handle, stderr=subprocess.STDOUT,
                shell=True, env=env, cwd=str(self.cwd), **_popen_kwargs,
            )
```

- [ ] **Step 5: 运行,确认转绿 + 既有 shell 测试不回归**

Run: `cd apps/server && uv run pytest tests/test_shell_stream_output.py tests/test_shell_execute_tool.py tests/test_shell_error_steering.py -v`
Expected: PASS（新 background 用例 + 既有用例都过；`allow_background=False` 路径与原行为一致）。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/skill_shell_backend.py apps/server/tests/test_shell_stream_output.py
git commit -m "feat(server): aexecute超时转后台(allow_background=True移交注册表不kill)+进程组防孤儿"
```

---

## Task 3: 工具层 timeout 参数 + poll/kill 工具

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`（追加）

- [ ] **Step 1: 写失败测试**

读 `tests/test_shell_execute_tool.py` 现有风格，追加：
```python
def test_shell_execute_input_accepts_timeout():
    from src.service.agent.shell_execute_tool import ShellExecuteInput
    m = ShellExecuteInput(command="echo hi", timeout=30)
    assert m.timeout == 30
    m2 = ShellExecuteInput(command="echo hi")
    assert m2.timeout is None


def test_poll_and_kill_tools_exist_and_call_registry(tmp_path):
    import subprocess, sys, tempfile
    from src.service.agent.shell_execute_tool import (
        create_shell_poll_tool, create_shell_kill_tool,
    )
    from src.service.shell_background_registry import get_background_shell_registry

    reg = get_background_shell_registry()
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    h = open(tmp.name, "ab")
    p = subprocess.Popen([sys.executable, "-u", "-c", "print('hi', flush=True)"], stdout=h, stderr=subprocess.STDOUT)
    h.close()
    sid = reg.register(popen=p, tmp_path=tmp.name, read_offset=0, command="t")

    poll_tool = create_shell_poll_tool()
    out = poll_tool.invoke({"session_id": sid})
    assert isinstance(out, str)
    kill_tool = create_shell_kill_tool()
    kout = kill_tool.invoke({"session_id": sid})
    assert isinstance(kout, str)
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "timeout or poll_and_kill" -v`
Expected: FAIL —— ShellExecuteInput 无 timeout 字段 / `create_shell_poll_tool` 不存在。

- [ ] **Step 3: 实现**

`ShellExecuteInput`（:37-52）加字段：
```python
    timeout: int | None = Field(
        default=None,
        description=(
            "可选：前台等待上限（秒）。命令在此时间内完成则直接返回结果；超时仍未完成"
            "则自动转后台运行、返回 session_id（不会丢失），用 shell_poll(session_id) 查进度、"
            "shell_kill(session_id) 终止。不传则用默认上限。预计耗时长的命令建议设一个较小值（如 30）。"
        ),
    )
```
`_arun`（:66-73）改为传 timeout + allow_background：
```python
    async def _arun(
        command: str,
        intent: str | None = None,
        timeout: int | None = None,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        del intent
        response = await shell.aexecute(
            command, timeout=timeout, tool_call_id=tool_call_id or None,
            allow_background=True,
        )
        return format_execute_response(response, shell)
```
`_run`（同步路径）签名也加 `timeout` 占位（同步不转后台，忽略即可：`del intent, tool_call_id, timeout`）。
在文件末尾新增两个工具工厂：
```python
def create_shell_poll_tool() -> BaseTool:
    from src.service.shell_background_registry import get_background_shell_registry

    class _PollInput(BaseModel):
        session_id: str = Field(description="shell_execute 转后台时返回的 session_id")
        offset: int | None = Field(default=None, description="可选：从该字节偏移继续读，默认接上次")

    def _poll(session_id: str, offset: int | None = None) -> str:
        r = get_background_shell_registry().poll(session_id, from_offset=offset)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}（可能已结束并被回收）。"
        status = "运行中" if r["running"] else f"已结束(exit_code={r['exit_code']})"
        body = r["new_output"] or "(无新增输出)"
        return f"[{status}] 新增输出:\n{body}\n[offset={r['offset']}]"

    return StructuredTool.from_function(
        func=_poll, name="shell_poll", args_schema=_PollInput,
        description="查询 shell_execute 转后台的命令：返回新增 stdout、是否仍在运行、退出码。需要结果时再调，勿空转。",
    )


def create_shell_kill_tool() -> BaseTool:
    from src.service.shell_background_registry import get_background_shell_registry

    class _KillInput(BaseModel):
        session_id: str = Field(description="要终止的后台命令 session_id")

    def _kill(session_id: str) -> str:
        r = get_background_shell_registry().kill(session_id)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}。"
        return f"已终止后台命令 session_id={session_id}。" if r["killed"] else "命令已先行结束，无需终止。"

    return StructuredTool.from_function(
        func=_kill, name="shell_kill", args_schema=_KillInput,
        description="终止 shell_execute 转后台运行的命令。",
    )
```

- [ ] **Step 4: 运行,确认转绿**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -v`
Expected: PASS（新用例 + 既有不回归）。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(server): shell_execute加timeout参数(超时转后台)+新增shell_poll/shell_kill工具"
```

---

## Task 4: 员工/总管注册 poll/kill 工具

**Files:**
- Modify: `apps/server/src/service/agent/employee.py`（~226）
- Modify: `apps/server/src/service/agent/orchestrator/agent.py`（~281）

- [ ] **Step 1: 读两处工具拼装**

读 `employee.py` 约 220-240（`extra_tools` 怎么 append `create_shell_execute_tool` 的结果）和 `orchestrator/agent.py` 约 276-302（`orchestrator_tools`）。确认 import 区与 append 位置。

- [ ] **Step 2: 两处各 append poll/kill**

在两个文件 import `create_shell_poll_tool, create_shell_kill_tool`（与现有 `create_shell_execute_tool` 同处 import）。在各自 append `create_shell_execute_tool(...)` 之后补：
```python
    extra_tools.append(create_shell_poll_tool())
    extra_tools.append(create_shell_kill_tool())
```
（employee 用 `extra_tools`，orchestrator 用 `orchestrator_tools`——按各文件真实变量名。不需 `_serialize_db_tool` 包装。）

- [ ] **Step 3: 验证 import 冒烟 + 既有 agent 构建测试**

Run: `cd apps/server && uv run python -c "import src.service.agent.employee, src.service.agent.orchestrator.agent; print('ok')"`
Expected: ok。
Run: `cd apps/server && uv run pytest tests/ -k "orchestrator or employee or agent" -v`
Expected: PASS（若有相关构建测试；新工具不破坏构建）。

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/service/agent/employee.py apps/server/src/service/agent/orchestrator/agent.py
git commit -m "feat(server): 员工/总管agent注册shell_poll/shell_kill工具"
```

---

## Task 5: 恢复 read_timeout 为 180s（独立提交）

**Files:**
- Modify: `apps/server/src/llm/factory.py:136`
- Modify: `apps/server/tests/test_llm_factory_timeout.py`

- [ ] **Step 1: 改测试断言（先红）**

把 `tests/test_llm_factory_timeout.py` 里断言 `t.read is None` 的那条改为：
```python
    assert t.read == 180.0
```
（其余 connect/write/pool 断言不变。）

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_llm_factory_timeout.py -v`
Expected: FAIL —— 当前 read 是 None 不是 180.0。

- [ ] **Step 3: 改 factory**

`factory.py:136` 把 `read_timeout = None` 改为：
```python
    # 命令耗时已由 shell_execute 超时转后台机制承接（不再占 LLM 连接），read 回到
    # 「纯模型 chunk 间隙」：180s 与 agent_chunk_timeout 对齐，让模型真挂死/半开连接
    # 较快被 httpx 断连重连（max_retries=2），不必干等到 900s 应用层 watchdog。
    read_timeout = min(180.0, req_timeout)
```

- [ ] **Step 4: 运行,确认转绿**

Run: `cd apps/server && uv run pytest tests/test_llm_factory_timeout.py -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/llm/factory.py apps/server/tests/test_llm_factory_timeout.py
git commit -m "fix(server): read_timeout从None恢复为180s(超时转后台已承接长命令,read回归chunk间隙)"
```

---

## Self-Review

**Spec coverage:**
- 块1 注册表（register/poll/kill/sweep、全局单例、读增量、防僵尸 wait）→ Task 1。✓
- 块2 aexecute 转后台（allow_background、超时不 kill 移交、线程不删文件、进程组防孤儿、allow_background=False 维持原行为）→ Task 2。✓
- 块3 timeout 参数 + poll/kill 工具 → Task 3。✓
- 块4 两处注册 → Task 4。✓
- 块5 read 恢复 180s 独立提交 → Task 5。✓
- 防模型空轮询：工具 description 明确「需要时再 poll、勿空转」→ Task 3 工具描述。✓
- 不在本期范围（watch_patterns/完成通知/落盘恢复）→ 计划未涉及。✓

**Placeholder scan:** Task 2 Step 4 含较多「顺序/线程时序」分析说明（_background_handoff Event 解决线程 finally 删文件竞态）——这是真实并发坑的必要说明 + 给了确切代码，非占位。Task 4「按各文件真实变量名」是适配指示（已让 Step 1 先读确认）。无 TBD/空洞。

**Type consistency:** 注册表方法 `register(*, popen, tmp_path, read_offset, command)→str`、`poll(session_id, from_offset=None)→dict{found,running,exit_code,new_output,offset}`、`kill(session_id)→dict{found,killed}` 在 Task 1 定义、Task 2/3 调用一致；`get_background_shell_registry()` 全局取用一致；`aexecute(..., allow_background=False)` 在 Task 2 定义、Task 3 `_arun` 传 `allow_background=True` 一致；`create_shell_poll_tool()/create_shell_kill_tool()` 无参、Task 3 定义 Task 4 调用一致；session_id 格式 `session_id=<hex>` 在 Task 2 返回串与 Task 2 测试正则 `session_id=([0-9a-f]+)` 一致。
