# 子项目 B：start_service 起常驻服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 agent 一个 `start_service` 工具，能起常驻服务（dev server/uvicorn/pnpm dev），用三种就绪检测之一（stdout 关键词 / HTTP 健康 / 纯等 N 秒）确认服务起来了，服务免被回收、可用 shell_kill 停、后端退出 atexit 兜底全杀。

**Architecture:** 常驻服务 = 永不自己结束的后台命令，等的是「就绪」非「退出」。复用现有 `shell_background_registry`（进程组 Popen + offset 增量读 + killpg/taskkill 杀组）：给 `_Session` 加 `is_service` 标记（免 sweep 回收）+ `kill_all_services`；新建 `service_readiness.py` 就绪检测器（移植 Node `managed-process.ts` 的 stdout/http/wait + fatal 快速失败）；新建 `create_start_service_tool` 工具（自起进程组 Popen + tmpfile，注册 is_service，跑就绪检测）；看日志/停服务复用 A 的 shell_poll/shell_wait/shell_kill。

**Tech Stack:** Python 3.12 / subprocess（进程组）/ http.client / langchain StructuredTool / pytest（`cd apps/server && uv run pytest`）。

---

## 背景速读（实现者零上下文也能懂）

- 现有 `apps/server/src/service/shell_background_registry.py`：全局单例，`_Session(popen, tmp_path, read_offset, command, started_at, status="running")`；`register(*, popen, tmp_path, read_offset, command) -> sid`；`poll`/`wait`/`kill`/`sweep`；`_read_incremental(tmp_path, last_size) -> (new_offset, text)`；`_terminate(popen)` 杀进程组（Win: CTRL_BREAK + `taskkill /F /T`；POSIX: `os.killpg(SIGKILL)`）；常量 `_MAX_AGE_SECONDS = 3600`、`_WAIT_HARD_CAP = 300`。`sweep()` 对超龄（>3600s）仍在跑的进程会 `_terminate` 并回收。
- 起进程组的标准 kwargs（从 `skill_shell_backend.py` 抄）：
  ```python
  import sys
  _pg_kwargs = (
      {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
      if sys.platform == "win32"
      else {"start_new_session": True}
  )
  ```
  起进程：`stdout` 重定向到一个 `tempfile.NamedTemporaryFile(delete=False, suffix=".stdout")`、`stderr=subprocess.STDOUT`、`shell=True`。
- A 的工具工厂都在 `apps/server/src/service/agent/shell_execute_tool.py`（`create_shell_execute_tool`/`create_shell_poll_tool`/`create_shell_kill_tool`/`create_shell_wait_tool`），用 `StructuredTool.from_function`，module 顶部已 import `BaseTool, StructuredTool`（langchain_core.tools）、`BaseModel, Field`（pydantic）。
- 工具注册点：`employee.py`（import 组 + `extra_tools.append(...)`，约 line 24-26 / 231-234）、`orchestrator/agent.py`（import 组 + `orchestrator_tools.append(...)`，约 line 75-77 / 290-293）。
- prompt 插入点：`orchestrator/prompts.py` 的「执行 shell 命令」bullet（A 加的，约 line 35）；`prompts.py` 的「慢命令有节奏地等」bullet（A 加的，约 line 66）。
- **测试坑（沿用 A，务必遵守）**：Win 上对活子进程 `taskkill /F /T` 会把 pytest 自身带走（进程树）。测「停服务/杀服务」时，要么让子进程能被进程组杀且断言写在 kill 之后，要么子进程先自己退出。http 子进程测试用 `127.0.0.1` + 固定端口，测完 `reg.kill`/进程组杀收尾。

## File Structure

- **Modify** `apps/server/src/service/shell_background_registry.py`：`_Session` 加 `is_service`；`register` 加 `is_service` 形参；`sweep` 跳过 service；加 `kill_all_services()`。
- **Create** `apps/server/src/service/service_readiness.py`：`wait_for_service_ready(...)` + 内部读增量 helper。
- **Modify** `apps/server/src/service/agent/shell_execute_tool.py`：加 `create_start_service_tool()`。
- **Modify** `apps/server/src/service/agent/employee.py` + `orchestrator/agent.py`：import + 注册 start_service。
- **Modify** `apps/server/src/service/shell_background_registry.py`（同块1文件）：atexit 注册 kill_all_services。
- **Modify** `apps/server/src/service/agent/orchestrator/prompts.py` + `apps/server/src/service/agent/prompts.py`：加 start_service 指引。
- **Test** `apps/server/tests/test_shell_background_registry.py`、新建 `apps/server/tests/test_service_readiness.py`、`apps/server/tests/test_shell_execute_tool.py`、`apps/server/tests/test_shell_environment_prompt.py`。

