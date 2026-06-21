# 子项目 A：shell 有节奏等 + 超大才升级通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 执行 shell 命令时，命令转后台后用 `shell_wait` 有节奏地自己等几轮，等到直接给结果；只有真·超大任务才告知用户「稍后问我进度」体面收尾，绝不杀了重试。

**Architecture:** 在上一轮已落地的后台基础设施（注册表 + 转后台 + poll/kill）之上加 `shell_wait`（阻塞等命令结束或最多 N 秒，硬顶 300s），把工具层不传 timeout 时的前台默认从 1200s 降到 60s，并在总管/员工两套 prompt + 工具描述里教「有节奏等、超大才升级、不试错重试」。纯后端，不动转后台/注册表/poll/kill 既有逻辑。

**Tech Stack:** Python 3.12 / FastAPI / langchain StructuredTool / pytest（`cd apps/server && uv run pytest`）。

---

## 背景速读（实现者零上下文也能懂）

- 上一轮已有：`apps/server/src/service/shell_background_registry.py`（全局单例注册表，`register`/`poll`/`kill`/`sweep`），`shell_execute` 工具的 `timeout` 参数 + 超时转后台 + `shell_poll`/`shell_kill` 工具，进程组防孤儿。
- 现状缺口：① 没有「阻塞等 N 秒」的工具（只有 poll 查一次立即返回）；② 工具层不传 timeout → 落到 backend `_default_timeout`(1200s)，体感「没超时」；③ prompt 没教这套节奏。
- 注册表 `poll` 返回 `{found, running, exit_code, new_output, offset}`，内部用 `self._read_incremental(tmp_path, last_size) -> (new_offset, text)` 读增量、`s.read_offset` 推进 offset。`_Session` 有 `popen`/`tmp_path`/`read_offset`/`status`。
- `wait` 必须复用 `_read_incremental` + 推进 `s.read_offset`（与 poll 共用 offset，避免重读/漏读）。
- **测试坑（务必遵守）**：Win 上对活子进程 `taskkill /F /T` 会把 pytest 自身带走 → 测「未完成」分支用 `time.sleep(30)` 的进程并在断言后 `reg.kill(sid)` 收尾；测「完成」分支让进程自己秒退。已有测试文件 `tests/test_shell_background_registry.py` 里 `_spawn_to_tmpfile` 是现成的 spawn 辅助，复用它。

## File Structure

- **Modify** `apps/server/src/service/shell_background_registry.py`：加 `_WAIT_HARD_CAP` 常量 + `wait(session_id, max_seconds)` 方法。
- **Modify** `apps/server/src/service/agent/shell_execute_tool.py`：加 `DEFAULT_FOREGROUND_TIMEOUT=60` + `_arun` 不传 timeout 时用它；加 `create_shell_wait_tool()`；强化 `timeout`/`shell_poll` 描述。
- **Modify** `apps/server/src/service/agent/employee.py:230-232`：注册 `create_shell_wait_tool()`。
- **Modify** `apps/server/src/service/agent/orchestrator/agent.py:290-291`：注册 `create_shell_wait_tool()`。
- **Modify** `apps/server/src/service/agent/orchestrator/prompts.py`：在「委派与亲自干」段后插入 shell 节奏指引。
- **Modify** `apps/server/src/service/agent/prompts.py`：在 `shell_execute` intent 规则段（~62-65 行）后插入员工 shell 节奏指引。
- **Test** `apps/server/tests/test_shell_background_registry.py`：加 `wait` 的测试。
- **Test** `apps/server/tests/test_shell_execute_tool.py`：加 `shell_wait` 工具 + 默认 60s 的测试。

---

## Task 1：注册表加 `wait(session_id, max_seconds)`

**Files:**
- Modify: `apps/server/src/service/shell_background_registry.py`
- Test: `apps/server/tests/test_shell_background_registry.py`

- [ ] **Step 1: 写失败测试（完成分支 + 未完成分支 + 未知 session）**

在 `apps/server/tests/test_shell_background_registry.py` 末尾追加：

```python
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -k wait -v`
Expected: FAIL，`AttributeError: 'BackgroundShellRegistry' object has no attribute 'wait'`

