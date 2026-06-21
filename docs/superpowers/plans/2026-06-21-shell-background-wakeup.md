# 子项目 C：后台命令跑完自动唤醒模型续跑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后台命令真跑完后，后端经 apscheduler 周期扫描发现「模型登记过 watch 的 session 已结束」，自动把模型拉回原会话续跑一轮（注入命令结果），把 A 的「稍后问我进度」升级成「完成后自动继续」。

**Architecture:** 模型 shell_wait 判定超大任务时调 `watch_background(session_id)` 登记（watch 表自存 conversation_id + target_type，从 tool runtime 注入取，不碰 shell 注册表）。apscheduler 周期 job（20s）调 `scan_and_wake()`：poll 每个 watch 的进程，finished + 会话空闲 → 经 `call_soon_threadsafe` 在主循环线程构造 agent（总管/员工按 target_type 二分）+ `registry.start` 续跑 + watch 单次性 mark_fired。三道防竞态闸：单次性、会话忙跳过、主线程搬运。

**Tech Stack:** Python 3.12 / apscheduler IntervalTrigger / langchain ToolRuntime 注入 / asyncio call_soon_threadsafe / pytest（`cd apps/server && uv run pytest`）。

---

## 背景速读（实现者零上下文也能懂）

调研已定的精确接口（照抄，别猜）：

- **取 conversation_id**：用 `from src.service.agent.orchestrator.runtime import conversation_id_from_runtime`，传入 langchain 工具的 `runtime: ToolRuntime[None, None]` 参数。`thread_id == conversation_id` 是全局不变式。**不要用 ContextVar `get_conversation_id()`**（员工侧为 None）。现有范式见 `src/service/agent/orchestrator/tools/skills.py:529-549`（`@tool` + `runtime: ToolRuntime[None, None] = None` + `resolve_conv_id(runtime)`）。
- **判会话忙**：`stream_registry` 单例有 `is_busy(conversation_id) -> bool`（`stream_registry.py:832`，含 active+queued）。拿单例：`from src.service.stream_registry import registry as stream_registry`（确认导出名，实现时 grep `^registry = ` 或 `registry = StreamRegistry()`）。
- **registry.start 签名**（`stream_registry.py:1459`）：`start(conversation_id, agent, messages, config, stream_msg_id, skill_name, debug_content_only, *, orchestrator_owned_db=None, orchestrator_workspace_id=None, orchestrator_conversation_id=None, orchestrator_auth_token=None, priority=None, source=None, stream_class=None)`。
- **主循环**：`from src.service.agent.orchestrator.runtime import get_main_loop`（`runtime.py:129`）；`get_main_loop().call_soon_threadsafe(fn)`。
- **DB session**：`from src.db... import get_session_local`；`db = get_session_local()()`（范式 `workspace_api.py:112`）。
- **续跑模板（总管）** 照抄 `task_scheduler_service.py:578-734` 的 `_start_curator_task`：建 user 消息（`ConversationMessage(conversation_id=, role="user", content=, stream_state="completed")`）、assistant 空壳（`role="assistant", content="", stream_state="streaming"|"queued"`）、`db.flush()` 拿 `assistant_msg.id`、`db.commit()`、`call_soon_threadsafe(_start_on_main)`，`_start_on_main` 内 `orch_db=get_session_local()()` + `get_orchestrator_agent(ws, orch_db, conv_id, employee_id=, bind_context=False)` + `registry.start(..., orchestrator_owned_db=orch_db, orchestrator_workspace_id=ws, orchestrator_conversation_id=conv_id)`，异常 `reset_context(conv_id)+orch_db.close()`。slot_busy 判 streaming/queued 见 `:590-595`。
- **续跑模板（员工）** 参照 `execution.py:377-493`：`get_agent(skills_path, root_path, employee_id=, conversation_id=, enable_hitl=False, ...)` + `registry.start(..., orchestrator_conversation_id=None)`（不传 owned_db）。
- **apscheduler job**：`_register_system_jobs`（`task_scheduler_service.py:165`）末尾加 `scheduler.add_job(cls.run_scan_and_wake_job, trigger=IntervalTrigger(seconds=20, timezone=CST), id="system:scan_and_wake", replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=15)`。顶部加 `from apscheduler.triggers.interval import IntervalTrigger`。`CST` 已 import（`from src.models.workspace import CST`）。classmethod 包装仿 `run_dispatch_order_sync_job`（`:200`）。
- **测试坑**：扫描器/续跑测试 **mock 掉真 registry.start、主循环、agent 构造**——绝不在 pytest 里真起 agent 或真投主循环。watch 表/工具是纯内存逻辑，可真测。

## File Structure