---

## Task 1：注册表加 `is_service` 标记 + sweep 豁免

**Files:**
- Modify: `apps/server/src/service/shell_background_registry.py`
- Test: `apps/server/tests/test_shell_background_registry.py`

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_background_registry.py` 末尾追加：

```python
def test_service_session_is_exempt_from_age_sweep(monkeypatch):
    import src.service.shell_background_registry as reg_mod
    reg = get_background_shell_registry()
    # 一个普通后台进程 + 一个 service，都「超龄」
    popen_a, tmp_a = _spawn_to_tmpfile("import time; time.sleep(30)")
    popen_b, tmp_b = _spawn_to_tmpfile("import time; time.sleep(30)")
    sid_normal = reg.register(popen=popen_a, tmp_path=tmp_a, read_offset=0, command="n")
    sid_service = reg.register(popen=popen_b, tmp_path=tmp_b, read_offset=0,
                               command="svc", is_service=True)
    # 让所有进程都被判超龄
    monkeypatch.setattr(reg_mod, "_MAX_AGE_SECONDS", 0)
    reg.sweep()
    # 普通进程被强杀回收；service 仍存活
    assert reg.poll(sid_normal)["found"] is False  # 已回收
    assert reg.poll(sid_service)["found"] is True   # service 豁免
    assert reg.poll(sid_service)["running"] is True
    # 收尾
    reg.kill(sid_service)


def test_kill_all_services_terminates_only_services():
    reg = get_background_shell_registry()
    popen_a, tmp_a = _spawn_to_tmpfile("import time; time.sleep(30)")
    popen_b, tmp_b = _spawn_to_tmpfile("import time; time.sleep(30)")
    sid_normal = reg.register(popen=popen_a, tmp_path=tmp_a, read_offset=0, command="n")
    sid_service = reg.register(popen=popen_b, tmp_path=tmp_b, read_offset=0,
                               command="svc", is_service=True)
    n = reg.kill_all_services()
    assert n >= 1
    time.sleep(0.5)
    assert popen_b.poll() is not None   # service 被杀
    assert popen_a.poll() is None       # 普通进程未受影响
    # 收尾
    reg.kill(sid_normal)
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -k "service" -v`
Expected: FAIL（`register()` 不接受 `is_service`，且无 `kill_all_services`）

- [ ] **Step 3: 实现**

(a) `_Session` dataclass 加字段（在 `status` 行之后）：
```python
    status: str = "running"  # running | finished | killed
    is_service: bool = False
```

(b) `register` 方法签名 + 构造加 `is_service`：
```python
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
```

(c) `sweep()` 中超龄强杀分支跳过 service。把现有：
```python
            if rc is None and now - s.started_at > _MAX_AGE_SECONDS:
                self._terminate(s.popen)
                rc = -1
```
改为：
```python
            if rc is None and not s.is_service and now - s.started_at > _MAX_AGE_SECONDS:
                self._terminate(s.popen)
                rc = -1
```

(d) 在 `sweep` 方法之后、`_GLOBAL_REGISTRY` 模块级变量之前，加 `kill_all_services` 方法：
```python
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -k "service" -v`
Expected: PASS（2 个）

- [ ] **Step 5: 全量注册表测试无回归**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -v`
Expected: 全部 PASS（含原 poll/kill/wait/grandchild）

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/shell_background_registry.py apps/server/tests/test_shell_background_registry.py
git commit -m "feat(shell): 注册表加 is_service 标记(免sweep回收)+kill_all_services+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2：就绪检测器 `service_readiness.py`

**Files:**
- Create: `apps/server/src/service/service_readiness.py`
- Test: `apps/server/tests/test_service_readiness.py`

- [ ] **Step 1: 写失败测试**

新建 `apps/server/tests/test_service_readiness.py`：

```python
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
    # 起一个真 http.server 子进程，固定端口
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_service_readiness.py -v`
Expected: FAIL（`ModuleNotFoundError: ... service_readiness`）

- [ ] **Step 3: 实现 `service_readiness.py`**

新建 `apps/server/src/service/service_readiness.py`：

