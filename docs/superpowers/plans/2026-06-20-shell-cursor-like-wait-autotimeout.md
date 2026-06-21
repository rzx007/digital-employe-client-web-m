# shell 像 Cursor：shell_wait + 默认60s + prompt 引导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 shell 命令达成 Cursor 体验：短命令零负担（默认 60s 同步返回），长命令 60s 自动转后台、模型用新 shell_wait 工具阻塞等结果，prompt 引导"短命令别管、只预判长任务才设 timeout/wait"。

**Architecture:** 在上一轮 shell 超时转后台基础设施（注册表/poll/kill/进程组）之上加 4 块：注册表加 wait 方法 + shell_wait 工具；工具层不传 timeout 时默认 60s（不再落到 backend 1200s）；orchestrator/员工 prompt 加短命令零负担、长任务才 wait 的指引；工具描述强化。

**Tech Stack:** Python FastAPI + asyncio/subprocess + pytest（`cd apps/server && uv run pytest`）。

**关联 spec:** `docs/superpowers/specs/2026-06-20-shell-cursor-like-wait-autotimeout-design.md`

**前置已确认事实（代码核查，dev 分支）：**
- `apps/server/src/service/shell_background_registry.py`：`poll(session_id, from_offset=None)`（:68-87）已有「按 offset 读增量 + 更新 read_offset + popen.poll() 判 running」模式；`_read_incremental(tmp_path, last_size)→(new_offset, str)`（:~50-66）；`_Session` 有 popen/tmp_path/read_offset/status；模块级单例 `get_background_shell_registry()`。
- `apps/server/src/service/agent/shell_execute_tool.py`：`ShellExecuteInput`（command/intent/timeout，timeout 默认 None）；`_arun(command, intent, timeout, tool_call_id)`（:75-88）`await shell.aexecute(command, timeout=timeout, tool_call_id=..., allow_background=True)`——**timeout=None 时 aexecute 落到 `_default_timeout`(1200s)**；`create_shell_poll_tool()`/`create_shell_kill_tool()`（:115+）用 `StructuredTool.from_function(func=..., name=..., args_schema=Pydantic, description=...)` + 内嵌 `from src.service.shell_background_registry import get_background_shell_registry`。
- 默认 timeout 注入点：`employee.py:191` 与 `orchestrator/agent.py:228` 各 `timeout=settings.execute_timeout * 2`（=1200s，传给 `SkillAwareShellBackend(timeout=...)` 作 `_default_timeout`）——**这是 backend 绝对上限，本计划不动**；改的是工具层 `_arun` 在 timeout=None 时传 60。
- prompt：orchestrator = `ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE`（`orchestrator/prompts.py:15`，行 30-31 讲「自己动手 1-2 步 shell」附近可加）；员工 = `build_system_prompt`（`agent/prompts.py`，`employee.py:248` 调用）。
- 工具注册：`employee.py` extra_tools、`orchestrator/agent.py` orchestrator_tools（上一轮已 append poll/kill，shell_wait 同处加）。
- 注册表测试 `tests/test_shell_background_registry.py`、工具测试 `tests/test_shell_execute_tool.py` 已存在。

**测试命令：** `cd apps/server && uv run pytest tests/<file> -v`

---

## File Structure

- Modify `apps/server/src/service/shell_background_registry.py` — 加 `wait` 方法（Task 1）。
- Modify `apps/server/src/service/agent/shell_execute_tool.py` — `create_shell_wait_tool` + _arun 默认 60s + 描述（Task 2、3）。
- Modify `apps/server/src/service/agent/employee.py` + `orchestrator/agent.py` — 注册 shell_wait（Task 2）。
- Modify `apps/server/src/service/agent/orchestrator/prompts.py` + `agent/prompts.py` — prompt 引导（Task 4）。

---

## Task 1: 注册表 wait 方法（先红后绿）

**Files:**
- Modify: `apps/server/src/service/shell_background_registry.py`
- Test: `apps/server/tests/test_shell_background_registry.py`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_shell_background_registry.py`（复用其 `_spawn_to_tmpfile`）：
```python
def test_wait_returns_when_process_finishes_within_max():
    reg = get_background_shell_registry()
    popen, tmp = _spawn_to_tmpfile(
        "import time; print('a', flush=True); time.sleep(1); print('b', flush=True)"
    )
    sid = reg.register(popen=popen, tmp_path=tmp, read_offset=0, command="t")
    r = reg.wait(sid, 5)
    assert r["found"] is True
    assert r["finished"] is True
    assert r["exit_code"] is not None
    assert "a" in r["new_output"] and "b" in r["new_output"]
    assert r["waited_seconds"] <= 5