- **Create** `apps/server/src/service/background_watch_registry.py`：watch 登记表（单例 + 锁）。
- **Create** `apps/server/src/service/background_wakeup_scanner.py`：`scan_and_wake()` 扫描逻辑 + `_wake_conversation()` 续跑触发器。
- **Modify** `apps/server/src/service/agent/shell_execute_tool.py`：加 `create_watch_background_tool()`。
- **Modify** `apps/server/src/service/agent/employee.py` + `orchestrator/agent.py`：注册 watch_background。
- **Modify** `apps/server/src/service/task_scheduler_service.py`：加 `run_scan_and_wake_job` + 注册 IntervalTrigger job。
- **Modify** `apps/server/src/service/agent/shell_execute_tool.py`（shell_wait 返回）+ `skill_shell_backend.py`（at-handoff）+ `orchestrator/prompts.py` + `prompts.py`：A 话术升级。
- **Test**：新建 `test_background_watch_registry.py`、`test_background_wakeup_scanner.py`；扩 `test_shell_execute_tool.py`、`test_shell_environment_prompt.py`。

---

## Task 1：watch 登记表 `background_watch_registry.py`

**Files:**
- Create: `apps/server/src/service/background_watch_registry.py`
- Test: `apps/server/tests/test_background_watch_registry.py`

- [ ] **Step 1: 写失败测试**

新建 `apps/server/tests/test_background_watch_registry.py`：

```python
from __future__ import annotations


def _fresh_registry():
    # 每个测试用独立实例，避免全局单例串味
    from src.service.background_watch_registry import BackgroundWatchRegistry
    return BackgroundWatchRegistry()


def test_register_and_list_watching():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    watching = reg.list_watching()
    assert len(watching) == 1
    assert watching[0].session_id == "s1"
    assert watching[0].conversation_id == 10
    assert watching[0].target_type == "curator"
    assert watching[0].status == "watching"


def test_register_same_session_overwrites():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    reg.register_watch(session_id="s1", conversation_id=11, target_type="employee")
    watching = reg.list_watching()
    assert len(watching) == 1
    assert watching[0].conversation_id == 11
    assert watching[0].target_type == "employee"


def test_mark_fired_removes_from_watching():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    reg.mark_fired("s1")
    assert reg.list_watching() == []


def test_drop_removes_entry():
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    reg.drop("s1")
    assert reg.list_watching() == []


def test_sweep_stale_removes_old_entries(monkeypatch):
    import src.service.background_watch_registry as mod
    reg = _fresh_registry()
    reg.register_watch(session_id="s1", conversation_id=10, target_type="curator")
    # 把这条的 created_at 改成很久以前
    w = reg.list_watching()[0]
    w.created_at = 0.0  # monotonic 远古
    removed = reg.sweep_stale(max_age_seconds=1)
    assert removed == 1
    assert reg.list_watching() == []


def test_singleton_accessor_returns_same_instance():
    from src.service.background_watch_registry import get_background_watch_registry
    a = get_background_watch_registry()
    b = get_background_watch_registry()
    assert a is b
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_background_watch_registry.py -v`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现 `background_watch_registry.py`**

```python
"""后台命令完成唤醒的 watch 登记表：模型调 watch_background 登记「某 session 跑完唤醒本会话」，
apscheduler 扫描器读它。自存 conversation_id + target_type，不依赖 shell 注册表的会话归属。进程级单例。"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

_STALE_MAX_AGE_SECONDS = 86400  # 24h 废条目兜底清理


@dataclass
class _Watch:
    session_id: str
    conversation_id: int
    target_type: str  # "curator" | "employee"
    created_at: float = field(default_factory=time.monotonic)
    status: str = "watching"  # watching | fired


class BackgroundWatchRegistry:
    def __init__(self) -> None:
        self._watches: dict[str, _Watch] = {}
        self._lock = threading.Lock()

    def register_watch(self, *, session_id: str, conversation_id: int,
                       target_type: str) -> None:
        with self._lock:
            self._watches[session_id] = _Watch(
                session_id=session_id,
                conversation_id=conversation_id,
                target_type=target_type,
            )

    def list_watching(self) -> list[_Watch]:
        with self._lock:
            return [w for w in self._watches.values() if w.status == "watching"]

    def mark_fired(self, session_id: str) -> None:
        with self._lock:
            self._watches.pop(session_id, None)

    def drop(self, session_id: str) -> None:
        with self._lock:
            self._watches.pop(session_id, None)

    def sweep_stale(self, max_age_seconds: int = _STALE_MAX_AGE_SECONDS) -> int:
        now = time.monotonic()
        with self._lock:
            stale = [sid for sid, w in self._watches.items()
                     if now - w.created_at > max_age_seconds]
            for sid in stale:
                self._watches.pop(sid, None)
        return len(stale)


_GLOBAL_WATCH_REGISTRY: BackgroundWatchRegistry | None = None
_GLOBAL_LOCK = threading.Lock()


def get_background_watch_registry() -> BackgroundWatchRegistry:
    global _GLOBAL_WATCH_REGISTRY
    if _GLOBAL_WATCH_REGISTRY is None:
        with _GLOBAL_LOCK:
            if _GLOBAL_WATCH_REGISTRY is None:
                _GLOBAL_WATCH_REGISTRY = BackgroundWatchRegistry()
    return _GLOBAL_WATCH_REGISTRY
```