```python
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_service_readiness.py -v`
Expected: 6 passed

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/service_readiness.py apps/server/tests/test_service_readiness.py
git commit -m "feat(shell): 服务就绪检测器(stdout/http/wait+fatal快速失败,移植Node蓝本)+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3：`create_start_service_tool` 工具

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_start_service_tool_stdout_ready_returns_service_id():
    import sys
    from src.service.agent.shell_execute_tool import create_start_service_tool
    from src.service.shell_background_registry import get_background_shell_registry

    tool = create_start_service_tool()
    # 一个「假服务」：打印就绪行后常驻
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
    # 提取 service_id 并确认能被 poll/kill 接住
    import re
    m = re.search(r"service_id=([0-9a-f]+)", out)
    assert m
    sid = m.group(1)
    reg = get_background_shell_registry()
    assert reg.poll(sid)["found"] is True
    reg.kill(sid)  # 收尾


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
        # 不传 port
    })
    assert isinstance(out, str)
    assert "port" in out.lower()
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k start_service -v`
Expected: FAIL（`ImportError: cannot import name 'create_start_service_tool'`）

- [ ] **Step 3: 实现 — 追加到 `shell_execute_tool.py` 末尾**

```python
def create_start_service_tool() -> BaseTool:
    import subprocess
    import sys
    import tempfile

    from src.service.service_readiness import wait_for_service_ready
    from src.service.shell_background_registry import get_background_shell_registry

    class _StartServiceInput(BaseModel):
        command: str = Field(description="要起的常驻服务命令（dev server / uvicorn / pnpm dev 等）")
        ready: dict | None = Field(
            default=None,
            description=(
                "就绪判定（三选一）：{'type':'stdout','pattern':'Application startup complete'} "
                "或 {'type':'http','path':'/','interval':0.5}（需传 port）"
                "或 {'type':'wait','seconds':8}（纯等兜底）。不传默认 wait 8s。"
            ),
        )
        cwd: str | None = Field(default=None, description="工作目录，默认当前进程 cwd")
        ready_timeout: int = Field(default=30, description="等就绪最多秒数（上限120）")
        host: str = Field(default="127.0.0.1", description="只允许 127.0.0.1 或 localhost")
        port: int | None = Field(default=None, description="http 就绪模式必传：服务监听端口")
        fatal_patterns: list[str] | None = Field(
            default=None,
            description="子进程输出命中任一即判失败（如 'Address already in use'）",
        )

    def _start_service(
        command: str,
        ready: dict | None = None,
        cwd: str | None = None,
        ready_timeout: int = 30,
        host: str = "127.0.0.1",
        port: int | None = None,
        fatal_patterns: list[str] | None = None,
    ) -> str:
        if host not in ("127.0.0.1", "localhost"):
            return f"[起服务失败] host 只允许 127.0.0.1 或 localhost，收到 {host}。"
        ready = ready or {"type": "wait", "seconds": 8}
        if ready.get("type") == "http" and not port:
            return "[起服务失败] http 就绪模式必须传 port（服务监听端口）；或改用 stdout/wait 模式。"

        tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout")
        tmp.close()
        handle = open(tmp.name, "ab")
        _pg_kwargs = (
            {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
            if sys.platform == "win32"
            else {"start_new_session": True}
        )
        try:
            popen = subprocess.Popen(  # noqa: S602
                command,
                stdout=handle,
                stderr=subprocess.STDOUT,
                shell=True,
                cwd=cwd or None,
                **_pg_kwargs,
            )
        finally:
            handle.close()

        reg = get_background_shell_registry()
        sid = reg.register(
            popen=popen, tmp_path=tmp.name, read_offset=0,
            command=command, is_service=True,
        )
        r = wait_for_service_ready(
            popen=popen, tmp_path=tmp.name, ready=ready,
            host=host, port=port, ready_timeout=ready_timeout,
            fatal_patterns=fatal_patterns or [], read_offset=0,
        )
        body = r.get("new_output") or "(无输出)"
        if r.get("ready"):
            return (
                f"[服务已就绪] service_id={sid}\n启动输出:\n{body}\n"
                f"[可用 shell_poll(service_id) 看日志、shell_wait(service_id,N) 等日志、"
                f"shell_kill(service_id) 停服务]"
            )
        if r.get("fatal"):
            reg.kill(sid)
            return f"[起服务失败] 命中致命输出: {r.get('fatal_line')}\n{body}"
        if r.get("exited"):
            return (
                f"[服务启动即退出 exit_code={r.get('exit_code')}] "
                f"可能不是常驻命令或配置有误:\n{body}"
            )
        # timed_out：不杀
        return (
            f"service_id={sid} [尚未就绪，已等{ready_timeout}s] 服务可能仍在启动，"
            f"用 shell_poll(service_id) 继续看，或 shell_kill(service_id) 停。\n{body}"
        )

    return StructuredTool.from_function(
        func=_start_service,
        name="start_service",
        args_schema=_StartServiceInput,
        description=(
            "起一个**常驻服务**（dev server / uvicorn / pnpm dev 等永不自己结束的命令），"
            "等它就绪后返回 service_id。ready 指定就绪判定（stdout 关键词 / http 健康探活 / 纯等 N 秒）。"
            "服务免被回收；看日志用 shell_poll/shell_wait(service_id)，停服务用 shell_kill(service_id)。"
            "会结束的普通命令用 shell_execute，不要用本工具。"
        ),
    )
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k start_service -v`
Expected: 3 passed

- [ ] **Step 5: 全量该文件无回归**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -v`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): create_start_service_tool 起常驻服务+三种就绪检测+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4：员工 + 总管注册 start_service + atexit 兜底

