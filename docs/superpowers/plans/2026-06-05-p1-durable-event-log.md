# P1：单聊持久化事件账本（Durable Event Log）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单聊引入一张会话级、单调编号、持久化的 `event_log` 事件表，并新增由它支撑的 snapshot 端点与可恢复订流端点；老的流式/恢复链路全程并存不动。这是事件溯源地基的第一块，独立可测、可回退。

**Architecture:** 在现有 `StreamEventBuffer`（内存 deque，per-turn seq）旁，于落库点（checkpoint/terminal flush）把事件以**会话级单调 seq** 追加进 `event_log` 表。新增两个**只读**端点：`GET .../session/snapshot`（从 event_log + 现有 `message_parts` 提取器重建画面）与 `GET .../session/stream?from=seq`（先从 event_log 回放历史、再订阅活动任务实时尾巴），实现"服务器重启不丢已落库历史"。不改动 `POST .../stream`、`/stream/resume`、`/messages` 等旧端点（迁移期并存）。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy（无 Alembic，建表走 `Base.metadata.create_all` + `init_db.ensure_*`）/ SQLite / pytest。

**关键设计约束（来自 spec §3.1.1 / §3.3）：**
- `event_log.seq` 在**同一 conversation 内严格 +1 连续**，跨 turn 不重置（区别于 `StreamEventBuffer._seq` 的 per-turn 计数）。
- 未识别事件类型仍占 seq；心跳用 SSE 注释行 `:keepalive`，不占 seq、不入表。
- snapshot 携带其覆盖到的最高 seq；其后增量从 seq+1 严格续接。
- 规范化事件 payload 形状见 spec §3.3（`docs/superpowers/specs/2026-06-05-session-architecture-design.md`）。

**参考文件（实现时对照，勿凭记忆）：**
- 事件缓冲与落库点：`apps/server/src/service/stream_registry.py`（`StreamEventBuffer` :535-556、`_checkpoint_flush_sync` :425、`_flush_terminal_sync` :466、`_flush_to_db_sync`）
- 现有恢复链路（订流尾巴的范本）：`apps/server/src/service/chat_service.py:847-1006`（`resume_conversation_stream`）
- 服务端 parts 提取（复用，勿重写）：`apps/server/src/service/message_parts_extractor.py`（`extract_message_parts` / `extract_message_parts_from_buffer` / `_replay_payloads_to_parts`）
- ORM 范本：`apps/server/src/models/conversation.py`
- 建表/升列范本：`apps/server/src/db/init_db.py`
- 端点注册范本：`apps/server/src/api/chat_api.py`（:219 messages、:295 stream、:318 resume）

> **测试运行约定：** 所有 `pytest` 命令在 `apps/server` 目录下执行，前缀 `uv run`。示例：`uv run pytest tests/test_event_log_model.py -v`。

---

## 文件结构（先锁定边界）

**新建：**
- `apps/server/src/models/event_log.py` — `EventLog` ORM 模型（一张表，一个职责：持久化事件行）
- `apps/server/src/service/session/__init__.py` — 新会话子包
- `apps/server/src/service/session/event_seq.py` — 会话级单调 seq 分配（纯逻辑 + DB 取号）
- `apps/server/src/service/session/event_log_repo.py` — event_log 读写仓库（append / get_after / get_max_seq）
- `apps/server/src/service/session/session_events.py` — 规范化事件类型常量 + 由原始 buffer payload 生成规范化事件的纯函数
- `apps/server/src/service/session/snapshot.py` — 由 event_log 重建 snapshot（复用 message_parts 提取器）
- `apps/server/src/api/session_api.py` — 两个新只读端点（snapshot / stream）
- `apps/server/tests/conftest.py` — 引入内存 SQLite 测试 DB fixture（若已存在则追加 fixture）
- `apps/server/tests/test_event_log_model.py`
- `apps/server/tests/test_event_seq.py`
- `apps/server/tests/test_event_log_repo.py`
- `apps/server/tests/test_session_events.py`
- `apps/server/tests/test_session_snapshot.py`
- `apps/server/tests/test_session_stream_endpoint.py`

**修改：**
- `apps/server/src/db/init_db.py` — 确保 `event_log` 表建立（模型 import 已由 `from src import models` 覆盖，仅需确认 `models/__init__.py` 导出）
- `apps/server/src/models/__init__.py` — 导出 `EventLog`
- `apps/server/src/service/stream_registry.py` — 在流式主循环的 checkpoint / terminal 调用点（`task` 在作用域内，读 `task.buffer._events`）把新事件 dual-write 进 event_log（flag 控制）；**不写在 `_flush_to_db_sync` 内**（它拿不到 conversation_id/buffer 事件）
- `apps/server/src/api/__init__.py` — 注册 `session_api.router`
- `apps/server/src/core/`（或现有配置处）— 新增 feature flag `SESSION_EVENT_LOG_ENABLED`（默认 True；可环境变量关）

---

## Task 1: EventLog ORM 模型与建表

**Files:**
- Create: `apps/server/src/models/event_log.py`
- Modify: `apps/server/src/models/__init__.py`
- Test: `apps/server/tests/test_event_log_model.py`
- Test fixture: `apps/server/tests/conftest.py`

- [ ] **Step 1: 写测试 DB fixture（conftest）**

若 `apps/server/tests/conftest.py` 不存在则创建；存在则追加 `db_session` fixture。

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.db.base import Base
import src.models  # noqa: F401  确保所有表注册到 Base.metadata


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
```

- [ ] **Step 2: 写失败测试**

```python
# apps/server/tests/test_event_log_model.py
from datetime import datetime

from src.models.event_log import EventLog


