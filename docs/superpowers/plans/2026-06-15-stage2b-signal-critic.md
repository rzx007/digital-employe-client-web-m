# 阶段 2B：critic 信号闸门（重构 run_reflection）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：[阶段2 总览](2026-06-15-stage2-learning-loop-overview.md) §2B。基底 `feat/orchestrator-centric`（2A 已完成）。

**Goal:** 把"每个完成的员工任务都自动 LLM 反思"重构为"**只在信号触发时**反思"，对齐 spec §3「信号闸门、别每任务反思（省 GPU、避噪声）」。v1 信号 = **失败后成功**；触发时跑信号感知的 critic 提炼"上次为何失败、这次为何成功"→写 memory（软知识）。**不**在此晋升 skill（留 2C）。

**Architecture:** `reflection_engine.py` 加信号检测 `detect_failure_then_success(db, log)` + 闸门 `maybe_reflect_on_signal(db, log)`（无信号→不调模型）+ 信号感知反思（复用现有 memory 写入机制，prompt 改为对比失败/成功）。`_finalize_task_stream` 删掉 L2332-2343 的**无条件** run_reflection，改在 journal 捕获处之后调 `maybe_reflect_on_signal(db, log)`。

**Tech Stack:** Python / SQLAlchemy / pytest（mock LLM）。测试 `cd apps/server && uv run pytest tests/... -v`。

---

## 设计要点（实现前必读）

**现状**（reflection_engine.py + stream_registry.py:2332-2343）：`run_reflection(conversation_id, employee_id, db)` 在每个 `completed` 且 `conv.target_type=="employee"` 时无条件跑：抽对话里的偏好/事实/教训→写 `<skill_path>/<eid>/memories/AGENTS.md`，60s/员工限流。

**2B 改造**：
1. **信号检测**（v1 仅失败后成功）：给定刚终态的 `log`(success)，查同 `task_id` 是否有更早的 `failed` 记录；有→返回失败上下文(error_message 等)，无→None。
2. **闸门**：`maybe_reflect_on_signal(db, log)`——log 非 success / 无 employee_id / 无信号 → 直接 return（**不调模型**）；有信号 → 跑信号感知反思。
3. **信号感知反思**：prompt 改为"上次因 X 失败、这次成功，对比提炼可复用教训"，写 memory（复用现有 AGENTS.md 插入机制 + 60s 锁）。
4. **重新挂载**：`_finalize_task_stream` **删** L2332-2343 无条件 run_reflection 块；在 2A 的 `_capture_journal_safe(db, log)`(约 L2419)**之后**加 `_reflect_on_signal_safe(db, log)`(容错封装)。

**行为变化（诚实记录）**：
- 普通成功任务**不再自动反思**（省 GPU/避噪声，spec 初心）。journal(2A) 仍捕获全部轨迹。
- 员工**直聊**（无 TaskExecutionLog）**不再自动反思**（旧行为会；现靠 remember_memory_tool 显式记 + 信号）。可接受(直聊阶段4 退场方向)；如需保留另议。
- 重复模式→skill 晋升留 2C；用户纠正/验收返工信号留 v2。

**保留**：`run_reflection` 函数可保留为"信号感知反思"的内核（重构其 prompt），或新写 `_reflect_with_signal`——实现时择一，**但 _finalize_task_stream 不再无条件调 run_reflection**。

**文件结构**：
- 改：`apps/server/src/service/reflection_engine.py`（加 detect + 闸门 + 信号 prompt）
- 改：`apps/server/src/service/stream_registry.py`（删无条件 run_reflection、加信号闸门调用）
- 测：新建 `apps/server/tests/test_signal_critic.py`

---

## Task 1：detect_failure_then_success 信号检测

**Files:**
- Modify: `apps/server/src/service/reflection_engine.py`
- Test: `apps/server/tests/test_signal_critic.py`

- [ ] **Step 1: 写失败测试**（新建）