**Files:**
- Modify: `apps/server/src/service/agent/employee.py`
- Modify: `apps/server/src/service/agent/orchestrator/agent.py`
- Modify: `apps/server/src/service/shell_background_registry.py`（atexit）
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_start_service_factory_named_correctly():
    from src.service.agent.shell_execute_tool import create_start_service_tool
    assert create_start_service_tool().name == "start_service"


def test_modules_import_start_service():
    import src.service.agent.employee as emp
    import src.service.agent.orchestrator.agent as orch
    assert hasattr(emp, "create_start_service_tool")
    assert hasattr(orch, "create_start_service_tool")


def test_registry_registers_atexit_kill_all_services():
    # 注册表模块 import 时应已把 kill_all_services 挂到 atexit
    import atexit
    import src.service.shell_background_registry as reg_mod
    # 通过反射检查 atexit 注册表里有指向 kill_all_services 的回调
    # CPython: atexit._ncallbacks / 私有，改为更稳的方式——模块暴露一个标记
    assert getattr(reg_mod, "_ATEXIT_REGISTERED", False) is True
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "start_service_factory or modules_import_start_service or atexit_kill_all" -v`
Expected: `test_start_service_factory_named_correctly` PASS；`test_modules_import_start_service` FAIL（未 import）；`test_registry_registers_atexit_kill_all_services` FAIL（无 `_ATEXIT_REGISTERED`）

- [ ] **Step 3: 实现**

(a) `employee.py` import 组（在 `create_shell_wait_tool,` 之后）加：
```python
    create_start_service_tool,
```
注册段（在 `extra_tools.append(create_shell_wait_tool())` 之后）加：
```python
    extra_tools.append(create_start_service_tool())
```

(b) `orchestrator/agent.py` import 组（在 `create_shell_wait_tool,` 之后）加：
```python
    create_start_service_tool,
```
注册段（在 `orchestrator_tools.append(create_shell_wait_tool())` 之后）加：
```python
    orchestrator_tools.append(create_start_service_tool())
```

(c) `shell_background_registry.py` 末尾（`get_background_shell_registry` 函数定义之后）加 atexit 注册：
```python
import atexit  # 放到文件顶部 import 区（与现有 import 一起）

_ATEXIT_REGISTERED = False


def _register_atexit_once() -> None:
    global _ATEXIT_REGISTERED
    if _ATEXIT_REGISTERED:
        return
    atexit.register(lambda: get_background_shell_registry().kill_all_services())
    _ATEXIT_REGISTERED = True


_register_atexit_once()
```
注意：`import atexit` 放到文件顶部已有的 import 块里（和 `import os` 等并列），不要重复 import；`_ATEXIT_REGISTERED`/`_register_atexit_once`/调用放在模块底部（`get_background_shell_registry` 之后）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "start_service_factory or modules_import_start_service or atexit_kill_all" -v`
Expected: 3 passed

- [ ] **Step 5: import 冒烟**

Run: `cd apps/server && uv run python -c "import src.service.agent.employee; import src.service.agent.orchestrator.agent; import src.service.shell_background_registry as r; assert r._ATEXIT_REGISTERED; print('ok')"`
Expected: `ok`

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/employee.py apps/server/src/service/agent/orchestrator/agent.py apps/server/src/service/shell_background_registry.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): 员工+总管注册 start_service + atexit 兜底杀服务+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5：两套 prompt 教用 start_service 起常驻服务

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py`
- Modify: `apps/server/src/service/agent/prompts.py`
- Test: `apps/server/tests/test_shell_environment_prompt.py`

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_environment_prompt.py` 末尾追加：

```python
def test_orchestrator_prompt_has_start_service_guidance():
    from src.service.agent.orchestrator.prompts import (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    )
    assert "start_service" in ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE


def test_employee_prompt_has_start_service_guidance():
    import inspect
    import src.service.agent.prompts as prompts_mod
    assert "start_service" in inspect.getsource(prompts_mod)
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k start_service -v`
Expected: 2 FAIL