def test_event_log_row_roundtrip(db_session):
    row = EventLog(
        conversation_id=42,
        seq=1,
        scope="conversation:42",
        source="assistant",
        type="text.delta",
        payload='{"text": "hi"}',
    )
    db_session.add(row)
    db_session.commit()

    fetched = db_session.query(EventLog).filter_by(conversation_id=42).one()
    assert fetched.seq == 1
    assert fetched.type == "text.delta"
    assert fetched.scope == "conversation:42"
    assert isinstance(fetched.created_at, datetime)
```

- [ ] **Step 3: 运行测试确认失败**

Run: `uv run pytest tests/test_event_log_model.py -v`
Expected: FAIL（`ModuleNotFoundError: src.models.event_log`）

- [ ] **Step 4: 写模型**

```python
# apps/server/src/models/event_log.py
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.db.base import Base
from src.models.workspace import cst_now


class EventLog(Base):
    """会话/房间事件账本：每行一个带会话级单调 seq 的事件。

    seq 在同一 conversation_id 内严格 +1 连续（见 spec §3.1.1），
    区别于 StreamEventBuffer 的 per-turn 计数。
    """

    __tablename__ = "event_log"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_event_log_conv_seq"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    scope: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=cst_now, index=True
    )
```

在 `apps/server/src/models/__init__.py` 追加导出（参照该文件现有写法）：

```python
from src.models.event_log import EventLog  # noqa: F401
```

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/test_event_log_model.py -v`
Expected: PASS

- [ ] **Step 6: 确认 init_db 会建表**

`init_db.py:13` 的 `Base.metadata.create_all` 会自动建新表（模型已 import）。无需改 init_db。无需 ensure_column（新表整建）。

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/models/event_log.py apps/server/src/models/__init__.py apps/server/tests/conftest.py apps/server/tests/test_event_log_model.py
git commit -m "feat(session): add EventLog model for durable event ledger"
```

---

## Task 2: 会话级单调 seq 分配

**Files:**
- Create: `apps/server/src/service/session/__init__.py`（空文件）
- Create: `apps/server/src/service/session/event_seq.py`
- Test: `apps/server/tests/test_event_seq.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_event_seq.py
from src.models.event_log import EventLog
from src.service.session.event_seq import next_seq


def test_next_seq_starts_at_one_for_empty_conversation(db_session):
    assert next_seq(db_session, conversation_id=7) == 1


def test_next_seq_is_strictly_incrementing(db_session):
    db_session.add(EventLog(conversation_id=7, seq=1, scope="conversation:7",
                            source="user", type="message.appended", payload="{}"))
    db_session.add(EventLog(conversation_id=7, seq=2, scope="conversation:7",
                            source="assistant", type="turn.started", payload="{}"))
    db_session.commit()
    assert next_seq(db_session, conversation_id=7) == 3


def test_next_seq_is_isolated_per_conversation(db_session):
    db_session.add(EventLog(conversation_id=7, seq=5, scope="conversation:7",
                            source="user", type="message.appended", payload="{}"))
    db_session.commit()
    assert next_seq(db_session, conversation_id=99) == 1
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_event_seq.py -v`
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: 实现**

```python
# apps/server/src/service/session/event_seq.py
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.event_log import EventLog


def next_seq(db: Session, conversation_id: int) -> int:
    """返回该会话下一个事件 seq（当前最大 +1，空账从 1 起）。

    注意：调用方须在单一写入串行点内使用（见 event_log_repo.append），
    UniqueConstraint(conversation_id, seq) 兜底并发冲突。
    """
    current_max = db.scalar(
        select(func.max(EventLog.seq)).where(EventLog.conversation_id == conversation_id)
    )
    return (current_max or 0) + 1
```

- [ ] **Step 4: 运行确认通过**

Run: `uv run pytest tests/test_event_seq.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/session/__init__.py apps/server/src/service/session/event_seq.py apps/server/tests/test_event_seq.py
git commit -m "feat(session): conversation-scoped monotonic event seq"
```

---

## Task 3: EventLog 读写仓库

**Files:**
- Create: `apps/server/src/service/session/event_log_repo.py`
- Test: `apps/server/tests/test_event_log_repo.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_event_log_repo.py
from src.service.session.event_log_repo import append_event, get_events_after, get_max_seq


def test_append_assigns_contiguous_seq(db_session):
    e1 = append_event(db_session, conversation_id=1, source="user",
                      type="message.appended", payload={"text": "hi"})
    e2 = append_event(db_session, conversation_id=1, source="assistant",
                      type="turn.started", payload={"message_id": "m1"})
    assert (e1.seq, e2.seq) == (1, 2)
    assert e1.scope == "conversation:1"


def test_get_events_after_returns_only_newer(db_session):
    for i in range(5):
        append_event(db_session, conversation_id=1, source="assistant",
                     type="text.delta", payload={"text": str(i)})
    rows = get_events_after(db_session, conversation_id=1, after_seq=3)
    assert [r.seq for r in rows] == [4, 5]


def test_get_events_after_none_returns_all(db_session):
    append_event(db_session, conversation_id=1, source="user",
                 type="message.appended", payload={})
    rows = get_events_after(db_session, conversation_id=1, after_seq=None)
    assert [r.seq for r in rows] == [1]


def test_get_max_seq(db_session):
    assert get_max_seq(db_session, conversation_id=1) == 0
    append_event(db_session, conversation_id=1, source="user",
                 type="message.appended", payload={})
    assert get_max_seq(db_session, conversation_id=1) == 1