```python
"""2B：信号闸门 critic。"""
import json
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from tests.conftest import add_employee


def _log(db, ws_id, emp_id, *, task_id, status, error=None):
    lg = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id,
        task_name_snapshot="活", run_status=status,
        output_json=json.dumps({"content": "ok"}, ensure_ascii=False),
        error_message=error, started_at=cst_now(), ended_at=cst_now(),
    )
    db.add(lg); db.commit(); db.refresh(lg)
    return lg


def test_detect_failure_then_success_positive(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=7, status="failed", error="ModuleNotFound xyz")
    success = _log(db_session, workspace.id, emp.id, task_id=7, status="success")
    ctx = detect_failure_then_success(db_session, success)
    assert ctx is not None
    assert "xyz" in ctx  # 含上次失败原因


def test_detect_no_prior_failure_returns_none(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    success = _log(db_session, workspace.id, emp.id, task_id=8, status="success")
    assert detect_failure_then_success(db_session, success) is None


def test_detect_non_success_log_returns_none(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=9, status="failed", error="x")
    failed2 = _log(db_session, workspace.id, emp.id, task_id=9, status="failed", error="y")
    assert detect_failure_then_success(db_session, failed2) is None  # 当前非 success
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_signal_critic.py -k detect -v`

- [ ] **Step 3: 实现**（加到 reflection_engine.py）

```python
def detect_failure_then_success(db: Session, log) -> str | None:
    """信号：同 task_id 先失败后成功。返回上次失败上下文(供 critic prompt)，无信号→None。"""
    try:
        if log is None or log.task_id is None or log.run_status != "success":
            return None
        from src.models.task_execution_log import TaskExecutionLog
        prior_failed = db.scalars(
            select(TaskExecutionLog)
            .where(
                TaskExecutionLog.task_id == log.task_id,
                TaskExecutionLog.run_status == "failed",
                TaskExecutionLog.id < log.id,
            )
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if prior_failed is None:
            return None
        err = (prior_failed.error_message or prior_failed.run_result or "未知原因")[:1000]
        return f"上次执行（log#{prior_failed.id}）失败，原因：{err}"
    except Exception:
        logger.warning("detect_failure_then_success failed", exc_info=True)
        return None
```
（`select` 已在文件顶部 import；确认。）

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_signal_critic.py -k detect -v`

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/reflection_engine.py apps/server/tests/test_signal_critic.py
git commit -m "feat(learning): 信号检测 detect_failure_then_success（失败后成功）"
```

---

## Task 2：maybe_reflect_on_signal 闸门 + 信号感知反思

**Files:**
- Modify: `apps/server/src/service/reflection_engine.py`
- Test: `apps/server/tests/test_signal_critic.py`

- [ ] **Step 1: 写失败测试**（追加；mock LLM + memory 路径）

```python
def test_maybe_reflect_no_signal_skips_llm(db_session, workspace, monkeypatch):
    """无信号（普通成功）→ 不调 LLM。"""
    from src.service import reflection_engine as re
    called = {"n": 0}
    monkeypatch.setattr(re, "_build_llm", lambda: (_ for _ in ()).throw(AssertionError("不该调LLM")))
    emp = add_employee(db_session, workspace.id, name="w")
    success = _log(db_session, workspace.id, emp.id, task_id=20, status="success")
    re.maybe_reflect_on_signal(db_session, success)  # 不抛、不调 LLM


def test_maybe_reflect_on_signal_writes_memory(db_session, workspace, monkeypatch, tmp_path):
    """失败后成功 → 调 LLM 提炼 → 写 memory。"""
    from src.service import reflection_engine as re

    class _FakeLLM:
        def invoke(self, prompt):
            assert "失败" in prompt  # 信号感知 prompt
            class _R: content = "§上次因缺依赖失败，先 pip install 再跑"
            return _R()

    monkeypatch.setattr(re, "_build_llm", lambda: _FakeLLM())
    monkeypatch.setattr(re, "_resolve_memories_path", lambda eid: tmp_path / str(eid) / "memories")
    monkeypatch.setattr(re, "_get_conversation_messages", lambda db, cid: "用户:做X\n助手:好")
    re._reflect_locks.clear()  # 清限流

    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=21, status="failed", error="缺依赖")
    success = _log(db_session, workspace.id, emp.id, task_id=21, status="success")
    success.conversation_id = 1; db_session.commit()

    re.maybe_reflect_on_signal(db_session, success)

    mem = (tmp_path / str(emp.id) / "memories" / "AGENTS.md")
    assert mem.exists()
    assert "pip install" in mem.read_text(encoding="utf-8")
```