def test_wait_times_out_when_process_still_running():
    reg = get_background_shell_registry()
    popen, tmp = _spawn_to_tmpfile("import time; time.sleep(30)")
    sid = reg.register(popen=popen, tmp_path=tmp, read_offset=0, command="t")
    r = reg.wait(sid, 1)
    assert r["found"] is True
    assert r["finished"] is False
    assert r["waited_seconds"] >= 1
    reg.kill(sid)  # 收尾


def test_wait_unknown_session():
    reg = get_background_shell_registry()
    assert reg.wait("nope", 1)["found"] is False
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -k wait -v`
Expected: FAIL —— registry 无 `wait` 方法（AttributeError）。

- [ ] **Step 3: 实现 wait**

在 `shell_background_registry.py` 顶部常量区加 `_WAIT_HARD_CAP = 300`（与 `_MAX_AGE_SECONDS` 等并列）。在 `poll` 方法之后加：
```python
    def wait(self, session_id: str, max_seconds: int) -> dict:
        """阻塞等命令结束或最多 max_seconds（夹到 _WAIT_HARD_CAP 防死等）。
        期间短间隔轮询 popen，不占 LLM 连接（跑在工具执行线程）。返回时带回累计增量。
        """
        with self._lock:
            s = self._sessions.get(session_id)
        if s is None:
            return {"found": False}
        cap = max(0, min(int(max_seconds), _WAIT_HARD_CAP))
        start_offset = s.read_offset
        start = time.monotonic()
        rc = s.popen.poll()
        while rc is None and (time.monotonic() - start) < cap:
            time.sleep(0.5)
            rc = s.popen.poll()
        waited = time.monotonic() - start
        new_offset, new_output = self._read_incremental(s.tmp_path, start_offset)
        running = rc is None
        with self._lock:
            s.read_offset = new_offset
            if not running and s.status == "running":
                s.status = "finished"
        return {
            "found": True,
            "finished": not running,
            "exit_code": rc,
            "new_output": new_output,
            "offset": new_offset,
            "waited_seconds": round(waited, 1),
        }
```
（`_read_incremental`/`_Session`/`_lock`/`time` 均已在文件内。读增量用 `start_offset`——wait 期间不读，结束后一次性读从进入时到现在的全部增量，与 poll 的 offset 推进一致。）

- [ ] **Step 4: 运行,确认转绿**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -v`
Expected: PASS（3 新 + 既有 register/poll/kill/grandchild 用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/shell_background_registry.py apps/server/tests/test_shell_background_registry.py
git commit -m "feat(server): 后台shell注册表加wait(阻塞等结束或最多N秒,硬顶300s)"
```

---

## Task 2: shell_wait 工具 + 两处注册（先红后绿）

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`
- Modify: `apps/server/src/service/agent/employee.py`、`apps/server/src/service/agent/orchestrator/agent.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_shell_execute_tool.py`：
```python
def test_shell_wait_tool_calls_registry():
    import subprocess, sys, tempfile
    from src.service.agent.shell_execute_tool import create_shell_wait_tool
    from src.service.shell_background_registry import get_background_shell_registry

    reg = get_background_shell_registry()
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    h = open(tmp.name, "ab")
    p = subprocess.Popen([sys.executable, "-u", "-c", "print('done', flush=True)"],
                         stdout=h, stderr=subprocess.STDOUT)
    h.close()
    p.wait()  # 先退出，避免 wait 走死等/kill
    sid = reg.register(popen=p, tmp_path=tmp.name, read_offset=0, command="t")
    tool = create_shell_wait_tool()
    out = tool.invoke({"session_id": sid, "max_seconds": 3})
    assert isinstance(out, str)
    assert "done" in out or "已结束" in out or "完成" in out


def test_shell_wait_unknown_session_message():
    from src.service.agent.shell_execute_tool import create_shell_wait_tool
    out = create_shell_wait_tool().invoke({"session_id": "nope", "max_seconds": 1})
    assert "未找到" in out
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k shell_wait -v`
Expected: FAIL —— `create_shell_wait_tool` 不存在。

- [ ] **Step 3: 实现 shell_wait 工具**

在 `shell_execute_tool.py` 末尾（poll/kill 工具之后）加：
```python
def create_shell_wait_tool() -> BaseTool:
    from src.service.shell_background_registry import get_background_shell_registry

    class _WaitInput(BaseModel):
        session_id: str = Field(description="shell_execute 转后台时返回的 session_id")
        max_seconds: int = Field(
            default=60,
            description="最多阻塞等这么多秒（命令更早结束则提前返回；硬顶 300s）",
        )

    def _wait(session_id: str, max_seconds: int = 60) -> str:
        r = get_background_shell_registry().wait(session_id, max_seconds)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}（可能已结束并被回收）。"
        body = r["new_output"] or "(无新增输出)"
        if r["finished"]:
            return f"[已结束 exit_code={r['exit_code']}] 输出:\n{body}\n[offset={r['offset']}]"
        return (
            f"[等了 {r['waited_seconds']}s 仍在运行] 新增输出:\n{body}\n"
            f"[offset={r['offset']}] 可再 shell_wait(session_id) 等，或先做别的、需要时再查。"
        )

    return StructuredTool.from_function(
        func=_wait,
        name="shell_wait",
        args_schema=_WaitInput,
        description=(
            "阻塞等一个转后台的 shell 命令结束或最多 N 秒，返回最终输出/退出码或当前进度。"
            "长任务转后台后要等结果时优先用它，而不是反复 shell_poll 空轮询。"
        ),
    )
```