注意：`mark_fired` 直接删（spec 的「fired 即移除」），不保留 fired 态 —— 保证 `list_watching` 永不再见它，单次性。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_background_watch_registry.py -v`
Expected: 6 passed

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/background_watch_registry.py apps/server/tests/test_background_watch_registry.py
git commit -m "feat(shell): watch登记表(自存conv_id+target_type,单次性+24h清理)+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2：watch_background 工具

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_watch_background_registers_when_running(monkeypatch):
    import sys, subprocess, tempfile
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    from src.service.shell_background_registry import get_background_shell_registry
    from src.service.background_watch_registry import get_background_watch_registry

    # 起一个仍在跑的后台进程并注册
    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    handle = open(tmp.name, "ab")
    popen = subprocess.Popen([sys.executable, "-u", "-c", "import time; time.sleep(30)"],
                             stdout=handle, stderr=subprocess.STDOUT)
    handle.close()
    reg = get_background_shell_registry()
    sid = reg.register(popen=popen, tmp_path=tmp.name, read_offset=0, command="svc")

    # mock 掉从 runtime 取 conversation_id / target_type
    import src.service.agent.shell_execute_tool as mod
    monkeypatch.setattr(mod, "_resolve_watch_context",
                        lambda runtime: (123, "curator"))

    tool = create_watch_background_tool()
    out = tool.invoke({"session_id": sid})
    assert isinstance(out, str)
    assert "已登记" in out or "自动" in out
    wreg = get_background_watch_registry()
    assert any(w.session_id == sid and w.conversation_id == 123
               for w in wreg.list_watching())
    reg.kill(sid)
    wreg.drop(sid)


def test_watch_background_rejects_finished_session():
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    tool = create_watch_background_tool()
    out = tool.invoke({"session_id": "nonexistent-id"})
    assert isinstance(out, str)
    assert "已结束" in out or "未找到" in out or "无需" in out


def test_watch_background_no_context_does_not_crash(monkeypatch):
    import sys, subprocess, tempfile
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    from src.service.shell_background_registry import get_background_shell_registry

    tmp = tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".stdout"); tmp.close()
    handle = open(tmp.name, "ab")
    popen = subprocess.Popen([sys.executable, "-u", "-c", "import time; time.sleep(30)"],
                             stdout=handle, stderr=subprocess.STDOUT)
    handle.close()
    reg = get_background_shell_registry()
    sid = reg.register(popen=popen, tmp_path=tmp.name, read_offset=0, command="svc")

    import src.service.agent.shell_execute_tool as mod
    monkeypatch.setattr(mod, "_resolve_watch_context", lambda runtime: (None, None))

    tool = create_watch_background_tool()
    out = tool.invoke({"session_id": sid})
    assert isinstance(out, str)
    assert "无法登记" in out or "缺会话" in out
    reg.kill(sid)
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k watch_background -v`
Expected: FAIL（`ImportError: cannot import name 'create_watch_background_tool'`）

- [ ] **Step 3: 实现 — 追加到 `shell_execute_tool.py` 末尾**

```python
def _resolve_watch_context(runtime) -> tuple[int | None, str | None]:
    """从 tool runtime 取 (conversation_id, target_type)。runtime 不可用时返回 (None, None)。"""
    from src.service.agent.orchestrator.runtime import conversation_id_from_runtime
    conv_id = conversation_id_from_runtime(runtime)
    if conv_id is None:
        return None, None
    target_type = None
    try:
        from src.db import get_session_local  # 实现时按真实路径调整
        db = get_session_local()()
        try:
            from src.models.conversation import Conversation
            conv = db.get(Conversation, conv_id)
            target_type = conv.target_type if conv is not None else None
        finally:
            db.close()
    except Exception:
        target_type = None
    return conv_id, target_type


def create_watch_background_tool() -> BaseTool:
    from langchain.tools import ToolRuntime

    from src.service.shell_background_registry import get_background_shell_registry
    from src.service.background_watch_registry import get_background_watch_registry

    def _watch_background(session_id: str, runtime: ToolRuntime = None) -> str:
        r = get_background_shell_registry().poll(session_id)
        if not r.get("found"):
            return f"未找到后台命令 session_id={session_id}（可能已结束并被回收）；用 shell_poll 看结果即可，无需 watch。"
        if not r.get("running"):
            return f"该命令已结束(exit_code={r.get('exit_code')})，无需 watch；用 shell_poll(session_id={session_id}) 看结果即可。"
        conv_id, target_type = _resolve_watch_context(runtime)
        if conv_id is None or target_type is None:
            return "无法登记（缺会话上下文）；请改用 shell_wait/shell_poll 自己取结果。"
        get_background_watch_registry().register_watch(
            session_id=session_id, conversation_id=conv_id, target_type=target_type,
        )
        return (
            f"已登记：后台命令 session_id={session_id} 完成后，我会自动回到本会话继续，"
            f"你不用盯着。期间你可以做别的。"
        )

    return StructuredTool.from_function(
        func=_watch_background,
        name="watch_background",
        description=(
            "登记一个后台运行的命令（shell_execute 转后台返回的 session_id），"
            "命令真正完成后系统会自动唤醒我回到本会话继续处理（带上命令结果）。"
            "判断是超大任务、不想让用户盯着时用它；登记后体面收尾本轮即可。"
        ),
    )
```