> `_resolve_memories_path` 需建目录（实现里 mkdir）；测试 monkeypatch 它指向 tmp。AGENTS.md 不存在时反思要能新建（现有 run_reflection 假定已存在，2B 要兜底建文件——见实现）。

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_signal_critic.py -k maybe_reflect -v`

- [ ] **Step 3: 实现**

加 `maybe_reflect_on_signal` + 信号感知反思（可重构现有 run_reflection 的 prompt/内核；下面给独立实现，复用现有 `_acquire_reflect_lock`/`_get_conversation_messages`/`_resolve_memories_path`/`_build_llm` + memory 插入逻辑）：

```python
def maybe_reflect_on_signal(db: Session, log) -> None:
    """信号闸门：仅在检测到信号时反思（v1：失败后成功）。无信号不调模型。"""
    if log is None or log.employee_id is None or log.run_status != "success":
        return
    signal_ctx = detect_failure_then_success(db, log)
    if signal_ctx is None:
        return
    _reflect_with_signal(db, log.conversation_id, log.employee_id, signal_ctx)


def _reflect_with_signal(db, conversation_id, employee_id, signal_ctx: str) -> None:
    if employee_id is None:
        return
    if not _acquire_reflect_lock(employee_id):
        return
    messages = _get_conversation_messages(db, conversation_id) if conversation_id else ""
    memories_path = _resolve_memories_path(employee_id)
    memories_path.mkdir(parents=True, exist_ok=True)
    memory_file = memories_path / "AGENTS.md"
    current_memory = ""
    if memory_file.exists():
        from src.service.agent.memory_file import ensure_memory_file_utf8
        from src.service.basic_file_reader import read_text_with_encoding_fallback
        ensure_memory_file_utf8(memory_file)
        current_memory = read_text_with_encoding_fallback(memory_file)
    llm = _build_llm()
    prompt = (
        "你是经验提取助手。某员工的一个任务**先失败后成功**了。请对比提炼"
        "「这次为何成功、上次的坑是什么、下次同类活怎么做」成 1-3 条**可复用教训**。\n\n"
        f"{signal_ctx}\n\n"
        f"已有记忆：\n{current_memory}\n\n"
        f"本次（成功）对话：\n{messages}\n\n"
        '输出：每行一条以「§」开头；不重复已有；无新发现输出「无」。'
    )
    result = llm.invoke(prompt).content.strip()
    if not result or "无" in result[:10]:
        return
    _append_memory_entries(memory_file, current_memory, result)


def _append_memory_entries(memory_file, current_memory: str, result: str) -> None:
    """把新条目插到「---」分隔线前（沿用原 run_reflection 写法）。"""
    new_entries = result.replace("§ ", "§")
    if not current_memory.endswith("\n"):
        current_memory += "\n"
    lines = current_memory.split("\n")
    insert_before = len(lines)
    for i, line in enumerate(lines):
        if line.strip().startswith("---"):
            insert_before = i
            break
    lines.insert(insert_before, "")
    lines.insert(insert_before, new_entries)
    memory_file.write_text("\n".join(lines), encoding="utf-8")
```

> 可顺手把原 `run_reflection` 的 memory 写入段抽用 `_append_memory_entries`（DRY），但**不强制**；关键是新增上面三个函数且行为正确。

- [ ] **Step 4: 跑测试 + 回归**
Run: `cd apps/server && uv run pytest tests/test_signal_critic.py -v`
Expected: 全 PASS

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/reflection_engine.py apps/server/tests/test_signal_critic.py
git commit -m "feat(learning): maybe_reflect_on_signal 信号闸门 + 失败后成功信号感知反思"
```

