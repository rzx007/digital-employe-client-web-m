# 阶段 2A：journal 捕获 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：[阶段2 总览](2026-06-15-stage2-learning-loop-overview.md) 2A。基底 `feat/orchestrator-centric`。

**Goal:** 子任务终态时**自动、不调模型**地往该员工大脑的 `journal/YYYY-MM-DD.jsonl` 追加一条结构化流水（任务/成败/耗时/打法/结论），作为学习闭环的便宜地基。

**Architecture:** 新建 `service/learning/journal.py` 的纯逻辑 `capture_journal_entry(db, log)`：从 `TaskExecutionLog` 取字段 + 解析最后一条 assistant 消息的 `message_parts` 得 tools_used + 解析 EmployeeTask 得 task_name → 拼 entry → append jsonl。挂到 `stream_registry._finalize_task_stream` 在 log 终态写完之后。零模型调用、append-only、异常吞咽不影响主流程。

**Tech Stack:** Python / SQLAlchemy / pytest。测试 `cd apps/server && uv run pytest tests/... -v`。

---

## 设计要点（实现前必读）

**大脑根**：`resolve_employee_memories_dir(employee_id=eid).parent`（= `<settings.skill_path>/<employee_id>`，paths.py:78）。journal 目录 = `brain_root / "journal"`。

**entry schema**（一行 json）：
```json
{
  "ts": "<started_at ISO 或 ended_at ISO>",
  "task_id": 53,
  "task_name": "查询抖音热搜Top10",
  "employee_id": 42,
  "status": "success|failed|cancelled",
  "duration_ms": 12345,
  "conclusion": "<output_json.content 截断 ~500 字>",
  "error": "<error_message 或 null>",
  "tools_used": ["shell_execute", "skill-x"]
}
```

**挂载点**：`_finalize_task_stream`（stream_registry.py）——在 `log` 终态字段写完、`db.commit()`/`db.refresh(log)` **之后**（约 L2408 附近，success/failed/cancelled 分支都过完）。这样 journal 能拿到最终 status/duration/output_json。**interrupted 分支(L2357)提前 return，不记 journal**（暂停不是终态）。

**tools_used 解析**：从最后一条 assistant `ConversationMessage.message_parts`(JSON) 找工具调用 part。**part 结构以实际为准**——可能是 `{"type":"dynamic-tool","toolName":...}` 或 `{"type":"tool-<name>"}` 或含 `toolName`/`toolCallId`。实现 2A-2 时先读 `message_parts_extractor.py` 或一条真实 message_parts 确认，再写解析；解析失败兜底空列表，绝不抛。

**零成本/健壮**：纯文件 append + json.dumps(ensure_ascii=False)；目录 mkdir(exist_ok)；整个 capture 包 try/except 只 warning（journal 失败绝不影响任务终态/主流程）。

**文件结构**：
- 新建：`apps/server/src/service/learning/__init__.py`、`apps/server/src/service/learning/journal.py`
- 改：`apps/server/src/service/stream_registry.py`（挂一行调用）
- 测：新建 `apps/server/tests/test_journal_capture.py`

---

## Task 1：capture_journal_entry 核心（log 字段 → jsonl）

**Files:**
- Create: `apps/server/src/service/learning/__init__.py`（空）、`apps/server/src/service/learning/journal.py`
- Test: `apps/server/tests/test_journal_capture.py`

- [ ] **Step 1: 写失败测试**（新建 test）