- [ ] **Step 3: 实现 `wait` 方法 + 硬顶常量**

在 `apps/server/src/service/shell_background_registry.py` 顶部常量区（`_MAX_AGE_SECONDS = 3600` 下一行）加：

```python
_WAIT_HARD_CAP = 300
_WAIT_POLL_INTERVAL = 0.5
```

在 `poll` 方法之后、`_terminate` 之前插入 `wait` 方法：

```python
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -k wait -v`
Expected: PASS（3 个）

- [ ] **Step 5: 跑全量注册表测试确认无回归**

Run: `cd apps/server && uv run pytest tests/test_shell_background_registry.py -v`
Expected: 全部 PASS（含原有 poll/kill/grandchild）

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/shell_background_registry.py apps/server/tests/test_shell_background_registry.py
git commit -m "feat(shell): 注册表加 wait(阻塞等命令结束或最多N秒,硬顶300s)+测试"
```

---

## Task 2：`create_shell_wait_tool()` 工具

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试（完成→给输出+exit_code；未知→未找到）**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_shell_wait_tool_returns_finished_output():
    import subprocess, sys, tempfile
    from src.service.agent.shell_execute_tool import create_shell_wait_tool
    from src.service.shell_background_registry import get_background_shell_registry

    reg = get_background_shell_registry()
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout")
    tmp.close()
    handle = open(tmp.name, "ab")
    popen = subprocess.Popen(
        [sys.executable, "-u", "-c", "print('done-marker', flush=True)"],
        stdout=handle, stderr=subprocess.STDOUT,
    )
    handle.close()
    sid = reg.register(popen=popen, tmp_path=tmp.name, read_offset=0, command="t")

    tool = create_shell_wait_tool()
    out = tool.invoke({"session_id": sid, "max_seconds": 5})
    assert isinstance(out, str)
    assert "done-marker" in out
    assert "exit_code=0" in out


def test_shell_wait_tool_unknown_session():
    from src.service.agent.shell_execute_tool import create_shell_wait_tool

    tool = create_shell_wait_tool()
    out = tool.invoke({"session_id": "nope", "max_seconds": 1})
    assert isinstance(out, str)
    assert "未找到" in out
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k shell_wait -v`
Expected: FAIL，`ImportError: cannot import name 'create_shell_wait_tool'`

- [ ] **Step 3: 实现 `create_shell_wait_tool`**

在 `apps/server/src/service/agent/shell_execute_tool.py` 的 `create_shell_kill_tool` 函数之后追加：

```python
def create_shell_wait_tool() -> BaseTool:
    from src.service.shell_background_registry import get_background_shell_registry

    class _WaitInput(BaseModel):
        session_id: str = Field(description="shell_execute 转后台时返回的 session_id")
        max_seconds: int = Field(
            default=60,
            description="本轮最多阻塞等待的秒数（命令提前结束则立即返回；上限300）",
        )

    def _wait(session_id: str, max_seconds: int = 60) -> str:
        r = get_background_shell_registry().wait(session_id, max_seconds)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}（可能已结束并被回收）。"
        body = r["new_output"] or "(无新增输出)"
        if r["finished"]:
            return (
                f"[已结束(exit_code={r['exit_code']})] 等待 {r['waited_seconds']}s。"
                f"新增输出:\n{body}\n[offset={r['offset']}]"
            )
        return (
            f"[仍在运行] 已等待 {r['waited_seconds']}s 未完成。新增输出:\n{body}\n"
            f"[offset={r['offset']}] 可再 shell_wait 等一轮，或判断是超大任务后告知用户稍后问进度。"
        )

    return StructuredTool.from_function(
        func=_wait,
        name="shell_wait",
        args_schema=_WaitInput,
        description=(
            "阻塞等待 shell_execute 转后台的命令结束、或最多 max_seconds 秒（上限300）。"
            "转后台后**有节奏地等结果优先用它**（每轮如 30-60s），命令完成即返回最终输出与退出码；"
            "未完成可再调一轮。不要用空轮询 shell_poll 来等。"
        ),
    )
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k shell_wait -v`
Expected: PASS（2 个）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): create_shell_wait_tool 阻塞等后台命令结束或N秒+测试"
```

---

## Task 3：工具层不传 timeout 默认前台 60s

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试（用 spy 验证传给 aexecute 的 timeout）**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_arun_uses_default_foreground_timeout_when_none():
    import asyncio
    from src.service.agent.shell_execute_tool import (
        create_shell_execute_tool, DEFAULT_FOREGROUND_TIMEOUT,
    )
    from deepagents.backends.protocol import ExecuteResponse

    captured = {}

    class _FakeShell:
        async def aexecute(self, command, *, timeout=None, tool_call_id=None,
                           allow_background=False):
            captured["timeout"] = timeout
            return ExecuteResponse(output="ok", exit_code=0)

        def format_shell_output(self, response):
            return response.output

    tool = create_shell_execute_tool(_FakeShell())
    # 不传 timeout → 应被替换为 DEFAULT_FOREGROUND_TIMEOUT
    asyncio.run(tool.ainvoke({"command": "echo hi"}))
    assert captured["timeout"] == DEFAULT_FOREGROUND_TIMEOUT
    # 传了 timeout → 用传入值
    asyncio.run(tool.ainvoke({"command": "echo hi", "timeout": 5}))
    assert captured["timeout"] == 5
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k default_foreground -v`
Expected: FAIL，`ImportError: cannot import name 'DEFAULT_FOREGROUND_TIMEOUT'`