def test_append_events_batch_is_contiguous(db_session):
    from src.service.session.event_log_repo import append_events
    rows = append_events(db_session, conversation_id=1, events=[
        {"source": "assistant", "type": "turn.started", "payload": {"message_id": "a1"}},
        {"source": "assistant", "type": "text.delta", "payload": {"message_id": "a1", "text": "hi"}},
        {"source": "assistant", "type": "turn.completed", "payload": {"message_id": "a1"}},
    ])
    assert [r.seq for r in rows] == [1, 2, 3]
    # 续接已有最大 seq
    more = append_events(db_session, conversation_id=1, events=[
        {"source": "assistant", "type": "text.delta", "payload": {"message_id": "a2", "text": "x"}},
    ])
    assert [r.seq for r in more] == [4]
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_event_log_repo.py -v`
Expected: FAIL

- [ ] **Step 3: 实现**

```python
# apps/server/src/service/session/event_log_repo.py
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.event_log import EventLog
from src.service.session.event_seq import next_seq


def append_event(
    db: Session,
    conversation_id: int,
    source: str,
    type: str,
    payload: dict[str, Any] | None,
    scope: str | None = None,
    commit: bool = True,
) -> EventLog:
    """追加一条事件，自动分配会话级 seq。scope 默认 conversation:<id>。"""
    row = EventLog(
        conversation_id=conversation_id,
        seq=next_seq(db, conversation_id),
        scope=scope or f"conversation:{conversation_id}",
        source=source,
        type=type,
        payload=json.dumps(payload, ensure_ascii=False, default=str)
        if payload is not None
        else None,
    )
    db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    else:
        db.flush()
    return row


def get_events_after(
    db: Session, conversation_id: int, after_seq: int | None
) -> list[EventLog]:
    stmt = select(EventLog).where(EventLog.conversation_id == conversation_id)
    if after_seq is not None:
        stmt = stmt.where(EventLog.seq > after_seq)
    stmt = stmt.order_by(EventLog.seq.asc())
    return list(db.scalars(stmt).all())


def get_max_seq(db: Session, conversation_id: int) -> int:
    current = db.scalar(
        select(func.max(EventLog.seq)).where(EventLog.conversation_id == conversation_id)
    )
    return current or 0


def append_events(
    db: Session,
    conversation_id: int,
    events: list[dict[str, Any]],
    scope: str | None = None,
    commit: bool = True,
) -> list[EventLog]:
    """批量追加：基准 seq 只查一次 MAX，内存里 +1 递推，避免逐事件 SELECT MAX。

    events: [{"source": str, "type": str, "payload": dict|None}, ...]（已是规范化事件）。
    用于流式 flush 一次落多条（性能关键路径）。
    """
    if not events:
        return []
    base = get_max_seq(db, conversation_id)
    scope_val = scope or f"conversation:{conversation_id}"
    rows: list[EventLog] = []
    for i, ev in enumerate(events, start=1):
        payload = ev.get("payload")
        rows.append(EventLog(
            conversation_id=conversation_id,
            seq=base + i,
            scope=scope_val,
            source=ev["source"],
            type=ev["type"],
            payload=json.dumps(payload, ensure_ascii=False, default=str)
            if payload is not None else None,
        ))
    db.add_all(rows)
    if commit:
        db.commit()
        for r in rows:
            db.refresh(r)
    else:
        db.flush()
    return rows
```

- [ ] **Step 4: 运行确认通过**

Run: `uv run pytest tests/test_event_log_repo.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/session/event_log_repo.py apps/server/tests/test_event_log_repo.py
git commit -m "feat(session): event log repository (append/get_after/max_seq)"
```

---

## Task 4: 规范化事件映射（原始 buffer payload → §3.3 事件）

**Files:**
- Create: `apps/server/src/service/session/session_events.py`
- Test: `apps/server/tests/test_session_events.py`

> 目标：把现有 `StreamEventBuffer` 里的原始 payload（LangGraph messages 元组 / 状态事件）翻译成 spec §3.3 的规范化事件列表。**复用** `message_parts_extractor` 的判定思路（勿重写 parts 提取）。本任务先覆盖最关键的 4 类：`turn.started`、`text.delta`、`turn.completed/failed/cancelled`、`hitl.requested`。`tool.invoked`/`tool.result` 在 P1 可先作为 `text.delta` 的兄弟事件占位（payload 透传），完整工具映射留待 P4 前补全——**在文件顶部 docstring 写明此范围限制（no silent caps）**。

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_session_events.py
from src.service.session.session_events import normalize_buffer_event


def test_terminal_completed_maps_to_turn_completed():
    out = normalize_buffer_event(
        {"status": "completed"}, message_id="m1", member_id=None
    )
    assert [e["type"] for e in out] == ["turn.completed"]
    assert out[0]["payload"]["message_id"] == "m1"


def test_terminal_error_maps_to_turn_failed_with_reason():
    out = normalize_buffer_event(
        {"status": "error", "error": "boom"}, message_id="m1", member_id=None
    )
    assert out[0]["type"] == "turn.failed"
    assert out[0]["payload"]["reason"] == "boom"


def test_interrupted_maps_to_hitl_requested():
    payload = {
        "status": "interrupted",
        "action_requests": [{"tool_call_id": "tc1"}],
    }
    out = normalize_buffer_event(payload, message_id="m1", member_id=None)
    assert out[0]["type"] == "hitl.requested"
    assert out[0]["payload"]["tool_call_id"] == "tc1"
    assert out[0]["payload"]["message_id"] == "m1"


def test_unknown_payload_returns_empty_list():
    assert normalize_buffer_event({"foo": "bar"}, message_id="m1", member_id=None) == []
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_session_events.py -v`
Expected: FAIL

- [ ] **Step 3: 实现**