- [ ] **Step 3: 实现**

(a) `orchestrator/prompts.py`：在 A 加的「- **执行 shell 命令**：...耐心等。」bullet 之后（用 grep 定位 `执行 shell 命令` 那行），新加一条同级 bullet（column 0）：
```
- **起常驻服务用 start_service**：dev server / uvicorn / `pnpm dev` 这类**永不自己结束**的服务，用 `start_service(command, ready=...)` 起（ready 选 stdout 关键词/http 健康/纯等 N 秒），就绪后返回 service_id；看日志用 shell_poll/shell_wait(service_id)、停服务用 shell_kill(service_id)。**别**用 shell_execute 起服务——它会一直等 timeout 转后台、语义不对。
```

(b) `prompts.py`：在 A 加的「- **慢命令有节奏地等、别试错重试**：...正常跑。」bullet 之后（用 grep 定位 `慢命令有节奏地等`），新加一条同级 bullet（8 空格 + `- `）：
```
        - **起常驻服务用 start_service**：dev server / uvicorn / `pnpm dev` 这类**永不自己结束**的服务，用 `start_service(command, ready=...)` 起（ready 选 stdout 关键词/http 健康/纯等 N 秒），就绪后返回 service_id；看日志 shell_poll/shell_wait(service_id)、停服务 shell_kill(service_id)。**别**用 shell_execute 起服务（会一直等 timeout 转后台、语义不对）。
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k start_service -v`
Expected: 2 passed

- [ ] **Step 5: import 冒烟（确保 prompt 文本插入没破坏模块）**

Run: `cd apps/server && uv run python -c "import src.service.agent.orchestrator.prompts; import src.service.agent.prompts; print('ok')"`
Expected: `ok`

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/src/service/agent/prompts.py apps/server/tests/test_shell_environment_prompt.py
git commit -m "feat(shell): 两套prompt教起常驻服务用start_service(别用shell_execute)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6：全量回归 + import 冒烟 + 手动验证

**Files:** 无新增，仅验证。

- [ ] **Step 1: 全部 shell/service 相关测试**

Run: `cd apps/server && uv run pytest tests/ -k "shell or service" -v`
Expected: 全部 PASS（除 2 个**预先存在**的 `test_shell_error_steering` 失败——`_steer_on_error` 断言陈旧，与本子项目无关，已有独立任务跟进；不要修它们，但确认没有**新增**失败）

- [ ] **Step 2: 四模块 + 注册表 import 冒烟**

Run: `cd apps/server && uv run python -c "import src.service.agent.employee; import src.service.agent.orchestrator.agent; import src.service.agent.prompts; import src.service.agent.orchestrator.prompts; import src.service.service_readiness; import src.service.shell_background_registry; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 手动验证（人工，记录结论）**

重启后端（`pnpm dev:server`），在员工/总管会话里让它起一个常驻服务，观察：
- 起一个 stdout 模式服务（如 `python -m http.server 0` 改成固定端口、或起项目自己的 dev server），ready 用 stdout 关键词或 http 健康 → 工具返回 `[服务已就绪] service_id=...`；
- 用 shell_poll(service_id) 能看到服务日志；
- 用 shell_kill(service_id) 能停掉服务；
- 故意起一个端口占用的服务（先占端口再起）→ 返回 `[起服务失败]` 而非干等；
- 重启后端进程 → 之前起的服务被 atexit 杀掉（不残留占端口）。

记录结论。若模型仍用 shell_execute 起服务，记下来供后续决定是否加引导强度。

---

## 完成定义

- `start_service` 工具存在、员工+总管均注册、三种就绪检测可用、host 校验、http 模式 port 校验。
- 服务 `is_service=True` 免 sweep 回收；`kill_all_services` + atexit 兜底杀服务。
- service_id 即 session_id，能被 shell_poll/shell_wait/shell_kill 接住。
- 两套 prompt + 工具描述都教「起常驻服务用 start_service、别用 shell_execute」。
- 全部 shell/service 测试 PASS（不含 2 个预存的 error_steering 陈旧失败）。

## Self-Review 注记

- service_id 即 session_id：Task 3 注册拿 sid 当 service_id，Task 3 测试 + 手动验证都验 poll/kill 接住。
- `wait_for_service_ready` 返回 dict 的键（ready/exited/exit_code/fatal/fatal_line/timed_out/new_output/offset）：Task 2 定义、Task 3 消费，键名一致。
- `register(..., is_service=True)`：Task 1 加形参、Task 3 调用，一致。
- atexit 用 `_ATEXIT_REGISTERED` 标记，Task 4 测试断言它——避免依赖 atexit 私有 API。