- [ ] **Step 3: 加常量 + `_arun` 兜底**

在 `apps/server/src/service/agent/shell_execute_tool.py` 顶部 `INTENT_MAX_LENGTH = 20` 下一行加：

```python
DEFAULT_FOREGROUND_TIMEOUT = 60
```

把 `_arun` 里的 `aexecute` 调用改为不传 timeout 时用默认值（`shell_execute_tool.py:81-87`）：

```python
        response = await shell.aexecute(
            command,
            timeout=timeout if timeout is not None else DEFAULT_FOREGROUND_TIMEOUT,
            tool_call_id=tool_call_id or None,
            allow_background=True,
        )
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k default_foreground -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): 工具层不传timeout默认前台60s(不再落到1200s)+测试"
```

---

## Task 4：员工 + 总管两处注册 `shell_wait`

**Files:**
- Modify: `apps/server/src/service/agent/employee.py:24-26, 231-232`
- Modify: `apps/server/src/service/agent/orchestrator/agent.py:75-77, 290-291`
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试（两个注册模块 import + 工具名含 shell_wait 冒烟）**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_shell_wait_tool_factory_named_correctly():
    from src.service.agent.shell_execute_tool import create_shell_wait_tool
    assert create_shell_wait_tool().name == "shell_wait"


def test_employee_and_orchestrator_modules_import_shell_wait():
    # 注册点导入了 create_shell_wait_tool（冒烟，确保两处都改了）
    import src.service.agent.employee as emp
    import src.service.agent.orchestrator.agent as orch
    assert hasattr(emp, "create_shell_wait_tool")
    assert hasattr(orch, "create_shell_wait_tool")
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "shell_wait_tool_factory or modules_import_shell_wait" -v`
Expected: 第二个 FAIL（`emp`/`orch` 无 `create_shell_wait_tool` 属性，因未 import）

- [ ] **Step 3: 两处 import + 注册**

`apps/server/src/service/agent/employee.py` 的 import 段（24-26 行）加一行：

```python
    create_shell_execute_tool,
    create_shell_poll_tool,
    create_shell_kill_tool,
    create_shell_wait_tool,
```

`employee.py:231-232` 注册段加一行：

```python
    extra_tools.append(create_shell_poll_tool())
    extra_tools.append(create_shell_kill_tool())
    extra_tools.append(create_shell_wait_tool())
```

`apps/server/src/service/agent/orchestrator/agent.py` 的 import 段（75-77 行）加一行：

```python
    create_shell_execute_tool,
    create_shell_poll_tool,
    create_shell_kill_tool,
    create_shell_wait_tool,
```

`orchestrator/agent.py:290-291` 注册段加一行：

```python
    orchestrator_tools.append(create_shell_poll_tool())
    orchestrator_tools.append(create_shell_kill_tool())
    orchestrator_tools.append(create_shell_wait_tool())
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "shell_wait_tool_factory or modules_import_shell_wait" -v`
Expected: PASS（2 个）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/employee.py apps/server/src/service/agent/orchestrator/agent.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): 员工+总管两处注册 shell_wait 工具+冒烟测试"
```