```python
# apps/server/src/service/session/session_events.py
"""原始 StreamEventBuffer payload → spec §3.3 规范化事件。

范围限制（P1）：本模块当前覆盖 turn.started / text.delta /
turn.completed|failed|cancelled / hitl.requested 四类终态与文本增量。
tool.invoked / tool.result 的细粒度映射留待 P4 前补全；在此之前工具相关
原始 payload 由调用方作为透传 text.delta 兄弟事件处理。parts 的最终结构
仍由 message_parts_extractor 在 snapshot 端负责，本模块不重复其逻辑。
"""
from __future__ import annotations

from typing import Any

TURN_STARTED = "turn.started"
TEXT_DELTA = "text.delta"
TURN_COMPLETED = "turn.completed"
TURN_FAILED = "turn.failed"
TURN_CANCELLED = "turn.cancelled"
HITL_REQUESTED = "hitl.requested"

_TERMINAL_MAP = {
    "completed": TURN_COMPLETED,
    "cancelled": TURN_CANCELLED,
    "error": TURN_FAILED,
}


def normalize_buffer_event(
    data: dict[str, Any], message_id: str, member_id: int | None
) -> list[dict[str, Any]]:
    """把单个原始 buffer payload 翻译成 0..N 个规范化事件 dict。

    返回 [] 表示"无需入账的事件"（未知/噪声），调用方据此跳过，
    但仍由 event_log 的连续 seq 体系保证不制造空洞（未入账即不占号）。
    """
    if not isinstance(data, dict):
        return []

    status = data.get("status")
    if status == "interrupted":
        action_requests = data.get("action_requests") or []
        first = action_requests[0] if action_requests else {}
        return [{
            "type": HITL_REQUESTED,
            "source": "assistant",
            "payload": {
                "message_id": message_id,
                "tool_call_id": first.get("tool_call_id"),
                "preview": data,
            },
        }]
    if status in _TERMINAL_MAP:
        payload: dict[str, Any] = {"message_id": message_id}
        if status == "error":
            payload["reason"] = data.get("error")
        return [{
            "type": _TERMINAL_MAP[status],
            "source": "assistant",
            "payload": payload,
        }]

    # 文本增量：复用 chat_service._extract_text_from_chunk 的判定（在调用点传入已抽取文本）
    text = data.get("__text_delta__")
    if isinstance(text, str) and text:
        ev = {
            "type": TEXT_DELTA,
            "source": "assistant",
            "payload": {"message_id": message_id, "text": text},
        }
        if member_id is not None:
            ev["payload"]["member_id"] = member_id
        return [ev]

    return []
```

> 说明：`__text_delta__` 是调用点（Task 5）预抽取文本后塞入的约定键，避免本模块依赖 LangGraph 元组细节。`turn.started` 事件不在此函数产生——它在新建 assistant 占位消息时由 Task 5 显式 append 一次。

- [ ] **Step 4: 运行确认通过**

Run: `uv run pytest tests/test_session_events.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/session/session_events.py apps/server/tests/test_session_events.py
git commit -m "feat(session): normalize raw buffer events to §3.3 event shape"
```

---

## Task 5: 在落库点 dual-write 事件到 event_log（flag 控制）

**Files:**
- Modify: `apps/server/src/service/stream_registry.py`（流式主循环的 checkpoint / terminal 调用点，**非 `_flush_to_db_sync` 内部**）
- Modify: 配置处新增 flag `SESSION_EVENT_LOG_ENABLED`
- Test: `apps/server/tests/test_event_log_dualwrite.py`（新建）

> 策略：不在 `StreamEventBuffer.add`（每事件热路径）写库，而是在已有的 **flush 时机**把"自上次已持久化 buffer seq 之后的新事件"批量翻译并 append 到 event_log。**关键：从活动 task 的 `task.buffer._events` 直接取快照**（`_checkpoint_flush_sync` 的入参 `buffer_events_snapshot` 已被刻意丢弃为 `[]`，不可用），按每条消息维护"已持久 buffer seq"游标增量写。turn.started 在新建 assistant 占位消息处 append 一次。

- [ ] **Step 1: 读真实落库时机与调用点，确认能拿到的上下文**

Read: `apps/server/src/service/stream_registry.py`：
- `_flush_to_db_sync` 真实签名（约 :170-179）：`(stream_msg_id, buffer_cursor, state, content, error_message, message_parts, usage_metadata, elapsed_ms)` —— **没有 conversation_id、没有 buffer 事件**，故**不在此函数内写 event_log**。
- `_flush_terminal_sync`（:466-532）：**有** `conversation_id` 与 `buffer_events_snapshot`（终态全量 buffer）。
- 流式主循环里 checkpoint / terminal 的**调用点**（checkpoint 调用约 :1611-1617，终态调用在其附近）：此处 `task` 在作用域内，可直接读 `task.buffer._events` 取实时快照、可读 `task.conversation_id`。

结论：dual-write 放在**流式主循环的 checkpoint 调用点与 terminal 调用点**，读 `task.buffer._events`（非被丢弃的入参）。assistant 占位消息创建处见 `chat_service.stream_conversation_answer`（约 :620-845）。

- [ ] **Step 2: 写失败测试（用假 buffer 驱动）**