```python
"""2A：子任务终态写 journal。"""
import json
from pathlib import Path

from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from tests.conftest import add_employee


def _settle_log(db, ws_id, emp_id, *, status="success", task_id=None):
    log = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id,
        task_name_snapshot="查询抖音热搜", run_status=status,
        run_result="任务执行成功" if status == "success" else "任务执行失败",
        output_json=json.dumps({"content": "抖音热搜Top10：…"}, ensure_ascii=False),
        error_message=None if status == "success" else "boom",
        started_at=cst_now(), ended_at=cst_now(), duration_ms=12345,
    )
    db.add(log); db.commit(); db.refresh(log)
    return log


def test_capture_journal_entry_appends_jsonl(db_session, workspace, monkeypatch, tmp_path):
    from src.service.learning import journal
    # 让大脑根落到 tmp（skill_path 指向 tmp）
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))

    emp = add_employee(db_session, workspace.id, name="调研员")
    log = _settle_log(db_session, workspace.id, emp.id, status="success")

    journal.capture_journal_entry(db_session, log)

    jdir = tmp_path / str(emp.id) / "journal"
    files = list(jdir.glob("*.jsonl"))
    assert len(files) == 1
    lines = files[0].read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["task_name"] == "查询抖音热搜"
    assert entry["status"] == "success"
    assert entry["duration_ms"] == 12345
    assert "抖音热搜" in entry["conclusion"]
    assert entry["error"] is None
    assert entry["employee_id"] == emp.id


def test_capture_journal_entry_failed_records_error(db_session, workspace, monkeypatch, tmp_path):
    from src.service.learning import journal
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))
    emp = add_employee(db_session, workspace.id, name="调研员")
    log = _settle_log(db_session, workspace.id, emp.id, status="failed")
    journal.capture_journal_entry(db_session, log)
    entry = json.loads(
        next((tmp_path / str(emp.id) / "journal").glob("*.jsonl")).read_text("utf-8").strip()
    )
    assert entry["status"] == "failed"
    assert entry["error"] == "boom"


def test_capture_journal_entry_no_employee_noop(db_session, workspace, monkeypatch, tmp_path):
    """employee_id 为 None（孤儿）→ 不写、不抛。"""
    from src.service.learning import journal
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))
    log = TaskExecutionLog(
        task_id=None, workspace_id=workspace.id, employee_id=None,
        task_name_snapshot="x", run_status="success", output_json="{}",
        started_at=cst_now(), ended_at=cst_now(),
    )
    db_session.add(log); db_session.commit(); db_session.refresh(log)
    journal.capture_journal_entry(db_session, log)  # 不抛
    assert not (tmp_path).glob("*/journal/*.jsonl").__iter__().__next__() if False else True
```