---

## Task 5：强化 `timeout` / `shell_poll` 工具描述

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py:49-56`（timeout 描述）, `:134-137`（poll 描述）
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试（描述含引导关键词）**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_timeout_description_steers_to_default_and_background():
    from src.service.agent.shell_execute_tool import ShellExecuteInput
    desc = ShellExecuteInput.model_fields["timeout"].description
    assert "默认 60" in desc
    assert "shell_wait" in desc


def test_poll_description_points_to_wait_for_waiting():
    from src.service.agent.shell_execute_tool import create_shell_poll_tool
    desc = create_shell_poll_tool().description
    assert "shell_wait" in desc
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "timeout_description or poll_description" -v`
Expected: FAIL（断言关键词不在描述中）

- [ ] **Step 3: 改两处描述**

`shell_execute_tool.py:49-56` 的 `timeout` Field 描述改为：

```python
    timeout: int | None = Field(
        default=None,
        description=(
            "可选：前台等待上限（秒）。一般命令不用传（默认 60，几秒内完成的会同步返回）；"
            "仅预判长任务（扫盘/编译/下载/拉镜像）时才传较大值（如 120-300）让它前台多等。"
            "超时仍未完成则自动转后台、返回 session_id（输出不丢失），"
            "随后用 shell_wait(session_id) 有节奏地等结果、shell_kill(session_id) 终止。"
        ),
    )
```

`shell_execute_tool.py:134-137` 的 `create_shell_poll_tool` 描述改为：

```python
        description=(
            "快速查询一次 shell_execute 转后台运行的命令：返回新增 stdout、是否仍在运行、退出码。"
            "只查一眼用它；要**等结果**请用 shell_wait（阻塞等一轮），勿用 poll 空轮询。"
        ),
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "timeout_description or poll_description" -v`
Expected: PASS（2 个）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): timeout/shell_poll 描述引导默认60s+用shell_wait等结果+测试"
```

---

## Task 6：总管 prompt 教「有节奏等、超大才升级、不试错重试」

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py`（「委派与亲自干」段后，约 35 行空行处）
- Test: `apps/server/tests/test_shell_environment_prompt.py`

- [ ] **Step 1: 写失败测试（prompt 含节奏指引关键词）**

在 `apps/server/tests/test_shell_environment_prompt.py` 末尾追加：

```python
def test_orchestrator_prompt_has_rhythmic_wait_guidance():
    from src.service.agent.orchestrator.prompts import (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    )
    p = ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE
    assert "shell_wait" in p
    assert "有节奏" in p
    assert "稍后问我进度" in p
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k rhythmic_wait -v`
Expected: FAIL（关键词不在 prompt 中）

- [ ] **Step 3: 插入 shell 节奏指引段**

在 `apps/server/src/service/agent/orchestrator/prompts.py` 的「委派与亲自干」段末尾（`34` 行那条 `- 范例：...` 之后、`## 需求处理决策链` 之前的空行处）插入：

```
- **执行 shell 命令**：一般命令（查目录/取数/echo/git 等几秒内完成）直接 `shell_execute`、不传 timeout、同步拿结果，别为它们设 timeout 或想 wait。命令较慢会在默认 60s 后自动转后台、返回 session_id（输出不丢失）。此时**有节奏地等**，别狂查也别撒手：用 `shell_wait(session_id, N)`（N 自定，如 30-60s）等一轮，没完成就再 `shell_wait` 等一轮——绝大多数任务等一两轮就完成、直接拿结果。只有当你等了几轮、判断是**真·超大任务**（远未完、预估还要很久，如拉大镜像/全盘扫描/大型编译）时，才告诉用户「这个任务较耗时、已在后台运行，你可以稍后问我进度」并体面收尾本轮（后台仍在跑）——**不要**因为「还没完成」就 `shell_kill` 杀掉重试、或换个命令重来。命令没报错就是在正常跑，耐心等。
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k rhythmic_wait -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/prompts.py apps/server/tests/test_shell_environment_prompt.py
git commit -m "feat(shell): 总管prompt教有节奏shell_wait等+超大才升级通知+不试错重试"
```