```python
# apps/server/tests/test_event_log_dualwrite.py
from src.service.session.event_log_repo import get_events_after
from src.service.session.dualwrite import persist_buffer_events


def test_persist_translates_and_appends(db_session):
    buffer_events = [
        {"seq": 1, "data": {"__text_delta__": "hello"}},
        {"seq": 2, "data": {"status": "completed"}},
    ]
    persist_buffer_events(
        db_session, conversation_id=1, message_id="m1",
        member_id=None, buffer_events=buffer_events, after_buffer_seq=0,
    )
    rows = get_events_after(db_session, conversation_id=1, after_seq=None)
    assert [r.type for r in rows] == ["text.delta", "turn.completed"]
    assert [r.seq for r in rows] == [1, 2]  # 会话级 seq 连续


def test_persist_skips_already_persisted_buffer_seq(db_session):
    buffer_events = [
        {"seq": 1, "data": {"__text_delta__": "a"}},
        {"seq": 2, "data": {"__text_delta__": "b"}},
    ]
    persist_buffer_events(db_session, conversation_id=1, message_id="m1",
                          member_id=None, buffer_events=buffer_events, after_buffer_seq=1)
    rows = get_events_after(db_session, conversation_id=1, after_seq=None)
    assert [r.payload for r in rows] == ['{"message_id": "m1", "text": "b"}']


def test_persist_coalesces_consecutive_text_deltas(db_session):
    # 性能：一次 flush 内同一消息的连续 text.delta 合并成一行（行数与写入量大降）
    buffer_events = [
        {"seq": 1, "data": {"__text_delta__": "Hel"}},
        {"seq": 2, "data": {"__text_delta__": "lo "}},
        {"seq": 3, "data": {"__text_delta__": "world"}},
        {"seq": 4, "data": {"status": "completed"}},
    ]
    persist_buffer_events(db_session, conversation_id=1, message_id="m1",
                          member_id=None, buffer_events=buffer_events, after_buffer_seq=0)
    rows = get_events_after(db_session, conversation_id=1, after_seq=None)
    assert [r.type for r in rows] == ["text.delta", "turn.completed"]   # 3 个 delta → 1 行
    import json as _json
    assert _json.loads(rows[0].payload)["text"] == "Hello world"
    assert [r.seq for r in rows] == [1, 2]   # 会话级 seq 仍连续
```

- [ ] **Step 3: 运行确认失败**

Run: `uv run pytest tests/test_event_log_dualwrite.py -v`
Expected: FAIL

- [ ] **Step 4: 实现 dualwrite 辅助**

```python
# apps/server/src/service/session/dualwrite.py
from __future__ import annotations

from sqlalchemy.orm import Session

from src.service.session.event_log_repo import append_events
from src.service.session.session_events import TEXT_DELTA, normalize_buffer_event


def _coalesce(events: list[dict]) -> list[dict]:
    """把相邻、同一 message_id 的 text.delta 合并成一条（拼接 text）。

    durable 历史/续传不需要逐字粒度（逐字直播 P1 仍走旧路径），合并后行数
    从"每 token 一行"降到"每 flush 一段"，写入量与存储大幅下降。
    """
    out: list[dict] = []
    for ev in events:
        if (
            ev["type"] == TEXT_DELTA
            and out
            and out[-1]["type"] == TEXT_DELTA
            and out[-1]["payload"].get("message_id") == ev["payload"].get("message_id")
        ):
            out[-1]["payload"]["text"] += ev["payload"].get("text", "")
        else:
            # 深拷一层 payload，避免就地累加污染调用方
            out.append({**ev, "payload": dict(ev["payload"])})
    return out


def persist_buffer_events(
    db: Session,
    conversation_id: int,
    message_id: str,
    member_id: int | None,
    buffer_events: list[dict],
    after_buffer_seq: int,
    commit: bool = True,
) -> int:
    """把 buffer 中 buffer_seq > after_buffer_seq 的事件翻译、合并并批量追加进 event_log。

    返回本次处理到的最大 buffer_seq（调用方记下，下次 flush 作为 after）。
    性能：相邻 text.delta 先合并，再用 append_events 批量落库（基准 seq 只查一次）。
    """
    processed = after_buffer_seq
    normalized: list[dict] = []
    for ev in buffer_events:
        bseq = ev.get("seq", 0)
        if bseq <= after_buffer_seq:
            continue
        normalized.extend(
            normalize_buffer_event(ev.get("data") or {}, message_id, member_id)
        )
        processed = max(processed, bseq)
    coalesced = _coalesce(normalized)
    if coalesced:
        append_events(db, conversation_id=conversation_id, events=coalesced, commit=commit)
    elif commit:
        db.commit()
    return processed
```

- [ ] **Step 5: 运行确认通过**

Run: `uv run pytest tests/test_event_log_dualwrite.py -v`
Expected: PASS

- [ ] **Step 6: 在流式主循环的 checkpoint / terminal 调用点接入（flag 包裹）**

在 checkpoint 调用点与 terminal 调用点（`task` 在作用域内）加入下面的辅助调用。**用 `sqlite_db_session()` 上下文管理器开 session**（它持有 `SQLITE_ACCESS_LOCK`，NullPool 单文件 SQLite 必须串行化写；裸 `get_session_local()()` 会触发 `database is locked`）：

```python
from src.core.config import get_settings  # flag 加到现有 Settings

def _maybe_persist_event_log(task, stream_msg_id: int) -> None:
    if not get_settings().session_event_log_enabled:
        return
    try:
        from src.db.session import sqlite_db_session
        from src.service.session.dualwrite import persist_buffer_events
        snapshot = list(task.buffer._events)  # 实时快照，非被丢弃的入参
        with sqlite_db_session() as _db:  # 复用既有串行锁，避免 database is locked
            new_after = persist_buffer_events(
                _db,
                conversation_id=task.conversation_id,
                message_id=str(stream_msg_id),
                member_id=None,
                buffer_events=snapshot,
                after_buffer_seq=_LAST_PERSISTED_BUF_SEQ.get(stream_msg_id, 0),
            )
        _LAST_PERSISTED_BUF_SEQ[stream_msg_id] = new_after
    except Exception:
        logger.warning("[event_log] dualwrite failed msg_id=%s", stream_msg_id, exc_info=True)
```