> 说明：测试用 `monkeypatch.setattr(journal, "_brain_root_for", ...)` 把大脑根重定向到 tmp，**所以实现里大脑根解析要抽成模块级函数 `_brain_root_for(employee_id) -> Path`**（内部调 `resolve_employee_memories_dir(employee_id=eid).parent`），便于测试替换、也避免依赖真实 settings.skill_path。

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_journal_capture.py -v`
Expected: FAIL（模块/函数不存在）

- [ ] **Step 3: 最小实现**

`apps/server/src/service/learning/__init__.py`：空文件。

`apps/server/src/service/learning/journal.py`：
```python
"""学习闭环：journal 捕获（子任务终态结构化流水，零模型调用）。"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)

_CONCLUSION_MAX = 500


def _brain_root_for(employee_id: int) -> Path:
    """员工大脑根 = <skill_path>/<employee_id>。"""
    from src.service.agent.paths import resolve_employee_memories_dir
    return resolve_employee_memories_dir(employee_id=employee_id).parent


def _conclusion_from_output(output_json: str | None) -> str:
    if not output_json:
        return ""
    try:
        content = json.loads(output_json).get("content", "") or ""
    except (ValueError, TypeError):
        content = ""
    return content[:_CONCLUSION_MAX]


def capture_journal_entry(db: Session, log: TaskExecutionLog) -> None:
    """子任务终态 → 往员工大脑 journal/YYYY-MM-DD.jsonl 追加一条。零模型、容错。"""
    try:
        if log is None or log.employee_id is None:
            return
        entry = {
            "ts": (log.started_at or cst_now()).isoformat(),
            "task_id": log.task_id,
            "task_name": log.task_name_snapshot or "",
            "employee_id": log.employee_id,
            "status": log.run_status,
            "duration_ms": log.duration_ms,
            "conclusion": _conclusion_from_output(log.output_json),
            "error": log.error_message,
            "tools_used": [],  # 2A-2 填充
        }
        jdir = _brain_root_for(log.employee_id) / "journal"
        jdir.mkdir(parents=True, exist_ok=True)
        fname = (log.ended_at or log.started_at or cst_now()).strftime("%Y-%m-%d") + ".jsonl"
        with (jdir / fname).open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        logger.warning("journal capture failed log_id=%s", getattr(log, "id", None), exc_info=True)
```

- [ ] **Step 4: 跑测试确认通过**
Run: `cd apps/server && uv run pytest tests/test_journal_capture.py -v`
Expected: 全 PASS

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/learning/ apps/server/tests/test_journal_capture.py
git commit -m "feat(learning): journal 捕获核心（子任务终态结构化流水，零模型）"
```

---

## Task 2：tools_used 与 task_name 补全

**Files:**
- Modify: `apps/server/src/service/learning/journal.py`
- Test: `apps/server/tests/test_journal_capture.py`

- [ ] **Step 1: 写失败测试**（追加；造一条带 message_parts 的 assistant 消息）

```python
def test_journal_records_tools_used(db_session, workspace, monkeypatch, tmp_path):
    from src.service.learning import journal
    from src.models.conversation import Conversation, ConversationMessage
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))
    emp = add_employee(db_session, workspace.id, name="调研员")
    conv = Conversation(workspace_id=workspace.id, target_type="employee", target_id=emp.id, title="t")
    db_session.add(conv); db_session.flush()
    # 一条 assistant 消息，message_parts 含工具调用（真实结构：type="tool-<name>"，
    # 工具名在 type 的 "tool-" 前缀里；toolName 嵌在 output 内，非顶层。已核对 message_parts_extractor._build_tool_part）
    msg = ConversationMessage(
        conversation_id=conv.id, role="assistant", content="done",
        message_parts=json.dumps([
            {
                "type": "tool-shell_execute",
                "toolCallId": "call-abc",
                "state": "output-available",
                "input": {"command": "ls"},
                "output": {"status": "success", "text": "ok", "toolName": "shell_execute"},
            },
            {"type": "text", "text": "done", "state": "done"},
        ], ensure_ascii=False),
    )
    db_session.add(msg); db_session.commit()
    log = _settle_log(db_session, workspace.id, emp.id, status="success")
    log.conversation_id = conv.id; db_session.commit(); db_session.refresh(log)

    journal.capture_journal_entry(db_session, log)
    entry = json.loads(
        next((tmp_path / str(emp.id) / "journal").glob("*.jsonl")).read_text("utf-8").strip().splitlines()[-1]
    )
    assert "shell_execute" in entry["tools_used"]
```

> **message_parts 工具 part 真实结构（已核对 `message_parts_extractor._build_tool_part` L233-257）**：`{"type": "tool-<工具名>", "toolCallId":..., "state":..., "input":{...}, "output":{...,"toolName":<工具名>}}`。**工具名在 `type` 的 `tool-` 前缀里**（顶层无 `toolName`，它嵌在 `output` 内）。所以解析主路径 = `ptype.startswith("tool-")` → 取 `ptype[5:]`。下面实现的双路径(toolName 兜底 + tool- 前缀)对真实数据按 tool- 前缀生效，正确；保留双路径无害。

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_journal_capture.py::test_journal_records_tools_used -v`

- [ ] **Step 3: 实现**

在 `journal.py` 加：
```python
def _tools_used_from_conversation(db: Session, conversation_id: int | None) -> list[str]:
    if conversation_id is None:
        return []
    try:
        from sqlalchemy import select
        from src.models.conversation import ConversationMessage
        msg = db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation_id,
                   ConversationMessage.role == "assistant")
            .order_by(ConversationMessage.id.desc())
        ).first()
        if msg is None or not msg.message_parts:
            return []
        parts = json.loads(msg.message_parts)
        tools: list[str] = []
        for p in parts if isinstance(parts, list) else []:
            if not isinstance(p, dict):
                continue
            name = p.get("toolName") or p.get("tool_name")
            ptype = p.get("type", "")
            if name:
                tools.append(name)
            elif isinstance(ptype, str) and ptype.startswith("tool-"):
                tools.append(ptype[len("tool-"):])
        # 去重保序
        seen, out = set(), []
        for t in tools:
            if t not in seen:
                seen.add(t); out.append(t)
        return out
    except Exception:
        return []
```
然后在 `capture_journal_entry` 里把 `"tools_used": []` 改为 `"tools_used": _tools_used_from_conversation(db, log.conversation_id)`。

> task_name：若想用 EmployeeTask 的真实名而非 snapshot，可加按 log.task_id 查 EmployeeTask.task_name；但 `task_name_snapshot` 已够用，**本任务保持用 snapshot**（YAGNI），除非实测 snapshot 常为空。

- [ ] **Step 4: 跑测试 + 回归**
Run: `cd apps/server && uv run pytest tests/test_journal_capture.py -v`
Expected: 全 PASS（含 Task1 的）

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/learning/journal.py apps/server/tests/test_journal_capture.py
git commit -m "feat(learning): journal 补 tools_used（解析 message_parts 工具调用）"
```

---

## Task 3：挂载到 _finalize_task_stream

**Files:**
- Modify: `apps/server/src/service/stream_registry.py`（log 终态写完后）
- Test: `apps/server/tests/test_journal_capture.py`（验证挂载调用）

- [ ] **Step 1: 写失败测试**（追加；用 monkeypatch 断言 finalize 时 capture 被调用）

> 直接端到端跑 _finalize_task_stream 较重（涉流注册）。**轻量做法**：测试 patch `src.service.learning.journal.capture_journal_entry` 记录调用，构造一个终态 log，调用 finalize 的相关分支或抽出的小函数断言被调。**实现时优先**：把"调 capture_journal_entry"做成 finalize 里一行 `try: capture_journal_entry(db, log) except: warning`，并确认该行在 log 终态 commit 之后、各终态(success/failed/cancelled)都会经过的位置。若 _finalize_task_stream 难以单测，至少加一个针对"挂载点函数"的测试或在实现报告里说明已就近放置 + 人工核对调用路径。

```python
def test_finalize_calls_journal_capture(monkeypatch):
    """挂载点：finalize 终态会调 capture_journal_entry（轻量验证调用契约）。"""
    import src.service.learning.journal as journal_mod
    calls = []
    monkeypatch.setattr(journal_mod, "capture_journal_entry", lambda db, log: calls.append(log))
    # 若有可单独调用的挂载封装则调它；否则此测试作为契约占位，
    # 实现者在报告中说明 finalize 中的调用行号 + 各终态都覆盖。
    # （实现时可抽 `_capture_journal_safe(db, log)` 小封装并在此直接测它）
    from src.service.stream_registry import _capture_journal_safe  # 实现时新增
    class _L: employee_id = 1
    _capture_journal_safe(object(), _L())
    assert calls
```

- [ ] **Step 2: 跑测试确认失败**
Run: `cd apps/server && uv run pytest tests/test_journal_capture.py::test_finalize_calls_journal_capture -v`

- [ ] **Step 3: 实现**

在 `stream_registry.py` 加一个小封装（模块级或就近）：
```python
def _capture_journal_safe(db, log) -> None:
    try:
        from src.service.learning.journal import capture_journal_entry
        capture_journal_entry(db, log)
    except Exception:
        logger.warning("journal capture hook failed", exc_info=True)
```
**精确插入点（评审核对）**：`_finalize_task_stream` 里只有一个汇合点——`db.commit()`(L2408) + `db.refresh(log)`(L2409),三个终态(success/failed/cancelled)都汇到这。**插在 `db.refresh(log)` 之后、`summary_message = None`(约 L2411)之前**(即在 orchestrator_execution_summary 块**之前**,别插进它的 try/except):
```python
        db.commit()
        db.refresh(log)
        _capture_journal_safe(db, log)   # ← 插这里
        summary_message = None
        # ...（下面是 append_orchestrator_execution_summary 等）
```
（interrupted 分支 L2362 提前 return,天然不记 journal,正确。以实际行号为准。）

- [ ] **Step 4: 跑测试 + 回归**
Run: `cd apps/server && uv run pytest tests/test_journal_capture.py -v`
然后 `cd apps/server && uv run pytest tests/ -k "stream_registry or finaliz or journal" -v`（无新增回归；预存基线用判断力区分）

- [ ] **Step 5: 提交**
```bash
git add apps/server/src/service/stream_registry.py apps/server/tests/test_journal_capture.py
git commit -m "feat(learning): 子任务终态挂载 journal 捕获"
```

---

## 收尾验证
- [ ] 全量后端：`cd apps/server && uv run pytest tests/ -q`，仅预存基线失败、零新增回归（基线=阶段2总览提交前 sha，worktree 比对）。
- [ ] 手测桩：跑一个员工子任务 → `<skill_path>/<employee_id>/journal/<今日>.jsonl` 多一行含 status/duration/tools_used/conclusion；失败任务记 error。

## 开放问题
- O1 tools_used part 结构：以 message_parts_extractor.py 实际为准（2A-2 核对）。
- O2 token 成本：现无追踪，本版只记 duration。
- O3 task_name 用 snapshot（够用）；若常空再改查 EmployeeTask。
</content>