---

## Task 7：员工 prompt 教同一套节奏

**Files:**
- Modify: `apps/server/src/service/agent/prompts.py`（`shell_execute` intent 规则段 ~65 行后）
- Test: `apps/server/tests/test_shell_environment_prompt.py`

- [ ] **Step 1: 写失败测试（员工 prompt 含节奏指引）**

先确认 `build_system_prompt` 的调用签名，再写测试。在 `apps/server/tests/test_shell_environment_prompt.py` 末尾追加：

```python
def test_employee_prompt_has_rhythmic_wait_guidance():
    # build_system_prompt 拼装后的员工系统提示应含 shell 节奏指引。
    # 用 grep 源串而非渲染，避免依赖参数：节奏指引是常量文本片段。
    import inspect
    import src.service.agent.prompts as prompts_mod
    src = inspect.getsource(prompts_mod)
    assert "shell_wait" in src
    assert "有节奏" in src
    assert "稍后问我进度" in src
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k employee_prompt_has_rhythmic -v`
Expected: FAIL（关键词不在源中）

- [ ] **Step 3: 插入员工 shell 节奏指引**

在 `apps/server/src/service/agent/prompts.py` 的 `shell_execute` 规则段、`65` 行那条「若 shell_execute 返回 exit code=0 但输出为空...」之后插入（保持相同缩进 8 空格 + `- `）：

```
        - **慢命令有节奏地等、别试错重试**：命令较慢会在默认 60s 后自动转后台、返回 session_id（输出不丢失）。此时用 `shell_wait(session_id, N)`（N 自定，如 30-60s）等一轮，没完成再 `shell_wait` 等一轮——绝大多数任务等一两轮就完成、直接拿结果。只有等了几轮判断是**真·超大任务**（拉大镜像/全盘扫描/大型编译，远未完）时，才告诉用户「这个任务较耗时、已在后台运行，你可以稍后问我进度」并体面收尾（后台仍在跑）。**不要**因为「还没完成」就 `shell_kill` 杀掉重试或换命令重来；没报错就是在正常跑。
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k employee_prompt_has_rhythmic -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/prompts.py apps/server/tests/test_shell_environment_prompt.py
git commit -m "feat(shell): 员工prompt教同一套有节奏等+超大才升级+不试错重试"
```

---

## Task 8：全量回归 + 收尾

**Files:** 无新增，仅验证。

- [ ] **Step 1: 跑全部 shell 相关测试**

Run: `cd apps/server && uv run pytest tests/ -k shell -v`
Expected: 全部 PASS（含原有 + 本计划新增）

- [ ] **Step 2: 两个注册模块 import 冒烟（确保 prompt 文本插入没破坏模块）**

Run: `cd apps/server && uv run python -c "import src.service.agent.employee; import src.service.agent.orchestrator.agent; import src.service.agent.prompts; import src.service.agent.orchestrator.prompts; print('ok')"`
Expected: 输出 `ok`，无异常

- [ ] **Step 3: 手动验证（人工，记录结论）**

重启后端（`pnpm dev:server`），让总管或员工跑一个慢命令（如全盘扫描），观察：
- 命令 60s 内未完 → 转后台返回 session_id；
- 模型用 `shell_wait` 有节奏地等、**不**刷屏 poll、**不** kill 重试；
- 真·超大任务才说「稍后问我进度」体面收尾；
- 快命令秒回、不转后台。

记录观察结论（是否仍试错），若模型仍乱试错则在后续轮考虑加硬闸（参考 list_tasks 死循环经验，本计划不加）。

---

## 完成定义

- `shell_wait` 工具存在、员工+总管均注册、阻塞等命令结束或最多 300s。
- 不传 timeout 默认前台 60s（不再 1200s）。
- 两套 prompt + 工具描述都教「有节奏等、超大才升级『稍后问我进度』、不试错重试」。
- 话术诚实：不承诺自动通知（C 完成唤醒未做；C 做完须回来把「稍后问我进度」改成「完成自动通知」）。
- 全部 shell 测试 PASS。
```