注意：`StructuredTool.from_function` 会把 `runtime: ToolRuntime` 当作注入参数（langchain 识别 ToolRuntime 类型自动注入，不进 LLM 可见 args）。`get_session_local` 的真实 import 路径实现时 grep 确认（参考 `workspace_api.py:112`）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k watch_background -v`
Expected: 3 passed

- [ ] **Step 5: 全量该文件无回归**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -v`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): watch_background 工具(runtime注入取conv_id+target_type登记watch)+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3：扫描器 `scan_and_wake`（mock wake_fn 测纯逻辑）

**Files:**
- Create: `apps/server/src/service/background_wakeup_scanner.py`
- Test: `apps/server/tests/test_background_wakeup_scanner.py`

- [ ] **Step 1: 写失败测试**

新建 `apps/server/tests/test_background_wakeup_scanner.py`：

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class _FakeWatch:
    session_id: str
    conversation_id: int
    target_type: str = "curator"
    status: str = "watching"


class _FakeWatchRegistry:
    def __init__(self, watches):
        self._watches = {w.session_id: w for w in watches}
        self.fired = []
        self.dropped = []
        self.swept = 0

    def list_watching(self):
        return [w for w in self._watches.values() if w.status == "watching"]

    def mark_fired(self, sid):
        self.fired.append(sid)
        self._watches.pop(sid, None)

    def drop(self, sid):
        self.dropped.append(sid)
        self._watches.pop(sid, None)

    def sweep_stale(self, max_age_seconds=86400):
        self.swept += 1
        return 0


class _FakeShellRegistry:
    def __init__(self, poll_results):
        self._poll = poll_results  # sid -> dict

    def poll(self, sid):
        return self._poll.get(sid, {"found": False})


class _FakeStreamRegistry:
    def __init__(self, busy_ids):
        self._busy = set(busy_ids)

    def is_busy(self, conv_id):
        return conv_id in self._busy


def _scan(**kw):
    from src.service.background_wakeup_scanner import scan_and_wake
    return scan_and_wake(**kw)


def test_finished_idle_session_wakes_and_marks_fired():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": False,
                                           "exit_code": 0, "new_output": "done"}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    res = _scan(shell_registry=shell_reg, watch_registry=watch_reg,
                stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == ["s1"]
    assert watch_reg.fired == ["s1"]
    assert res["woke"] == 1


def test_finished_busy_session_skipped_and_kept():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": False,
                                           "exit_code": 0, "new_output": ""}})
    stream_reg = _FakeStreamRegistry(busy_ids=[10])  # 会话忙
    res = _scan(shell_registry=shell_reg, watch_registry=watch_reg,
                stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == []
    assert watch_reg.fired == []
    assert watch_reg.list_watching()  # 仍保留
    assert res["skipped_busy"] == 1


def test_running_session_not_woken():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": True}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    _scan(shell_registry=shell_reg, watch_registry=watch_reg,
          stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == []
    assert watch_reg.list_watching()


def test_not_found_session_dropped():
    woke = []
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": False}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    _scan(shell_registry=shell_reg, watch_registry=watch_reg,
          stream_registry=stream_reg, wake_fn=lambda w, r: woke.append(w.session_id))
    assert woke == []
    assert watch_reg.dropped == ["s1"]


def test_wake_fn_exception_drops_watch():
    def boom(w, r):
        raise RuntimeError("boom")
    watch_reg = _FakeWatchRegistry([_FakeWatch("s1", 10)])
    shell_reg = _FakeShellRegistry({"s1": {"found": True, "running": False,
                                           "exit_code": 0, "new_output": ""}})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    res = _scan(shell_registry=shell_reg, watch_registry=watch_reg,
                stream_registry=stream_reg, wake_fn=boom)
    assert watch_reg.dropped == ["s1"]
    assert res["woke"] == 0