在 checkpoint 调用点后、以及 terminal 调用点后各调用 `_maybe_persist_event_log(task, stream_msg_id)`。

> - `_LAST_PERSISTED_BUF_SEQ`：在 stream_registry 顶部定义模块级 `dict[int, int]`（stream_msg_id → 已持久 buffer seq）。flush 串行，无需锁。进程重启即重置——见"已知遗留"对崩溃语义的诚实说明。
> - **flag 定义**：`apps/server/src/core/config.py` 的 `Settings` 是 `@dataclass(slots=True)`，由 `get_settings()` 从 SQLite `config_kvs` 表逐字段显式构造（**非 pydantic，不自动读 env**）。因此需两步：① 给 `Settings` 加字段 `session_event_log_enabled: bool = True`；② 在 `get_settings()` 的构造调用里加 `session_event_log_enabled=_get_kv_bool(kv_data, "SESSION_EVENT_LOG_ENABLED", default=True)`（参照该函数现有 `_get_kv_bool` 用法）。只加字段不改 `get_settings()` 会导致恒为 True、永不可关。不要新建 settings.py。
> - **turn.started**：在 `chat_service` 新建空 assistant 占位消息后，flag 包裹地 `append_event(db, conversation_id, source="assistant", type="turn.started", payload={"message_id": str(msg_id), "role": "assistant"})`（复用该处已有的 `sqlite_db_session`/db）。

- [ ] **Step 7: 运行全量后端测试确认无回归**

Run: `uv run pytest tests/ -q`
Expected: PASS（含既有测试）

- [ ] **Step 8: 提交**

```bash
git add apps/server/src/service/session/dualwrite.py apps/server/src/service/stream_registry.py apps/server/src/core/config.py apps/server/src/service/chat_service.py apps/server/tests/test_event_log_dualwrite.py
git commit -m "feat(session): dual-write normalized events to event_log at flush points"
```

---

## Task 6: Snapshot 端点

**Files:**
- Create: `apps/server/src/service/session/snapshot.py`
- Create: `apps/server/src/api/session_api.py`
- Modify: `apps/server/src/api/__init__.py`
- Test: `apps/server/tests/test_session_snapshot.py`

- [ ] **Step 1: 写失败测试**

```python
# apps/server/tests/test_session_snapshot.py
import json

from src.models.conversation import ConversationMessage
from src.service.session.event_log_repo import append_event
from src.service.session.snapshot import build_snapshot


def _add_msg(db, conv_id, role, parts, state="completed"):
    db.add(ConversationMessage(
        conversation_id=conv_id, role=role,
        message_parts=json.dumps(parts, ensure_ascii=False),
        stream_state=state,
    ))
    db.commit()


def test_snapshot_uses_precomputed_message_parts_and_reports_seq(db_session):
    # messages 来自已算好的 message_parts（O(读消息)，非 O(全事件回放)）
    _add_msg(db_session, 1, "user", [{"type": "text", "text": "hi"}])
    _add_msg(db_session, 1, "assistant", [{"type": "text", "text": "你好"}])
    # event_log 只用于给出 snapshot_seq（续传基准）
    append_event(db_session, 1, "assistant", "turn.started", {"message_id": "a1"})
    append_event(db_session, 1, "assistant", "text.delta", {"message_id": "a1", "text": "你好"})
    append_event(db_session, 1, "assistant", "turn.completed", {"message_id": "a1"})

    snap = build_snapshot(db_session, conversation_id=1)
    assert snap["scope"] == "conversation:1"
    assert snap["snapshot_seq"] == 3                       # = event_log 最大 seq
    assert [m["role"] for m in snap["messages"]] == ["user", "assistant"]
    assert snap["messages"][1]["parts"] == [{"type": "text", "text": "你好"}]


def test_snapshot_empty_conversation(db_session):
    snap = build_snapshot(db_session, conversation_id=999)
    assert snap["snapshot_seq"] == 0
    assert snap["messages"] == []
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_session_snapshot.py -v`
Expected: FAIL

- [ ] **Step 3: 实现 snapshot 构建**

```python
# apps/server/src/service/session/snapshot.py
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.conversation import ConversationMessage
from src.service.session.event_log_repo import get_max_seq


def build_snapshot(db: Session, conversation_id: int) -> dict:
    """会话画面快照 + 其覆盖到的最高 seq（spec §5.3）。

    性能：messages 直接读已预算好的 message_parts（O(消息数)），
    **不做 O(全部事件) 的回放** —— 与现有 /messages 同源、同样廉价。
    event_log 仅用于给出 snapshot_seq（前端据此 from=seq 续传增量）。
    """
    rows = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.id.asc())
    ).all()
    messages = [{
        "message_id": str(m.id),
        "role": m.role,
        "parts": json.loads(m.message_parts) if m.message_parts else [],
        "stream_state": m.stream_state,
        "sender_id": m.sender_id,
        "sender_label": m.sender_label,
    } for m in rows]
    return {
        "scope": f"conversation:{conversation_id}",
        "snapshot_seq": get_max_seq(db, conversation_id),
        "messages": messages,
    }
```

> 说明：snapshot 复用 `message_parts`（终态已算好、与 `/messages` 同源），是廉价的 DB 读，不重放事件。若某轮正在进行（尚未终态落库），其增量只在 event_log 里、`message_parts` 暂未含——P1 的 snapshot/stream 尚未驱动实时 UI（实时仍走旧路径），该"进行中尾巴"的并入留待 P2 接 reducer 时处理。见"已知遗留"。

- [ ] **Step 4: 实现端点**