- [ ] **Step 4: 两处注册 shell_wait**

`employee.py`：在 import 处加 `create_shell_wait_tool`（与现有 `create_shell_poll_tool, create_shell_kill_tool` 同行），在 append poll/kill 之后加 `extra_tools.append(create_shell_wait_tool())`。
`orchestrator/agent.py`：同理 import + `orchestrator_tools.append(create_shell_wait_tool())`。

- [ ] **Step 5: 运行,确认转绿 + import 冒烟**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -v`
Expected: PASS。
Run: `cd apps/server && uv run python -c "import src.service.agent.employee, src.service.agent.orchestrator.agent; print('ok')"`
Expected: ok。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/src/service/agent/employee.py apps/server/src/service/agent/orchestrator/agent.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(server): 新增shell_wait工具(等后台命令结果)+员工/总管注册"
```

---

## Task 3: 工具层默认前台 timeout 改 60s + timeout 描述

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`（追加）

- [ ] **Step 1: 写失败测试**

追加：
```python
def test_arun_uses_60s_default_when_timeout_omitted(monkeypatch, tmp_path):
    import asyncio
    from src.service.agent import shell_execute_tool as sut
    from src.service.skill_shell_backend import SkillAwareShellBackend

    captured = {}

    skills = tmp_path / "skills"; skills.mkdir()
    artifacts = tmp_path / "artifacts"; artifacts.mkdir()
    backend = SkillAwareShellBackend(root_dir=str(artifacts), skills_root=skills,
                                     draft_root=None, timeout=1200)

    async def fake_aexecute(command, *, timeout=None, tool_call_id=None, allow_background=False):
        captured["timeout"] = timeout
        from deepagents.backends.protocol import ExecuteResponse
        return ExecuteResponse(output="ok", exit_code=0)

    monkeypatch.setattr(backend, "aexecute", fake_aexecute)
    tool = sut.create_shell_execute_tool(backend)
    # 不传 timeout 调用
    asyncio.run(tool.coroutine(command="echo hi", tool_call_id="x"))
    assert captured["timeout"] == 60


def test_arun_passes_model_timeout_when_given(monkeypatch, tmp_path):
    import asyncio
    from src.service.agent import shell_execute_tool as sut
    from src.service.skill_shell_backend import SkillAwareShellBackend

    captured = {}
    skills = tmp_path / "skills"; skills.mkdir()
    artifacts = tmp_path / "artifacts"; artifacts.mkdir()
    backend = SkillAwareShellBackend(root_dir=str(artifacts), skills_root=skills,
                                     draft_root=None, timeout=1200)

    async def fake_aexecute(command, *, timeout=None, tool_call_id=None, allow_background=False):
        captured["timeout"] = timeout
        from deepagents.backends.protocol import ExecuteResponse
        return ExecuteResponse(output="ok", exit_code=0)

    monkeypatch.setattr(backend, "aexecute", fake_aexecute)
    tool = sut.create_shell_execute_tool(backend)
    asyncio.run(tool.coroutine(command="big", timeout=200, tool_call_id="x"))
    assert captured["timeout"] == 200
```
（`tool.coroutine` 即 `_arun`；按 StructuredTool 实际暴露方式调——若 `tool.coroutine` 不可直接 await，改为 `tool.ainvoke({"command":..., "tool_call_id":"x"})`，实现时确认哪种可行。）

- [ ] **Step 2: 运行,确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "default_when_timeout or model_timeout" -v`
Expected: `test_arun_uses_60s_default...` FAIL（当前传的是 None 不是 60）。

- [ ] **Step 3: 实现默认 60s**

在 `shell_execute_tool.py` 顶部加常量 `DEFAULT_FOREGROUND_TIMEOUT = 60`。改 `_arun`（:75-88）：timeout 为 None 时用默认：
```python
    async def _arun(
        command: str,
        intent: str | None = None,
        timeout: int | None = None,
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        del intent
        effective_timeout = timeout if timeout is not None else DEFAULT_FOREGROUND_TIMEOUT
        response = await shell.aexecute(
            command,
            timeout=effective_timeout,
            tool_call_id=tool_call_id or None,
            allow_background=True,
        )
        return format_execute_response(response, shell)
```
（`_run` 同步路径不变——它不转后台，timeout 忽略。）