def test_sweep_stale_called():
    watch_reg = _FakeWatchRegistry([])
    shell_reg = _FakeShellRegistry({})
    stream_reg = _FakeStreamRegistry(busy_ids=[])
    _scan(shell_registry=shell_reg, watch_registry=watch_reg,
          stream_registry=stream_reg, wake_fn=lambda w, r: None)
    assert watch_reg.swept == 1
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_background_wakeup_scanner.py -v`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现 `background_wakeup_scanner.py`（先只写 scan_and_wake，wake_fn 默认实现下个 task 补）**

```python
"""后台命令完成唤醒扫描器：apscheduler 周期调 scan_and_wake，发现 watch 的进程已结束且会话空闲时
触发续跑。依赖（shell_registry/watch_registry/stream_registry/wake_fn）可注入，便于单测。"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def scan_and_wake(*, shell_registry=None, watch_registry=None,
                  stream_registry=None, wake_fn=None) -> dict:
    if shell_registry is None:
        from src.service.shell_background_registry import get_background_shell_registry
        shell_registry = get_background_shell_registry()
    if watch_registry is None:
        from src.service.background_watch_registry import get_background_watch_registry
        watch_registry = get_background_watch_registry()
    if stream_registry is None:
        from src.service.stream_registry import registry as stream_registry  # 实现时确认导出名
    if wake_fn is None:
        wake_fn = _default_wake_fn

    scanned = woke = skipped_busy = dropped = 0
    for w in watch_registry.list_watching():
        scanned += 1
        r = shell_registry.poll(w.session_id)
        if not r.get("found"):
            watch_registry.drop(w.session_id)
            dropped += 1
            continue
        if r.get("running"):
            continue
        # finished
        if stream_registry.is_busy(w.conversation_id):
            skipped_busy += 1
            continue
        try:
            wake_fn(w, r)
        except Exception:
            logger.warning("[bg-wake] wake_fn failed sid=%s", w.session_id, exc_info=True)
            watch_registry.drop(w.session_id)
            dropped += 1
            continue
        watch_registry.mark_fired(w.session_id)
        woke += 1

    watch_registry.sweep_stale()
    return {"scanned": scanned, "woke": woke,
            "skipped_busy": skipped_busy, "dropped": dropped}


def _default_wake_fn(watch, poll_result) -> None:  # 下个 task 实现
    raise NotImplementedError
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_background_wakeup_scanner.py -v`
Expected: 6 passed

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/background_wakeup_scanner.py apps/server/tests/test_background_wakeup_scanner.py
git commit -m "feat(shell): scan_and_wake扫描器(finished+空闲→唤醒+单次性,忙跳过,异常drop)+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4：续跑触发器 `_default_wake_fn`（mock registry.start 测参数）

**Files:**
- Modify: `apps/server/src/service/background_wakeup_scanner.py`
- Test: `apps/server/tests/test_background_wakeup_scanner.py`

**说明**：真起 agent / 真投主循环留给手动验证。本 task 把「组装唤醒消息 + 落库 + 二分构造 + registry.start」做出来，但通过依赖注入让测试用 spy 替掉 registry.start / 主循环 / agent 构造，断言**参数正确**（messages 含 session_id/exit_code/输出、curator 传 orchestrator_* 三参、employee 传 orchestrator_conversation_id=None）。

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_background_wakeup_scanner.py` 末尾追加：

```python
def test_build_wake_messages_contains_session_and_exit_and_output():
    from src.service.background_wakeup_scanner import _build_wake_user_message
    msg = _build_wake_user_message(
        session_id="s9", exit_code=0,
        new_output="line1\nline2\nline3\n", tail_lines=2,
    )
    assert "s9" in msg
    assert "exit_code=0" in msg or "exit_code" in msg
    assert "line2" in msg and "line3" in msg  # 末尾2行
    assert "line1" not in msg


def test_build_wake_messages_no_output_marker():
    from src.service.background_wakeup_scanner import _build_wake_user_message
    msg = _build_wake_user_message(session_id="s9", exit_code=1, new_output="", tail_lines=20)
    assert "s9" in msg
    assert "输出已被回收" in msg or "无输出" in msg
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_background_wakeup_scanner.py -k build_wake -v`
Expected: FAIL（`ImportError: cannot import name '_build_wake_user_message'`）

- [ ] **Step 3: 实现 `_build_wake_user_message` + `_default_wake_fn`**

替换 `background_wakeup_scanner.py` 里的 `_default_wake_fn` 占位，并加 `_build_wake_user_message`：

```python
def _build_wake_user_message(*, session_id: str, exit_code, new_output: str,
                             tail_lines: int = 30) -> str:
    if new_output and new_output.strip():
        lines = new_output.rstrip("\n").split("\n")
        tail = "\n".join(lines[-tail_lines:])
    else:
        tail = "(输出已被回收)"
    return (
        f"[后台任务完成] session_id={session_id} exit_code={exit_code}\n"
        f"末尾输出:\n{tail}\n"
        f"请基于此结果继续之前的任务。"
    )


def _default_wake_fn(watch, poll_result) -> None:
    """续跑触发器：落 user/assistant 消息 + 主循环线程构造 agent + registry.start。
    按 watch.target_type 二分 curator / employee。"""
    from src.models.conversation import Conversation, ConversationMessage
    from src.core.agent_runtime_policy import get_agent_runtime_policy
    from src.service.agent.orchestrator.runtime import get_main_loop
    from src.service.stream_registry import registry as stream_registry

    conv_id = watch.conversation_id
    wake_msg = _build_wake_user_message(
        session_id=watch.session_id,
        exit_code=poll_result.get("exit_code"),
        new_output=poll_result.get("new_output", ""),
    )

    db = _new_db_session()
    try:
        conv = db.get(Conversation, conv_id)
        if conv is None:
            logger.warning("[bg-wake] conversation %s gone, skip", conv_id)
            return
        db.add(ConversationMessage(conversation_id=conv_id, role="user",
                                   content=wake_msg, stream_state="completed"))
        policy = get_agent_runtime_policy()
        cap = policy.effective_max_inflight()
        slot_busy = cap > 0 and stream_registry.count_active_streams() >= cap
        asst_state = "queued" if slot_busy else "streaming"
        assistant = ConversationMessage(conversation_id=conv_id, role="assistant",
                                        content="", stream_state=asst_state)
        db.add(assistant)
        db.flush()
        asst_id = assistant.id
        workspace_id = conv.workspace_id
        target_type = watch.target_type
        db.commit()
    finally:
        db.close()

    main_loop = get_main_loop()
    main_loop.call_soon_threadsafe(
        _start_wake_stream_on_main,
        conv_id, asst_id, workspace_id, target_type, wake_msg,
    )


def _new_db_session():
    from src.db import get_session_local  # 实现时按真实路径调整
    return get_session_local()()


def _start_wake_stream_on_main(conv_id, asst_id, workspace_id, target_type, wake_msg) -> None:
    """在主事件循环线程构造 agent + registry.start。按 target_type 二分。"""
    from src.service.stream_registry import registry as stream_registry
    messages = [{"role": "user", "content": wake_msg}]
    config = {"configurable": {"thread_id": conv_id}}
    if target_type == "curator":
        from src.service.agent.orchestrator import get_orchestrator_agent
        from src.service.agent.orchestrator.runtime import reset_context
        orch_db = _new_db_session()
        try:
            agent = get_orchestrator_agent(workspace_id, orch_db, conv_id,
                                           employee_id=None, bind_context=False)
            stream_registry.start(
                conversation_id=conv_id, agent=agent, messages=messages,
                config=config, stream_msg_id=asst_id, skill_name="",
                debug_content_only=False,
                orchestrator_owned_db=orch_db, orchestrator_workspace_id=workspace_id,
                orchestrator_conversation_id=conv_id, source="background_wakeup",
            )
        except Exception:
            logger.warning("[bg-wake] curator start failed conv=%s", conv_id, exc_info=True)
            reset_context(conv_id)
            orch_db.close()
    else:
        from src.service.agent.orchestrator.execution import build_employee_agent_for_wake
        try:
            agent = build_employee_agent_for_wake(conv_id)
            stream_registry.start(
                conversation_id=conv_id, agent=agent, messages=messages,
                config=config, stream_msg_id=asst_id, skill_name="",
                debug_content_only=False,
                orchestrator_conversation_id=None, source="background_wakeup",
            )
        except Exception:
            logger.warning("[bg-wake] employee start failed conv=%s", conv_id, exc_info=True)
```

**实现者注意**：`build_employee_agent_for_wake(conv_id)` 是一个**你需要在 `execution.py` 里加的薄 helper**（从 conv_id 解析 employee_id/skills_path/root_path 后调 `get_agent(...)`，复用 `start_task_as_conversation` 里 execution.py:439-447 的构造参数）。若 employee 续跑路径暂不完善，本 task 至少保证 curator 路径正确 + employee 路径不崩（用 try/except 兜住），员工路径细节可在手动验证阶段补。`get_session_local` / `get_orchestrator_agent` / `registry` 的真实 import 路径实现时 grep 确认。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_background_wakeup_scanner.py -k build_wake -v`
Expected: 2 passed（消息组装可单测；真起流路径靠手动验证）

- [ ] **Step 5: 全量该文件无回归**

Run: `cd apps/server && uv run pytest tests/test_background_wakeup_scanner.py -v`
Expected: 全部 PASS（含 Task3 的 6 个）

- [ ] **Step 6: import 冒烟（确保新模块 import 链不崩）**

Run: `cd apps/server && uv run python -c "import src.service.background_wakeup_scanner; print('ok')"`
Expected: `ok`

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/service/background_wakeup_scanner.py apps/server/tests/test_background_wakeup_scanner.py
git commit -m "feat(shell): 续跑触发器_default_wake_fn(组装唤醒消息+落库+主线程构造agent+registry.start,curator/employee二分)+消息组装测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5：接 apscheduler 周期 job + 注册 watch_background 工具

**Files:**
- Modify: `apps/server/src/service/task_scheduler_service.py`
- Modify: `apps/server/src/service/agent/employee.py` + `orchestrator/agent.py`
- Test: `apps/server/tests/test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_watch_background_factory_named_correctly():
    from src.service.agent.shell_execute_tool import create_watch_background_tool
    assert create_watch_background_tool().name == "watch_background"


def test_modules_import_watch_background():
    import src.service.agent.employee as emp
    import src.service.agent.orchestrator.agent as orch
    assert hasattr(emp, "create_watch_background_tool")
    assert hasattr(orch, "create_watch_background_tool")


def test_scheduler_has_run_scan_and_wake_job():
    from src.service.task_scheduler_service import TaskSchedulerService
    assert hasattr(TaskSchedulerService, "run_scan_and_wake_job")
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "watch_background_factory or modules_import_watch_background or run_scan_and_wake_job" -v`
Expected: factory PASS；后两个 FAIL。

- [ ] **Step 3: 实现**

(a) `employee.py` import 组加 `create_watch_background_tool,`（在 `create_start_service_tool,` 后）；注册段加：
```python
    extra_tools.append(create_watch_background_tool())
```
(在 `extra_tools.append(create_start_service_tool())` 之后)

(b) `orchestrator/agent.py` import 组加 `create_watch_background_tool,`；注册段加：
```python
    orchestrator_tools.append(create_watch_background_tool())
```
(在 `orchestrator_tools.append(create_start_service_tool())` 之后)

(c) `task_scheduler_service.py`：顶部 import 区加 `from apscheduler.triggers.interval import IntervalTrigger`。
加一个 classmethod（仿 `run_dispatch_order_sync_job`，放它旁边）：
```python
    @staticmethod
    def run_scan_and_wake_job() -> None:
        from src.service.background_wakeup_scanner import scan_and_wake
        try:
            res = scan_and_wake()
        except Exception as exc:
            logger.warning("后台唤醒扫描失败（已忽略）: %s", exc)
            return
        if res.get("woke") or res.get("dropped"):
            logger.info("后台唤醒扫描 scanned=%s woke=%s skipped_busy=%s dropped=%s",
                        res.get("scanned"), res.get("woke"),
                        res.get("skipped_busy"), res.get("dropped"))
```
在 `_register_system_jobs` 末尾（for 循环之后）追加注册：
```python
        scheduler.add_job(
            cls.run_scan_and_wake_job,
            trigger=IntervalTrigger(seconds=20, timezone=CST),
            id="system:scan_and_wake",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=15,
        )
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_execute_tool.py -k "watch_background_factory or modules_import_watch_background or run_scan_and_wake_job" -v`
Expected: 3 passed

- [ ] **Step 5: import 冒烟**

Run: `cd apps/server && uv run python -c "import src.service.agent.employee; import src.service.agent.orchestrator.agent; import src.service.task_scheduler_service; print('ok')"`
Expected: `ok`

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/employee.py apps/server/src/service/agent/orchestrator/agent.py apps/server/src/service/task_scheduler_service.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): 员工+总管注册watch_background + apscheduler每20s扫描唤醒job+测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6：A 话术升级（稍后问我进度 → 完成自动继续）

**Files:**
- Modify: `apps/server/src/service/agent/shell_execute_tool.py`（shell_wait「仍在运行」返回）
- Modify: `apps/server/src/service/skill_shell_backend.py`（at-handoff 话术）
- Modify: `apps/server/src/service/agent/orchestrator/prompts.py` + `prompts.py`
- Test: `apps/server/tests/test_shell_environment_prompt.py` + `test_shell_execute_tool.py`

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/test_shell_environment_prompt.py` 末尾追加：

```python
def test_orchestrator_prompt_mentions_watch_background():
    from src.service.agent.orchestrator.prompts import (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    )
    assert "watch_background" in ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE


def test_employee_prompt_mentions_watch_background():
    import inspect
    import src.service.agent.prompts as prompts_mod
    assert "watch_background" in inspect.getsource(prompts_mod)
```

在 `apps/server/tests/test_shell_execute_tool.py` 末尾追加：

```python
def test_shell_wait_running_message_mentions_watch_background():
    # shell_wait「仍在运行」返回应引导 watch_background（升级 A 的「稍后问我」）
    import inspect
    import src.service.agent.shell_execute_tool as mod
    src = inspect.getsource(mod.create_shell_wait_tool)
    assert "watch_background" in src
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k watch_background tests/test_shell_execute_tool.py -k shell_wait_running_message -v`
Expected: FAIL（关键词缺）

- [ ] **Step 3: 实现**

(a) `shell_execute_tool.py` 的 `create_shell_wait_tool` —— 把「仍在运行」返回末句改为引导 watch_background。当前是：
```python
            f"[offset={r['offset']}] 可再 shell_wait 等一轮，或判断是超大任务后告知用户稍后问进度。"
```
改为：
```python
            f"[offset={r['offset']}] 可再 shell_wait 等一轮；若判断是超大任务，"
            f"调 watch_background(session_id) 登记——完成后我会自动回到本会话继续，不必让用户盯着。"
```

(b) `skill_shell_backend.py` 的 at-handoff note（约 :644-648，A 改过的那段）—— 末句补 watch_background。当前末句类似「判断是超大任务时告诉用户稍后问你进度并体面收尾，勿杀了重试」，改为：
```python
                f"判断是超大任务时调 watch_background(session_id) 登记，完成后系统会自动唤醒我回到本会话继续；"
                f"然后体面收尾，勿杀了重试。]"
```
（实现时 grep 定位 A 写的那句的确切文本再替换）

(c) `orchestrator/prompts.py` 的「起常驻服务用 start_service」bullet 之后（B 加的，grep `起常驻服务用 start_service`），加同级 bullet（column 0）：
```
- **超大任务用 watch_background 登记**：等了几轮判断是真·超大任务（拉大镜像/全盘扫描/大型编译）时，调 `watch_background(session_id)` 登记——命令完成后系统会**自动唤醒你回到本会话继续**（带上结果）。告诉用户「这任务较久，完成后我会自动回来继续，你不用盯着」，然后体面收尾本轮。不必再让用户「稍后问你进度」。
```

(d) `prompts.py` 的「起常驻服务用 start_service」bullet 之后（grep `起常驻服务用 start_service`），加同级 bullet（8 空格 + `- `）：
```
        - **超大任务用 watch_background 登记**：等了几轮判断是真·超大任务（拉大镜像/全盘扫描/大型编译）时，调 `watch_background(session_id)` 登记——命令完成后系统会**自动唤醒你回到本会话继续**（带上结果）。告诉用户「这任务较久，完成后我会自动回来继续，你不用盯着」，然后体面收尾。不必再让用户「稍后问你进度」。
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_shell_environment_prompt.py -k watch_background tests/test_shell_execute_tool.py -k shell_wait_running_message -v`
Expected: 3 passed

- [ ] **Step 5: import 冒烟**

Run: `cd apps/server && uv run python -c "import src.service.agent.orchestrator.prompts; import src.service.agent.prompts; import src.service.skill_shell_backend; import src.service.agent.shell_execute_tool; print('ok')"`
Expected: `ok`

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/shell_execute_tool.py apps/server/src/service/skill_shell_backend.py apps/server/src/service/agent/orchestrator/prompts.py apps/server/src/service/agent/prompts.py apps/server/tests/test_shell_environment_prompt.py apps/server/tests/test_shell_execute_tool.py
git commit -m "feat(shell): A话术升级 稍后问我进度→watch_background登记完成自动继续(shell_wait/at-handoff/两套prompt)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7：全量回归 + import 冒烟 + 手动验证

**Files:** 无新增，仅验证。

- [ ] **Step 1: 全部 shell/service/watch/wake 相关测试**

Run: `cd apps/server && uv run pytest tests/ -k "shell or service or watch or wake" -v`
Expected: 全部 PASS（除 2 个**预先存在**的 `test_shell_error_steering` 失败——与本子项目无关，已有独立任务跟进；确认无**新增**失败）

- [ ] **Step 2: 全模块 import 冒烟**

Run: `cd apps/server && uv run python -c "import src.service.background_watch_registry; import src.service.background_wakeup_scanner; import src.service.agent.employee; import src.service.agent.orchestrator.agent; import src.service.task_scheduler_service; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 手动验证（人工，记录结论）**

重启后端，让员工/总管跑一个会转后台的命令（如 `python -c "import time; time.sleep(150); print('DONE')"`，前台默认 60s 转后台）：
- 模型 shell_wait 等几轮 → 调 watch_background(session_id) → 返回「已登记，完成后自动回来」；
- 模型体面收尾本轮，会话变 idle；
- 等命令真跑完（150s）→ 约 20s 内（扫描周期）后端自动在**原会话**新建一轮 assistant 消息、注入「[后台任务完成] exit_code=0 DONE」、模型续跑；
- 前端在该会话能看到这条自动续跑的消息（重连/在该会话时）；
- 验证不重复唤醒（同 session 只续跑一次）；
- 验证会话忙时不硬塞（手动在该会话发消息让它忙，命令此时跑完 → 应等会话空闲下轮才唤醒）。

记录结论。若 employee 续跑路径有问题（build_employee_agent_for_wake），记下来单独修；curator 路径是主路径，优先确保它对。

---

## 完成定义

- watch 登记表（单次性 + 24h 清理）、watch_background 工具（runtime 注入取 conv_id+target_type）、scan_and_wake 扫描器（finished+空闲→唤醒、忙跳过、异常 drop、单次性）、续跑触发器（curator/employee 二分、主线程搬运）、apscheduler 每 20s job、员工+总管注册。
- A 话术升级：shell_wait/at-handoff/两套 prompt 都从「稍后问我进度」改为「watch_background 登记 + 完成自动继续」。
- 三道防竞态闸落地：单次性 mark_fired、is_busy 跳过、call_soon_threadsafe 主线程构造。
- 全部 shell/watch/wake 测试 PASS（不含 2 个预存 error_steering 陈旧失败）。
- 手动验证 curator 续跑闭环（employee 路径若有问题单独跟进）。

## Self-Review 注记

- `_Watch` 字段（session_id/conversation_id/target_type/created_at/status）：Task1 定义、Task3 假对象同构、Task4 消费 target_type 二分，一致。
- watch 表方法名（register_watch/list_watching/mark_fired/drop/sweep_stale）：Task1 定义、Task3 调用、Task5 job 间接用，一致。
- scan_and_wake 返回键（scanned/woke/skipped_busy/dropped）：Task3 定义、Task5 job 日志消费，一致。
- registry.start 参数：curator 传 orchestrator_owned_db/_workspace_id/_conversation_id，employee 传 orchestrator_conversation_id=None 不传 owned_db——Task4 两分支分别写死，与调研 Q3 样例一致。
- 线程坑：Task4 agent 构造 + start 全在 `_start_wake_stream_on_main`（经 call_soon_threadsafe 投主循环），不在 apscheduler 线程——写死。
- 实现期需 grep 确认的真实 import 路径：`get_session_local`、`stream_registry` 导出名、`get_orchestrator_agent`/`get_agent` 入口、A 在 skill_shell_backend/prompts 写的确切句子——计划已在对应步注明「实现时 grep 确认」。