```python
# apps/server/src/api/session_api.py
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.db.session import get_db  # 参照 chat_api.py 的 db 依赖名
from src.service.session.snapshot import build_snapshot

router = APIRouter(tags=["session"])


@router.get("/chat/conversations/{conversation_id}/session/snapshot")
def get_session_snapshot(conversation_id: int, db: Session = Depends(get_db)) -> dict:
    return build_snapshot(db, conversation_id)
```

> 实现前对照 `chat_api.py` 顶部确认 db 依赖的真实导入名（可能是 `get_db` / `get_session`）。

在 `apps/server/src/api/__init__.py` 注册（参照现有 include_router 写法）：

```python
from src.api.session_api import router as session_router
api_router.include_router(session_router)
```

- [ ] **Step 5: 运行确认通过**

Run: `uv run pytest tests/test_session_snapshot.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/session/snapshot.py apps/server/src/api/session_api.py apps/server/src/api/__init__.py apps/server/tests/test_session_snapshot.py
git commit -m "feat(session): snapshot endpoint backed by event_log"
```

---

## Task 7: 可恢复订流端点（history from event_log + live tail）

**Files:**
- Modify: `apps/server/src/api/session_api.py`
- Create: `apps/server/src/service/session/stream.py`
- Test: `apps/server/tests/test_session_stream_endpoint.py`

> 端点 `GET /chat/conversations/{id}/session/stream?from=<seq>`（**P1 范围 = 持久历史回放**）：
> 1. 从 event_log 回放 `seq > from` 的历史事件，每条 SSE `id: <seq>`；
> 2. 支持 `Last-Event-ID` 请求头（EventSource 重连自动带），优先于 `from` query；
> 3. 心跳用 `:keepalive\n\n` 注释行（不占 seq）；
> 4. 响应头加 `X-Accel-Buffering: no`、`Cache-Control: no-cache`（spec §9.7）；
> 5. 回放完发 `[DONE]`。
>
> **实时尾巴（live tail）刻意不在 P1 做。** 自洽的"从 event_log 持续推实时事件"需要跨请求的 notify/订阅机制，与前端接入一并在 P2-backend 设计最稳妥。**P1 期间实时流式仍走旧 `/stream` + `/stream/resume` 路径**（不动、可用）；新 `session/stream` 只提供持久历史。见"已知遗留"。

- [ ] **Step 1: 写失败测试（历史回放可纯函数测）**

```python
# apps/server/tests/test_session_stream_endpoint.py
from src.service.session.event_log_repo import append_event
from src.service.session.stream import replay_history_sse_lines


def test_replay_emits_sse_lines_with_seq_id(db_session):
    append_event(db_session, 1, "assistant", "turn.started", {"message_id": "a1"})
    append_event(db_session, 1, "assistant", "text.delta", {"message_id": "a1", "text": "hi"})
    lines = replay_history_sse_lines(db_session, conversation_id=1, from_seq=0)
    assert lines[0].startswith("id: 1\n")
    assert "turn.started" in lines[0]
    assert lines[1].startswith("id: 2\n")


def test_replay_after_from_seq_skips_old(db_session):
    append_event(db_session, 1, "assistant", "turn.started", {"message_id": "a1"})
    append_event(db_session, 1, "assistant", "text.delta", {"message_id": "a1", "text": "x"})
    lines = replay_history_sse_lines(db_session, conversation_id=1, from_seq=1)
    assert len(lines) == 1
    assert lines[0].startswith("id: 2\n")
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/test_session_stream_endpoint.py -v`
Expected: FAIL

- [ ] **Step 3: 实现历史回放 + 端点**

```python
# apps/server/src/service/session/stream.py
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from src.service.session.event_log_repo import get_events_after


def replay_history_sse_lines(db: Session, conversation_id: int, from_seq: int | None) -> list[str]:
    """把 event_log 中 seq>from_seq 的事件序列化为 SSE 行（每行带 id:<seq>）。"""
    lines: list[str] = []
    for row in get_events_after(db, conversation_id, after_seq=from_seq):
        payload = {
            "seq": row.seq,
            "scope": row.scope,
            "source": row.source,
            "type": row.type,
            "payload": json.loads(row.payload) if row.payload else None,
        }
        body = json.dumps(payload, ensure_ascii=False, default=str)
        lines.append(f"id: {row.seq}\ndata: {body}\n\n")
    return lines
```

端点（追加到 `session_api.py`）：

```python
from fastapi import Request
from fastapi.responses import StreamingResponse

from src.service.session.stream import replay_history_sse_lines

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.get("/chat/conversations/{conversation_id}/session/stream")
def session_stream(conversation_id: int, request: Request, from_seq: int | None = None,
                   db: Session = Depends(get_db)) -> StreamingResponse:
    # Last-Event-ID 优先于 query（EventSource 自动重连会带）
    last_event_id = request.headers.get("last-event-id")
    if last_event_id is not None:
        try:
            from_seq = int(last_event_id)
        except ValueError:
            pass

    def gen():
        for line in replay_history_sse_lines(db, conversation_id, from_seq):
            yield line
        # P1：无 live tail 接入时直接收尾；live 订阅在 Step 5 接入
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
```

- [ ] **Step 4: 运行确认通过**

Run: `uv run pytest tests/test_session_stream_endpoint.py -v`
Expected: PASS

- [ ] **Step 5: 端点集成快测（Last-Event-ID 优先于 from）**

用 FastAPI `TestClient` 对 `session/stream` 发一个带 `Last-Event-ID: 1` 头的请求，断言响应体不含 seq=1 的行、含 seq>1 的行、以 `[DONE]` 结尾、响应头含 `X-Accel-Buffering: no`。（live tail 不在 P1，故无需活动 task 桩。）

- [ ] **Step 6: 运行全量测试**