- [ ] **Step 4: 改 timeout 字段描述（短命令零负担）**

`ShellExecuteInput.timeout` 的 `description` 改为：
```python
        description=(
            "前台等待上限（秒）。**一般命令不用传**——默认 60s，几秒内完成的会直接同步返回。"
            "仅当你预判是长任务（扫盘/递归算大目录/编译/下载/装依赖）时才传较大值（如 120-300s）"
            "让它前台多等；否则超时会自动转后台、返回 session_id，再用 shell_wait 等结果。"
        ),
```

- [ ] **Step 5: 运行,确认转绿**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -v`
Expected: PASS（默认 60、传值用传值、既有用例不回归）。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/tests/test_shell_execute_tool.py
git commit -m "fix(server): shell_execute不传timeout默认60s前台(到点转后台)+timeout描述强调短命令零负担"
```

---

## Task 4: prompt 引导（短命令零负担、长任务才 wait）

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py`（`ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE`）
- Modify: `apps/server/src/service/agent/prompts.py`（`build_system_prompt` 用的模板）

- [ ] **Step 1: 定位两处 prompt 模板的 shell 相关段**

读 `orchestrator/prompts.py` 的 `ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE`（:15+，行 30-31「自己动手 1-2 步 shell」附近）；读 `agent/prompts.py` 的 `build_system_prompt` 函数与它拼的 system prompt 模板，找讲工具/执行的合适插入点。

- [ ] **Step 2: 两处各加 shell 用法指引**

在两处模板里加这段（适配各自格式/缩进/是否 f-string）：
```
执行 shell 命令：一般命令（查目录/取数/echo/git 等几秒内完成的）直接 shell_execute、不传 timeout、同步拿结果，别为它们设 timeout 或想 shell_wait。仅当预判是长任务（扫盘/递归算大目录/编译/下载/装依赖）时才给较大 timeout（120-300s）让它前台多等，或接受它超时（默认60s）自动转后台返回 session_id、再用 shell_wait(session_id, N) 阻塞等结果（N 按预估剩余、最多300s）。绝不要对刚转后台的命令立刻反复 shell_poll 刷屏；不必等就先做别的、需要时再查。
```

- [ ] **Step 3: prompt 测试 + import 冒烟**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_prompts.py tests/test_prompt_invariants.py tests/test_group_tools.py -v`
Expected: PASS（若某测试断言 prompt 文案且因新增段变红，更新其断言含新文案——预期变更；若别的原因红，停下报告）。
Run: `cd apps/server && uv run python -c "import src.service.agent.orchestrator.prompts, src.service.agent.prompts; print('ok')"`
Expected: ok。

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/src/service/agent/prompts.py
git commit -m "docs(prompt): 教模型shell短命令零负担、只预判长任务才设timeout/转后台用shell_wait等"
```

---

## Self-Review

**Spec coverage:**
- 块1（shell_wait 工具：注册表 wait 方法 + create_shell_wait_tool + 两处注册）→ Task 1（注册表 wait）+ Task 2（工具+注册）。✓ 硬顶 _WAIT_HARD_CAP=300 在 Task 1。✓
- 块2（工具层不传 timeout 默认 60s，不动 backend _default_timeout 1200s）→ Task 3。✓ 测试验证「不传=60、传值=传值」。✓
- 块3（prompt 教短命令零负担、长任务才 wait）→ Task 4。✓ 用修正后的「短命令零负担」措辞。✓
- 块4（工具描述强化）→ Task 3 Step 4（timeout 描述）+ Task 2 Step 3（shell_wait 描述）。✓
- wait/poll offset 一致 → Task 1 实现复用 _read_incremental + 更新 read_offset。✓
- 不在本期范围（转后台/注册表/poll/kill 不重做、慢不平滑不碰）→ 计划未涉及。✓

**Placeholder scan:** Task 3 Step 1 测试「tool.coroutine vs ainvoke 哪种可行实现时确认」是对 StructuredTool 调用方式的合理适配指示（给了两种）；Task 4「适配各自格式/找插入点」是 prompt 模板适配（已让 Step 1 先定位）。无 TBD/空洞。

**Type consistency:** `wait(session_id, max_seconds)→dict{found,finished,exit_code,new_output,offset,waited_seconds}` 在 Task 1 定义、Task 2 工具调用一致；`create_shell_wait_tool()` 无参，Task 2 定义 Task 2 注册一致；`DEFAULT_FOREGROUND_TIMEOUT=60` 在 Task 3 定义并用；`_WAIT_HARD_CAP=300` Task 1 定义；`aexecute(..., timeout=effective_timeout, allow_background=True)` 与既有签名一致。