---

## Task 3：重新挂载 _finalize_task_stream（删无条件反思）

**Files:**
- Modify: `apps/server/src/service/stream_registry.py`
- Test: `apps/server/tests/test_signal_critic.py`

- [ ] **Step 1: 写失败测试**（追加；验证封装契约 + 无条件反思已移除）

```python
def test_reflect_on_signal_safe_calls_gate(monkeypatch):
    import src.service.reflection_engine as re
    calls = []
    monkeypatch.setattr(re, "maybe_reflect_on_signal", lambda db, log: calls.append(log))
    from src.service.stream_registry import _reflect_on_signal_safe
    sentinel = object()
    _reflect_on_signal_safe(object(), sentinel)
    assert calls == [sentinel]


def test_reflect_on_signal_safe_swallows(monkeypatch):
    import src.service.reflection_engine as re
    monkeypatch.setattr(re, "maybe_reflect_on_signal",
                        lambda db, log: (_ for _ in ()).throw(RuntimeError("boom")))
    from src.service.stream_registry import _reflect_on_signal_safe
    _reflect_on_signal_safe(object(), object())  # 不抛
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_signal_critic.py -k reflect_on_signal_safe -v`

- [ ] **Step 3: 实现**

① 在 `stream_registry.py` 加封装（靠近 `_capture_journal_safe`）：
```python
def _reflect_on_signal_safe(db, log) -> None:
    try:
        from src.service.reflection_engine import maybe_reflect_on_signal
        maybe_reflect_on_signal(db, log)
    except Exception:
        logger.warning("signal reflection hook failed", exc_info=True)
```

② **删除** `_finalize_task_stream` 中 L2332-2343 的无条件反思块：
```python
        # 2. 后执行反思（仅 completed，从 Conversation 获取 employee_id）
        if stream_state == "completed":
            employee_id = None
            if conv and conv.target_type == "employee":
                employee_id = conv.target_id
            if employee_id is not None:
                try:
                    from src.service.reflection_engine import run_reflection
                    run_reflection(conversation_id, employee_id, db)
                except Exception:
                    logger.warning("reflection failed conv=%s", conversation_id, exc_info=True)
```
（整块删掉。）

③ 在 2A 的 `_capture_journal_safe(db, log)` 之后加：
```python
        _capture_journal_safe(db, log)
        _reflect_on_signal_safe(db, log)   # ← 新增：信号闸门 critic（替代旧的无条件反思）
```

> 这样反思从"每完成的员工会话(L2332,基于 conv)"改为"基于 log 的信号闸门(终态汇合点)"。员工直聊无 log→不反思（行为变化，已在设计要点记录）。`run_reflection` 函数本身可保留(暂不删,无人无条件调它了)，或在报告注明留待 2C/收尾清理。

- [ ] **Step 4: 跑测试 + 回归**
Run: `cd apps/server && uv run pytest tests/test_signal_critic.py tests/test_journal_capture.py -v`
然后 `cd apps/server && uv run pytest tests/ -k "stream_registry or finaliz or reflect or journal" -v`（无新增回归）

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/stream_registry.py apps/server/tests/test_signal_critic.py
git commit -m "feat(learning): 反思改信号闸门（删每任务无条件反思，挂 maybe_reflect_on_signal）"
```

---

## 收尾验证
- [ ] 全量后端：`cd apps/server && uv run pytest tests/ -q`，仅预存基线失败、零新增回归（基线=2B 前 sha，worktree 比对）。
- [ ] 手测桩：普通成功任务→**不**触发反思(日志无反思、memory 不变)；失败任务重试成功→触发→memory 多一条对比教训。

## 开放问题
- O1 失败后成功判定窗口：本版"同 task_id 任意更早 failed"。是否限相邻/限时间窗，后续按需。
- O2 员工直聊不再自动反思：若要保留，另加"直聊也走某信号"，本版不做。
- O3 run_reflection 旧函数保留未删（无人无条件调）：2C/收尾决定删或复用。
</content>