Run: `uv run pytest tests/ -q`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/service/session/stream.py apps/server/src/api/session_api.py apps/server/tests/test_session_stream_endpoint.py
git commit -m "feat(session): resumable history-replay stream endpoint backed by event_log"
```

---

## Task 8: 重启耐久性验证（端到端集成测试）

**Files:**
- Test: `apps/server/tests/test_session_restart_durability.py`

- [ ] **Step 1: 写测试**

模拟"事件已落 event_log → 内存 buffer 丢失（不创建活动 task）→ snapshot 与 stream 仍能从 DB 完整重建"。

```python
# apps/server/tests/test_session_restart_durability.py
from src.service.session.event_log_repo import append_event
from src.service.session.snapshot import build_snapshot
from src.service.session.stream import replay_history_sse_lines


def test_history_survives_without_live_task(db_session):
    append_event(db_session, 1, "assistant", "turn.started", {"message_id": "a1"})
    append_event(db_session, 1, "assistant", "text.delta", {"message_id": "a1", "text": "done"})
    append_event(db_session, 1, "assistant", "turn.completed", {"message_id": "a1"})

    # 无活动 task（模拟重启后内存 buffer 已空）
    snap = build_snapshot(db_session, conversation_id=1)
    assert snap["messages"][0]["text"] == "done"
    assert snap["messages"][0]["state"] == "completed"

    lines = replay_history_sse_lines(db_session, conversation_id=1, from_seq=0)
    assert [l.split("\n")[0] for l in lines] == ["id: 1", "id: 2", "id: 3"]
```

- [ ] **Step 2: 运行确认通过**

Run: `uv run pytest tests/test_session_restart_durability.py -v`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/server/tests/test_session_restart_durability.py
git commit -m "test(session): event_log history survives buffer loss (restart durability)"
```

---

## 性能考量（已内建于上述任务）

- **不逐 token 写库**：dual-write 挂在 checkpoint 节奏 + 终态，非每个 delta 一次 IO（Task 5）。
- **合并 text.delta**：一次 flush 内同消息的连续 `text.delta` 合并成一行（Task 5 `_coalesce`），行数与写入量从"每 token 一行"降到"每 flush 一段"，正面规避你们踩过的大文档上万事件场景。
- **批量取号**：`append_events` 一次 flush 只查一次 `MAX(seq)`，内存递推（Task 3），避免逐事件 `SELECT MAX`。
- **snapshot 不回放全量**：直接读已算好的 `message_parts`（Task 6），O(消息数) 而非 O(全部事件)，与 `/messages` 同样廉价。
- **续传只读增量**：`session/stream?from=seq` 仅查 `seq>from`（Task 7），走 `UNIQUE(conversation_id, seq)` 索引。
- **写入串行安全**：dual-write 复用 `sqlite_db_session()` 串行锁（Task 5），不与主 flush 抢锁触发 `database is locked`。
- **后续（非 P1）**：老会话事件保留/压缩（留快照、裁细碎事件行）属后续计划；P1 靠 delta 合并已能把单会话行数压在可控范围。

## 完成标准（P1 Done）

- [ ] `event_log` 表落库，会话级 seq 严格 +1 连续（UniqueConstraint 兜底）。
- [ ] 流式过程在 flush 点 dual-write 规范化事件到 event_log，flag 可关。
- [ ] `GET .../session/snapshot` 返回画面 + `snapshot_seq`。
- [ ] `GET .../session/stream?from=` 支持 Last-Event-ID，历史从 event_log 回放、`id:` 用会话级 seq，含 `:keepalive` 心跳、防缓冲头（实时 live tail 不在 P1）。
- [ ] 服务器重启后已落库历史可经 snapshot/stream 完整重建。
- [ ] 全部新老后端测试通过；旧 `/stream`、`/stream/resume`、`/messages` 行为不变。

## 已知遗留（交接给后续计划，no silent caps）

- **实时 live tail 不在 P1**：新 `session/stream` 仅提供持久历史回放；P1 期间实时流式仍走旧 `/stream` + `/stream/resume`。自洽的"从 event_log 持续推实时事件"（跨请求 notify/订阅）在 P2-backend 与前端接入一并设计。
- **持久化时机 = checkpoint 间隔 + 终态**：流式过程按 checkpoint 节奏（每 `BUFFER_CHECKPOINT_LEN` 事件）增量落 event_log，终态全量补齐。**进程在两次 checkpoint 之间崩溃，会丢失该"未完成轮"自上次 checkpoint 以来的增量**——但该轮的活动 task 在重启时本就被 `_reset_orphaned_streams` 置为 error，故不影响"已完成轮可完整重建"这一 P1 目标。
- **崩溃后 seq 稳定性**：event_log 中**已 commit 的行 seq 永不变**；但某条"未完成轮"若在崩溃前有部分增量未落库，重启后这些增量不会重放（该轮已被判 error），不存在"同一逻辑事件拿到两个 seq"的问题。已 commit 即权威。
- snapshot 复用 `message_parts`（廉价、与 `/messages` 同源）；但**进行中（未终态）那一轮的增量只在 event_log、`message_parts` 暂未含**。P1 的 snapshot/stream 未驱动实时 UI（实时走旧路径），故无影响；P2 接 reducer 时需把"snapshot 的 `message_parts` + event_log 中 `snapshot 之后的进行中尾巴"合并显示。
- `tool.invoked` / `tool.result` 细粒度映射未做（P4 群聊前补全）。
- 幂等键（`client_token`）的写入端（POST 发消息）属 P2 后端范围，P1 不涉及。
- seq 取号（`max+1`）在高并发同会话下依赖 **flush 串行 + `sqlite_db_session` 串行锁 + `UniqueConstraint(conversation_id, seq)`** 三重保证；若未来同会话出现多并发写入点，需引入每会话计数行或行锁。
