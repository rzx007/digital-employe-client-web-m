# 飞书 Channel 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让白名单飞书用户私聊机器人给总管下指令，立即 ACK，该轮跑完回发结构化报告；做成通用 Channel 抽象，飞书是第一个实现。

**Architecture:** lark-oapi WebSocket 长连接（wss 直连）入站 → 复用 headless 注入把消息塞进"最近活跃总管会话" → 主 loop 内忙碌兜底 + 注入 + ACK；核心编排新增一个 channel-无关的 `plan_run_settled` 领域事件，`ChannelManager` 订阅 `WorkspaceEventBus` 终态事件、按 `ChannelInbox` 行路由回执。区分飞书来源完全落在 `ChannelInbox`（消息级），不建专属会话、不加 `Conversation.channel`。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2.0（`DeclarativeBase`，无 Alembic，`create_all` 建表）/ pytest / uv / lark-oapi（新增依赖）。

**设计依据:** `docs/superpowers/specs/2026-06-24-feishu-channel-integration-design.md`

---

## 关键约定（所有任务通用）

- **测试命令前缀**：`cd apps/server && uv run python -m pytest <path> -v`
- **测试 DB**：用 `tests/conftest.py` 的 `db_session` fixture（内存 SQLite + `Base.metadata.create_all`）。涉及模块级 `get_session_local()` 的，用 `monkeypatch.setattr("<模块路径>.get_session_local", lambda: session_factory)`。
- **`get_settings()` 有 `lru_cache`**：测试里改配置后调 `get_settings.cache_clear()`。
- **时间列**：用 `from src.db.types import CstDateTime` + `from src.models.workspace import cst_now`。
- **提交粒度**：每个 Task 末尾一次 commit；分支 `feat/orchestrator-centric`。

---

## 文件结构（先锁定边界）

**新增：**
- `apps/server/src/models/channel_inbox.py` — `ChannelInbox` 模型（真相源 / 去重 / 回执路由）
- `apps/server/src/service/channel/__init__.py`
- `apps/server/src/service/channel/base.py` — `Channel` 抽象基类 + `InboundMessage` dataclass
- `apps/server/src/service/channel/inbox_service.py` — inbox 增删查改 + 去重 + 状态机
- `apps/server/src/service/channel/report.py` — `build_channel_report()` 拼回执文本
- `apps/server/src/service/channel/manager.py` — `ChannelManager`（注册表 + lifespan + 事件订阅分发 + 重启对账）
- `apps/server/src/service/channel/feishu_im.py` — `FeishuIMService`（lark-oapi 出站发消息）
- `apps/server/src/service/channel/feishu_channel.py` — `FeishuChannel`（lark-oapi ws 入站 + on_message）
- `apps/server/src/service/agent/orchestrator/curator_injection.py` — 共享 `inject_curator_instruction()`（从 `_start_curator_task` 抽取）
- 对应 `apps/server/tests/test_*.py`

**修改：**
- `apps/server/pyproject.toml` — 加 `lark-oapi` 依赖
- `apps/server/src/core/config.py` — 加 `feishu_channel_enabled` / `feishu_whitelist_open_ids`
- `apps/server/src/service/workspace_events.py` — 加 `PLAN_RUN_SETTLED` 常量
- `apps/server/src/service/agent/orchestrator/plan_run_service.py` — `settle_plan_run` 发事件 + `emit_plan_run_settled()` 助手
- `apps/server/src/service/agent/orchestrator/execution.py:155-159` — 异常 failed 路径发事件
- `apps/server/src/service/task_scheduler_service.py` — ① `:491-498` 异常 failed 发事件；② `_start_curator_task` 改用 `inject_curator_instruction`
- `apps/server/src/models/__init__.py` — 注册 `ChannelInbox`
- `apps/server/src/server.py` — lifespan 启停 `ChannelManager`

---

## Phase 0：连通性 spike（手动门，先做）

> ⚠️ lark-oapi 的 ws.Client 线程/回调模型与发消息 API 必须先实测，否则 Phase 6 会卡。这一步不写测试，产出一个一次性脚本，跑通后即可丢弃。

### Task 0：lark-oapi 长连接 + 发消息 spike

**Files:** Create: `apps/server/scripts/feishu_ws_spike.py`（临时，跑通后删）

- [ ] **Step 1: 加依赖**

Run: `cd apps/server && uv add lark-oapi`
Expected: `pyproject.toml` 出现 `lark-oapi`，`uv.lock` 更新。

- [ ] **Step 2: 写 spike 脚本**

用真实 app_id/app_secret（从 `config_kvs` 或临时环境变量）起一个 `lark_oapi.ws.Client`，注册"收到消息事件"回调打印 `event`，回调里调一次 IM `create` 给发消息人回一句 "spike ok"。参考 lark-oapi 官方 `ws.Client` + `EventDispatcherHandler.builder().register_p2_im_message_receive_v1(...)` 范式。

- [ ] **Step 3: 实跑验证**

Run: `cd apps/server && uv run python scripts/feishu_ws_spike.py`，用白名单飞书号私聊机器人发一条 "hi"。
Expected: 终端打印出 event（含 `open_id` / `chat_id` / `message_id` / text），且飞书侧收到 "spike ok"。

**确认并记录**（写进本任务 commit message 或 spec 附注）：
- 回调运行在哪个线程（非主线程）；
- `open_id`、`chat_id`、`event_id`、文本 在 event 对象里的确切取值路径；
- 发消息的确切 API 调用（`client.im.v1.message.create(...)` 的 request 构造）。

- [ ] **Step 4: 提交（保留脚本备查，或删除后提交）**

```bash
git add apps/server/pyproject.toml apps/server/uv.lock apps/server/scripts/feishu_ws_spike.py
git commit -m "chore(feishu): lark-oapi 依赖 + 长连接连通性 spike"
```

> 🚩 **HUMAN GATE**：spike 跑通前不要进 Phase 6。Phase 1–5 不依赖 SDK，可并行先做。

---

## Phase 1：核心编排领域事件 `plan_run_settled`

> 这是设计里唯一的核心编排侵入点。让所有 PlanRun 终态（正常 settled + 两条异常 failed）都发一个 channel-无关事件。

### Task 1.1：settle_plan_run 发 plan_run_settled

**Files:**
- Modify: `apps/server/src/service/workspace_events.py:11-15`
- Modify: `apps/server/src/service/agent/orchestrator/plan_run_service.py:59-64`
- Test: `apps/server/tests/test_plan_run_settled_event.py`

- [ ] **Step 1: 加事件常量**

`workspace_events.py` 在现有常量后加：
```python
PLAN_RUN_SETTLED = "plan_run_settled"
```

- [ ] **Step 2: 写失败测试**

```python
# tests/test_plan_run_settled_event.py
from src.models.plan_run import PlanRun
from src.models.workspace import cst_now
from src.service.workspace_events import WorkspaceEventBus, PLAN_RUN_SETTLED
from src.service.agent.orchestrator.plan_run_service import settle_plan_run


def test_settle_plan_run_emits_event(db_session):
    run = PlanRun(plan_id=1, workspace_id=7, run_seq=1, status="running",
                  conversation_id=42, started_at=cst_now())
    db_session.add(run); db_session.commit()

    q = WorkspaceEventBus.subscribe(7)
    settle_plan_run(db_session, run.id)
    db_session.commit()

    import json
    evt = json.loads(q.get_nowait())
    assert evt["type"] == PLAN_RUN_SETTLED
    assert evt["run_id"] == run.id
    assert evt["conversation_id"] == 42
    assert evt["workspace_id"] == 7
```

- [ ] **Step 3: 运行确认失败**

Run: `cd apps/server && uv run python -m pytest tests/test_plan_run_settled_event.py -v`
Expected: FAIL（无事件入队，`queue.Empty`）。

- [ ] **Step 4: 实现 emit 助手 + 接入 settle**

`plan_run_service.py`：
```python
from src.service.workspace_events import WorkspaceEventBus, PLAN_RUN_SETTLED


def emit_plan_run_settled(run: PlanRun) -> None:
    """PlanRun 到终态时发 channel-无关领域事件（settled / failed 都发）。"""
    WorkspaceEventBus.push(run.workspace_id, {
        "type": PLAN_RUN_SETTLED,
        "plan_id": run.plan_id,
        "run_id": run.id,
        "workspace_id": run.workspace_id,
        "conversation_id": run.conversation_id,
        "status": run.status,
    })


def settle_plan_run(db: Session, run_id: int) -> None:
    """标记一轮 run 全部定局。调用方负责 commit。"""
    run = db.get(PlanRun, run_id)
    if run is not None and run.status != "settled":
        run.status = "settled"
        run.ended_at = cst_now()
        emit_plan_run_settled(run)
```

- [ ] **Step 5: 运行确认通过 + 回归**

Run: `cd apps/server && uv run python -m pytest tests/test_plan_run_settled_event.py -v`
Expected: PASS。
Run（回归编排调度相关）: `cd apps/server && uv run python -m pytest tests/ -k "plan_run or dependency or scheduler" -v`
Expected: 不引入新失败。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/workspace_events.py apps/server/src/service/agent/orchestrator/plan_run_service.py apps/server/tests/test_plan_run_settled_event.py
git commit -m "feat(orchestrator): settle_plan_run 发 plan_run_settled 领域事件"
```

### Task 1.2：两条异常 failed 路径也发事件

**Files:**
- Modify: `apps/server/src/service/agent/orchestrator/execution.py:155-159`
- Modify: `apps/server/src/service/task_scheduler_service.py:491-498`
- Test: `apps/server/tests/test_plan_run_settled_event.py`（追加）

- [ ] **Step 1: 追加失败测试**

新增一个测试：构造一个 PlanRun，手动模拟 `execution.py` 的 except 分支逻辑（设 `run.status="failed"` 后应发事件）。最直接的做法：把两处 except 里"设 failed + 发事件"抽成 `mark_plan_run_failed(db, run)` 助手放在 `plan_run_service.py`，测它发事件。
```python
def test_mark_plan_run_failed_emits_event(db_session):
    from src.service.agent.orchestrator.plan_run_service import mark_plan_run_failed
    run = PlanRun(plan_id=1, workspace_id=9, run_seq=1, status="running",
                  conversation_id=5, started_at=cst_now())
    db_session.add(run); db_session.commit()
    q = WorkspaceEventBus.subscribe(9)
    mark_plan_run_failed(db_session, run)
    import json
    evt = json.loads(q.get_nowait())
    assert evt["type"] == PLAN_RUN_SETTLED and evt["status"] == "failed"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/server && uv run python -m pytest tests/test_plan_run_settled_event.py::test_mark_plan_run_failed_emits_event -v`
Expected: FAIL（`mark_plan_run_failed` 不存在）。

- [ ] **Step 3: 实现助手 + 改两处 except**

`plan_run_service.py` 加：
```python
def mark_plan_run_failed(db: Session, run: PlanRun) -> None:
    """异常路径：置 failed + 发终态事件。调用方负责 commit（或本函数所在 except 已 commit）。"""
    if run.status not in ("settled", "failed"):
        run.status = "failed"
        run.ended_at = cst_now()
    emit_plan_run_settled(run)
```

`execution.py:155-159` except 改为：
```python
    except Exception:
        from src.service.agent.orchestrator.plan_run_service import mark_plan_run_failed
        mark_plan_run_failed(db, run)
        db.commit()
        raise
```

`task_scheduler_service.py:491-498` except 改为：
```python
    except Exception:
        logger.error("run_plan_job 触发失败 plan=%s", plan_id, exc_info=True)
        if run is not None:
            from src.service.agent.orchestrator.plan_run_service import mark_plan_run_failed
            mark_plan_run_failed(db, run)
            db.commit()
```
（注意：原 `:491` 块若 run 创建失败 `run` 为 None，则无可发事件——这是合理的，inbox 行会由 Phase 5 重启对账兜底。）

- [ ] **Step 4: 运行确认通过 + 回归**

Run: `cd apps/server && uv run python -m pytest tests/test_plan_run_settled_event.py -v`
Expected: PASS。
Run: `cd apps/server && uv run python -m pytest tests/ -k "execution or scheduler or plan_run" -v`
Expected: 无新失败。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/plan_run_service.py apps/server/src/service/agent/orchestrator/execution.py apps/server/src/service/task_scheduler_service.py apps/server/tests/test_plan_run_settled_event.py
git commit -m "feat(orchestrator): 两条异常 failed 路径补发 plan_run_settled，杜绝 inbox 悬挂"
```

---

## Phase 2：共享注入函数 `inject_curator_instruction`

> 把 `_start_curator_task` 里"注入 user/assistant 消息 + 投主 loop 起 orchestrator 流"抽出来，飞书与调度器共用。

### Task 2.1：抽取并让调度器改用

**Files:**
- Create: `apps/server/src/service/agent/orchestrator/curator_injection.py`
- Modify: `apps/server/src/service/task_scheduler_service.py:316-478`（`_start_curator_task` 改调用）
- Test: `apps/server/tests/test_curator_injection.py`

- [ ] **Step 1: 写失败测试**

`inject_curator_instruction(db, conversation, text, *, source, employee_id=None, priority=...)` 应：① 建一条 user `ConversationMessage`（role=user, content=text, stream_state=completed）；② 建一条 assistant 空消息（stream_state=streaming/queued）；③ 把"起流"投到主 loop（测试里 mock `_get_main_loop` 与 `registry.start`）；④ 返回 `(user_msg_id, assistant_msg_id)`。
```python
# tests/test_curator_injection.py
from unittest.mock import MagicMock
from src.models.conversation import Conversation, ConversationMessage
from src.models.workspace import cst_now


def test_inject_creates_messages_and_starts_stream(db_session, monkeypatch):
    conv = Conversation(workspace_id=3, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()

    fake_loop = MagicMock()
    monkeypatch.setattr("src.service.agent.orchestrator.curator_injection._get_main_loop",
                        lambda: fake_loop)
    from src.service.agent.orchestrator.curator_injection import inject_curator_instruction
    user_id, asst_id = inject_curator_instruction(
        db_session, conv, "帮我跑日报", source="feishu")

    msgs = db_session.query(ConversationMessage).filter_by(conversation_id=conv.id).all()
    assert {m.role for m in msgs} == {"user", "assistant"}
    user_msg = next(m for m in msgs if m.role == "user")
    assert user_msg.content == "帮我跑日报"
    assert (user_id, asst_id) == (user_msg.id, next(m.id for m in msgs if m.role == "assistant"))
    fake_loop.call_soon_threadsafe.assert_called_once()  # 起流被投到主 loop
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/server && uv run python -m pytest tests/test_curator_injection.py -v`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 curator_injection.py**

把 `_start_curator_task` 中 `# 3. 用户消息` 到 `main_loop.call_soon_threadsafe(_start_on_main)`（含 `_start_on_main` 闭包）整段搬进新函数，签名：
```python
def inject_curator_instruction(
    db: Session,
    conversation: Conversation,
    text: str,
    *,
    source: str,
    employee_id: int | None = None,
    priority: int | None = None,
    initial_msg_state: str = "streaming",
) -> tuple[int, int]:
    """在 curator 会话注入一条 user 指令并起 orchestrator 流。返回 (user_msg_id, assistant_msg_id)。
    source: "scheduled" | "feishu" | ... 透传给 registry.start。"""
```
- 保留原 `_start_on_main` 闭包（新开 `get_session_local()()`、`get_orchestrator_agent(...)`、`registry.start(..., source=source, priority=priority)`、异常 `reset_context` + `orch_db.close()`）。
- `_get_main_loop` 从 `src.service.agent.orchestrator` import（保持与原一致）。
- 不在本函数内建 `TaskExecutionLog`（那是调度器的事，留在调用方）。

- [ ] **Step 4: 让 `_start_curator_task` 改调用**

把原内联段替换为：建好 `TaskExecutionLog`（保留）后，调
```python
user_msg_id, asst_msg_id = inject_curator_instruction(
    db, conv, task.user_prompt or task.task_name,
    source="scheduled", employee_id=employee.id,
    priority=SCHEDULED_PRIORITY, initial_msg_state=initial_msg_state)
```
保留原 `slot_busy`/`initial_msg_state` 计算与 `WorkspaceEventBus.push(task_started)`。

- [ ] **Step 5: 运行确认通过 + 调度回归**

Run: `cd apps/server && uv run python -m pytest tests/test_curator_injection.py -v`
Expected: PASS。
Run: `cd apps/server && uv run python -m pytest tests/ -k "scheduler or curator or task" -v`
Expected: 无新失败（确认抽取未破坏定时总管任务）。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/service/agent/orchestrator/curator_injection.py apps/server/src/service/task_scheduler_service.py apps/server/tests/test_curator_injection.py
git commit -m "refactor(orchestrator): 抽 inject_curator_instruction 共享给调度器与 channel"
```

---

## Phase 3：数据层（ChannelInbox 模型 + 配置 + inbox 服务）

### Task 3.1：ChannelInbox 模型

**Files:**
- Create: `apps/server/src/models/channel_inbox.py`
- Modify: `apps/server/src/models/__init__.py`
- Test: `apps/server/tests/test_channel_inbox_model.py`

- [ ] **Step 1: 写失败测试（含 unique 去重）**

```python
# tests/test_channel_inbox_model.py
import pytest
from sqlalchemy.exc import IntegrityError
from src.models.channel_inbox import ChannelInbox


def test_external_event_id_unique(db_session):
    db_session.add(ChannelInbox(channel="feishu", external_event_id="evt-1",
                                external_user_id="ou_x", external_chat_id="oc_y",
                                workspace_id=1, conversation_id=2, status="acked"))
    db_session.commit()
    db_session.add(ChannelInbox(channel="feishu", external_event_id="evt-1",
                                external_user_id="ou_x", external_chat_id="oc_y",
                                workspace_id=1, conversation_id=2, status="acked"))
    with pytest.raises(IntegrityError):
        db_session.commit()
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/server && uv run python -m pytest tests/test_channel_inbox_model.py -v`
Expected: FAIL（模型不存在）。

- [ ] **Step 3: 实现模型**

```python
# src/models/channel_inbox.py
from datetime import datetime
from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from src.db.base import Base
from src.db.types import CstDateTime
from src.models.workspace import cst_now


class ChannelInbox(Base):
    """渠道入站指令真相源：去重 / 关联那一轮 / 回执路由 / 状态机。"""
    __tablename__ = "channel_inbox"
    __table_args__ = (
        UniqueConstraint("channel", "external_event_id", name="uq_channel_event"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    external_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    external_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    external_chat_id: Mapped[str] = mapped_column(String(255), nullable=False)
    workspace_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    conversation_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    user_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assistant_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    plan_run_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # received → acked → running → reported / failed / rejected
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="received", index=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    reported_at: Mapped[datetime | None] = mapped_column(CstDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(CstDateTime, default=cst_now, onupdate=cst_now)
```
`models/__init__.py`：import `ChannelInbox` 并加进 `__all__`（确保 `create_all` 注册建表）。

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/server && uv run python -m pytest tests/test_channel_inbox_model.py -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/models/channel_inbox.py apps/server/src/models/__init__.py apps/server/tests/test_channel_inbox_model.py
git commit -m "feat(channel): ChannelInbox 模型（去重/关联/回执路由真相源）"
```

### Task 3.2：配置项

**Files:**
- Modify: `apps/server/src/core/config.py`（Settings dataclass ~L155 + `get_settings()` return ~L587）
- Test: `apps/server/tests/test_feishu_channel_config.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_feishu_channel_config.py
def test_channel_settings_defaults(monkeypatch):
    from src.core.config import get_settings
    get_settings.cache_clear()
    s = get_settings()
    assert s.feishu_channel_enabled is False
    assert s.feishu_whitelist_open_ids is None
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

Settings dataclass 加：
```python
    feishu_channel_enabled: bool = False
    feishu_whitelist_open_ids: str | None = None  # 逗号分隔或 JSON 数组字符串
```
`get_settings()` return 里加：
```python
        feishu_channel_enabled=_get_kv_bool(kv_data, "FEISHU_CHANNEL_ENABLED", default=False),
        feishu_whitelist_open_ids=_get_kv_value(kv_data, "FEISHU_WHITELIST_OPEN_IDS"),
```

- [ ] **Step 4: 确认通过 → Step 5: 提交**

Run: `cd apps/server && uv run python -m pytest tests/test_feishu_channel_config.py -v` → PASS
```bash
git add apps/server/src/core/config.py apps/server/tests/test_feishu_channel_config.py
git commit -m "feat(config): feishu_channel_enabled / feishu_whitelist_open_ids"
```

### Task 3.3：inbox_service（去重 / 状态 / 查询）

**Files:**
- Create: `apps/server/src/service/channel/__init__.py`（空）、`apps/server/src/service/channel/inbox_service.py`
- Test: `apps/server/tests/test_inbox_service.py`

- [ ] **Step 1: 写失败测试**

覆盖：① `record_event(...)` 首次成功返回行、重复 `external_event_id` 返回 `None`（靠 IntegrityError 回滚判重）；② `find_pending_by_conversation(conv_id)` 取该会话最近一条 `status∈{acked,running}` 行；③ `find_pending_by_plan_run(run_id)`；④ `mark(row, status, plan_run_id=...)`。
```python
# tests/test_inbox_service.py
from src.service.channel import inbox_service as S


def test_record_event_dedup(db_session):
    row = S.record_event(db_session, channel="feishu", external_event_id="e1",
                         external_user_id="ou", external_chat_id="oc",
                         workspace_id=1, conversation_id=2, text="hi")
    assert row is not None
    dup = S.record_event(db_session, channel="feishu", external_event_id="e1",
                         external_user_id="ou", external_chat_id="oc",
                         workspace_id=1, conversation_id=2, text="hi")
    assert dup is None  # 去重


def test_find_pending_by_conversation_latest(db_session):
    S.record_event(db_session, channel="feishu", external_event_id="e1",
                   external_user_id="ou", external_chat_id="oc",
                   workspace_id=1, conversation_id=2, text="a", status="reported")
    r2 = S.record_event(db_session, channel="feishu", external_event_id="e2",
                        external_user_id="ou", external_chat_id="oc",
                        workspace_id=1, conversation_id=2, text="b", status="acked")
    found = S.find_pending_by_conversation(db_session, 2)
    assert found.id == r2.id  # 只取 pending(acked/running) 的最近一条
```

- [ ] **Step 2: 确认失败 → Step 3: 实现 inbox_service**

```python
# src/service/channel/inbox_service.py
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from src.models.channel_inbox import ChannelInbox

_PENDING = ("acked", "running")


def record_event(db, *, channel, external_event_id, external_user_id,
                 external_chat_id, workspace_id, conversation_id, text,
                 status="acked") -> ChannelInbox | None:
    row = ChannelInbox(channel=channel, external_event_id=external_event_id,
                       external_user_id=external_user_id, external_chat_id=external_chat_id,
                       workspace_id=workspace_id, conversation_id=conversation_id,
                       text=text, status=status)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None  # 重复事件，去重
    db.refresh(row)
    return row


def find_pending_by_conversation(db, conversation_id) -> ChannelInbox | None:
    return db.scalars(
        select(ChannelInbox)
        .where(ChannelInbox.conversation_id == conversation_id,
               ChannelInbox.status.in_(_PENDING))
        .order_by(ChannelInbox.id.desc())
    ).first()


def find_pending_by_plan_run(db, plan_run_id) -> ChannelInbox | None:
    return db.scalars(
        select(ChannelInbox)
        .where(ChannelInbox.plan_run_id == plan_run_id,
               ChannelInbox.status.in_(_PENDING))
        .order_by(ChannelInbox.id.desc())
    ).first()


def mark(db, row: ChannelInbox, status: str, *, plan_run_id=None,
         assistant_message_id=None, user_message_id=None, reported=False):
    from src.models.workspace import cst_now
    row.status = status
    if plan_run_id is not None:
        row.plan_run_id = plan_run_id
    if assistant_message_id is not None:
        row.assistant_message_id = assistant_message_id
    if user_message_id is not None:
        row.user_message_id = user_message_id
    if reported:
        row.reported_at = cst_now()
    db.commit()


def list_unsettled(db) -> list[ChannelInbox]:
    return list(db.scalars(
        select(ChannelInbox).where(ChannelInbox.status.in_(_PENDING))))
```

- [ ] **Step 4: 确认通过 → Step 5: 提交**

Run: `cd apps/server && uv run python -m pytest tests/test_inbox_service.py -v` → PASS
```bash
git add apps/server/src/service/channel/__init__.py apps/server/src/service/channel/inbox_service.py apps/server/tests/test_inbox_service.py
git commit -m "feat(channel): inbox_service（IntegrityError 去重 + pending 查询 + 状态机）"
```

---

## Phase 4：Channel 抽象 + 报告构建

### Task 4.1：Channel 基类 + InboundMessage

**Files:** Create: `apps/server/src/service/channel/base.py` · Test: `apps/server/tests/test_channel_base.py`

- [ ] **Step 1: 写测试**（一个 Fake 子类即可实例化、未实现方法 raise）

```python
# tests/test_channel_base.py
from src.service.channel.base import Channel, InboundMessage


def test_inbound_message_fields():
    m = InboundMessage(external_user_id="ou", external_chat_id="oc",
                       text="hi", external_event_id="e1")
    assert m.text == "hi"


def test_channel_is_abstract():
    import pytest
    with pytest.raises(TypeError):
        Channel()  # 抽象类不可实例化
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```python
# src/service/channel/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(slots=True)
class InboundMessage:
    external_user_id: str
    external_chat_id: str
    text: str
    external_event_id: str


class Channel(ABC):
    name: str = ""

    @abstractmethod
    def start(self) -> None: ...
    @abstractmethod
    def stop(self) -> None: ...
    @abstractmethod
    def is_authorized(self, external_user_id: str) -> bool: ...
    @abstractmethod
    def send_ack(self, chat_id: str, text: str) -> None: ...
    @abstractmethod
    def send_report(self, chat_id: str, report: str) -> None: ...
```

- [ ] **Step 4: 确认通过 → Step 5: 提交**

```bash
git add apps/server/src/service/channel/base.py apps/server/tests/test_channel_base.py
git commit -m "feat(channel): Channel 抽象基类 + InboundMessage"
```

### Task 4.2：build_channel_report

**Files:** Create: `apps/server/src/service/channel/report.py` · Test: `apps/server/tests/test_channel_report.py`

- [ ] **Step 1: 写测试**

`build_channel_report(db, inbox_row) -> str`：
- 若 `plan_run_id` 为空（纯对话）→ 取该会话最后一条 assistant 消息经 `resolve_assistant_delivery_text` 的文本。
- 若有 `plan_run_id`（编排轮）→ 用 `collect_plan_deliverables(db, plan_id, run_id)` 列交付物 + 逐子任务状态汇总成"完成/部分失败"。
测试用纯对话场景（构造会话 + 一条 assistant 消息）断言报告含其文本。

```python
# tests/test_channel_report.py
from src.models.conversation import Conversation, ConversationMessage
from src.models.channel_inbox import ChannelInbox
from src.service.channel.report import build_channel_report


def test_pure_reply_report(db_session):
    conv = Conversation(workspace_id=1, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()
    db_session.add(ConversationMessage(conversation_id=conv.id, role="assistant",
                                       content="日报已生成", stream_state="completed"))
    db_session.commit()
    row = ChannelInbox(channel="feishu", external_event_id="e1", external_user_id="ou",
                       external_chat_id="oc", workspace_id=1, conversation_id=conv.id,
                       status="running", text="跑日报")
    db_session.add(row); db_session.commit()
    report = build_channel_report(db_session, row)
    assert "日报已生成" in report
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```python
# src/service/channel/report.py
from sqlalchemy import select
from src.models.conversation import ConversationMessage
from src.models.plan_run import PlanRun
from src.service.orchestrator_execution_summary import resolve_assistant_delivery_text

_MAX = 3000  # 飞书文本上限保守截断


def build_channel_report(db, row) -> str:
    if row.plan_run_id is None:
        last = db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == row.conversation_id,
                   ConversationMessage.role == "assistant")
            .order_by(ConversationMessage.id.desc())
        ).first()
        body = resolve_assistant_delivery_text(last) or "（无文本回复）"
        return _clip(body)

    # 编排轮：交付物 + 子任务状态
    run = db.get(PlanRun, row.plan_run_id)
    from src.service.orchestration_lifecycle import collect_plan_deliverables
    delivs = collect_plan_deliverables(db, run.plan_id, run_id=run.id) if run else []
    lines = ["【执行完成】" if run and run.status == "settled" else "【执行结束】"]
    lines.append(f"指令：{_clip(row.text or '', 80)}")
    if delivs:
        names = "、".join(d["basename"] for d in delivs)
        lines.append(f"交付物：{names}")
    else:
        lines.append("交付物：（无）")
    return _clip("\n".join(lines))


def _clip(s: str, n: int = _MAX) -> str:
    return s if len(s) <= n else s[:n] + "…（详见客户端）"
```
> 注：子任务逐条状态的精细聚合（✅/❌）可在实现时按 `orchestrator_execution_summary` 现有能力补全；起步先交付物 + 总体状态即可（YAGNI）。

- [ ] **Step 4: 确认通过 → Step 5: 提交**

```bash
git add apps/server/src/service/channel/report.py apps/server/tests/test_channel_report.py
git commit -m "feat(channel): build_channel_report（纯回复取最终文本 / 编排轮列交付物）"
```

---

## Phase 5：ChannelManager（注册表 + 分发 + 重启对账）

### Task 5.1：会话解析 + ChannelManager 分发核心

**Files:**
- Create: `apps/server/src/service/channel/manager.py`
- Test: `apps/server/tests/test_channel_manager.py`

- [ ] **Step 1: 写失败测试（用 FakeChannel + 模拟事件）**

覆盖分发路径（注意 monkeypatch `resolve_latest_run_id_by_conversation`，它决定纯对话 vs 编排轮）：
- **纯对话**：inbox `status=acked`；`resolve_latest_run_id_by_conversation` 返回 `None` →喂 `CONVERSATION_STATUS_CHANGED(idle)` → send_report 被调一次、inbox 变 `reported`。
- **编排轮回填（关键，防 blocker 回归）**：inbox `status=acked, plan_run_id=None`；`resolve_latest_run_id_by_conversation` 返回 `R` →喂 `CONVERSATION_STATUS_CHANGED(idle)` → **不回执**、inbox 变 `status=running, plan_run_id=R`；随后喂 `plan_run_settled(run_id=R)` → 回执一次、`reported`。
- **幂等**：同一事件喂两次，只回执一次（第二次因 status 已 reported 不命中）。
- **次新行**：会话有 `reported` 旧行 + `running` 新行 → 只命中新行（`order_by id desc + status in pending`）。
```python
# tests/test_channel_manager.py
from src.models.channel_inbox import ChannelInbox
from src.service.channel.manager import ChannelManager
from src.service.channel.base import Channel


class FakeChannel(Channel):
    name = "feishu"
    def __init__(self): self.reports = []
    def start(self): ...
    def stop(self): ...
    def is_authorized(self, uid): return True
    def send_ack(self, chat_id, text): ...
    def send_report(self, chat_id, report): self.reports.append((chat_id, report))


def test_dispatch_pure_reply(db_session, monkeypatch):
    monkeypatch.setattr("src.service.channel.manager.build_channel_report",
                        lambda db, row: "REPORT")
    monkeypatch.setattr("src.service.channel.manager.resolve_latest_run_id_by_conversation",
                        lambda db, cid: None)  # 纯对话：无 PlanRun
    conv_id = 10
    row = ChannelInbox(channel="feishu", external_event_id="e1", external_user_id="ou",
                       external_chat_id="oc", workspace_id=1, conversation_id=conv_id,
                       status="acked", text="hi")
    db_session.add(row); db_session.commit()
    mgr = ChannelManager()
    fake = FakeChannel(); mgr.register(fake)
    # 直接调内部分发入口（绕过线程订阅），传一个 idle 终态事件
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed",
                                        "conversation_id": conv_id, "status": "idle"})
    assert fake.reports == [("oc", "REPORT")]
    db_session.refresh(row); assert row.status == "reported"
    # 幂等：再喂一次不重复回执
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed",
                                        "conversation_id": conv_id, "status": "idle"})
    assert len(fake.reports) == 1
```

- [ ] **Step 1.5: 先加 `WorkspaceEventBus.subscribe_all()`（前置子步骤，Issue 2）**

> ⚠️ 实测：`WorkspaceEventBus.push(workspace_id, ...)` 对**没有订阅者的 workspace 直接 return 丢事件**（`workspace_events.py:22-24`），且只有 per-workspace `subscribe`，**无全局订阅**。ChannelManager 不可能预知所有 workspace_id，必须有全局订阅，否则回执触发会被静默吃掉。

先给 `workspace_events.py` 加一个 channel-无关的全局订阅（通知中心也可复用）：
```python
# WorkspaceEventBus 内新增
_global_subscribers: set[queue.Queue] = set()   # 类属性

@classmethod
def subscribe_all(cls) -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=512)
    cls._global_subscribers.add(q)
    return q

# push() 末尾追加：除 per-workspace 外，也投全局队列
for q in list(cls._global_subscribers):
    try:
        q.put_nowait(data)
    except Exception:
        cls._global_subscribers.discard(q)
```
附测试 `tests/test_workspace_events_subscribe_all.py`：**对一个从未 `subscribe(ws)` 的 workspace**，`subscribe_all()` 后 `push(ws, evt)` 仍能在全局队列收到（这正是 ChannelManager 的场景——它从不 per-workspace 订阅）。

> ⚠️ **`push` 必须重构**（不能只在末尾"追加"）：现状 `push` 开头 `if not queues: return`（`workspace_events.py:24`），在无 per-workspace 订阅者时**直接 return，`data = json.dumps(...)` 都没执行**。必须把 `data = json.dumps(...)` 提到该 `return` **之前**，并让全局投递循环在"per-workspace 为空也继续"的路径上执行。否则对无 per-workspace 订阅的 workspace（ChannelManager 的核心场景）全局队列永远收不到，Issue 2 等于没解。改后保留原 per-workspace 的 `queue.Full`/dead 清理逻辑不动。

- [ ] **Step 1.6: 加按会话查最新 run 的原语（前置子步骤，Issue A）**

> ⚠️ 现成 `resolve_run_id_for_conversation` 签名是三参 `(db, plan_id, conversation_id)`（`orchestration_lifecycle.py:126`，按 plan_id+conversation_id 联合查），而 ChannelManager 的 idle 分支手里只有 `conversation_id`（`CONVERSATION_STATUS_CHANGED` payload 无 plan_id），**用不了**。

在 `orchestration_lifecycle.py` 加一个只按会话查的原语：
```python
def resolve_latest_run_id_by_conversation(db, conversation_id: int) -> int | None:
    from sqlalchemy import select
    from src.models.plan_run import PlanRun
    return db.scalar(
        select(PlanRun.id).where(PlanRun.conversation_id == conversation_id)
        .order_by(PlanRun.id.desc()))
```
附测试 `tests/test_resolve_latest_run.py`：会话无 run → None；有两轮 run → 返回最新 run.id。

- [ ] **Step 2: 确认失败 → Step 3: 实现 ChannelManager**

要点：`register/get`、`_on_terminal_event(db, evt)` 按事件类型分流：
- **`conversation_status_changed` 且 status∈{idle,error}（关键：此事件在总管自己的流结束即发，**早于** PlanRun settle）**：
  - `find_pending_by_conversation(conv_id)` 命中 pending 行后，**必须查这一轮有没有产生 PlanRun**（用 Step 1.6 新增的 `resolve_latest_run_id_by_conversation(db, conv_id)`）：
    - **没有 run（纯对话回复）** → `build_channel_report` 回执 + mark `reported`。
    - **有 run（编排轮）** → `inbox_service.mark(row, "running", plan_run_id=run_id)` **回填 plan_run_id、先不回执**，等 `plan_run_settled`。
  - ❌ 不要只判 `plan_run_id is None` 就回执——那会把每个编排轮在刚开跑时误当纯对话回执掉。
- **`plan_run_settled`**：`find_pending_by_plan_run(run_id)` 命中 → 回执 + mark `reported`。（防御：即使 `db.get(PlanRun, run_id)` 读到的 status 不是 settled，也按终态处理，靠 inbox `status` 幂等去重——Issue 4。）
- 回执：`build_channel_report` → `self.get(row.channel).send_report(row.external_chat_id, report)` → `inbox_service.mark(reported=True)`。
- `start()`：遍历注册 channel 调 `start()`；`q = WorkspaceEventBus.subscribe_all()`，起后台线程循环 `q.get()` → 新开 `get_session_local()()` → `_on_terminal_event(db, evt)`。**先订阅再放行入站**，确保订阅早于任何终态 push。`stop()`：逐个 `stop()` + 停线程。
- 单例：`ChannelManager` 提供模块级 `manager = ChannelManager()` 供 server.py 用。

- [ ] **Step 4: 确认通过 → Step 5: 提交**

```bash
git add apps/server/src/service/channel/manager.py apps/server/tests/test_channel_manager.py
git commit -m "feat(channel): ChannelManager 分发（纯回复/编排轮终态→回执，幂等去重）"
```

### Task 5.2：重启对账

**Files:** Modify: `apps/server/src/service/channel/manager.py` · Test: `apps/server/tests/test_channel_manager.py`（追加）

- [ ] **Step 1: 写失败测试**

`ChannelManager.reconcile_on_start(db)`：扫 `inbox_service.list_unsettled` → 对每行，若 `registry.is_active(conversation_id)` 为假（重启后必假）→ 回 `执行被中断` 报告 + mark `failed`。
```python
def test_reconcile_interrupted(db_session, monkeypatch):
    monkeypatch.setattr("src.service.channel.manager.registry",
                        type("R", (), {"is_active": staticmethod(lambda cid: False)})())
    row = ChannelInbox(channel="feishu", external_event_id="e9", external_user_id="ou",
                       external_chat_id="oc", workspace_id=1, conversation_id=5,
                       status="running", text="x")
    db_session.add(row); db_session.commit()
    mgr = ChannelManager(); fake = FakeChannel(); mgr.register(fake)
    mgr.reconcile_on_start(db_session)
    db_session.refresh(row)
    assert row.status == "failed"
    assert fake.reports and "中断" in fake.reports[0][1]
```

- [ ] **Step 2–4: 实现 + 通过**（`reconcile_on_start` 在 `start()` 内调一次）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/channel/manager.py apps/server/tests/test_channel_manager.py
git commit -m "feat(channel): 重启对账，未终态轮回执执行被中断并收尾"
```

---

## Phase 6：FeishuChannel + FeishuIMService（依赖 Phase 0 spike）

### Task 6.1：FeishuIMService（出站）

**Files:** Create: `apps/server/src/service/channel/feishu_im.py` · Test: `apps/server/tests/test_feishu_im.py`

- [ ] **Step 1: 写测试（mock lark-oapi client）**

`FeishuIMService.send_text(chat_id, text)` 构造 lark-oapi IM create request 并调 client；测试 mock client 断言被调、参数含 chat_id/text。具体 request 构造照 Phase 0 spike 实测的 API。

- [ ] **Step 2–4: 实现 + 通过**

用 spike 验证过的 `client.im.v1.message.create(...)`（`receive_id_type="chat_id"`，`msg_type="text"`，`content=json.dumps({"text": text})`）。client 由 lark-oapi `lark.Client.builder().app_id(...).app_secret(...).build()` 构造（SDK 自管 token，**不**碰 feishu_token_service）。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/channel/feishu_im.py apps/server/tests/test_feishu_im.py
git commit -m "feat(channel): FeishuIMService 出站发消息（lark-oapi SDK 自管 token）"
```

### Task 6.2：FeishuChannel.on_message（入站编排，可单测核心逻辑）

**Files:** Create: `apps/server/src/service/channel/feishu_channel.py` · Test: `apps/server/tests/test_feishu_channel.py`

- [ ] **Step 1: 写失败测试（mock 掉 SDK/IM/registry/inject，单测纯编排逻辑）**

把 on_message 的"业务编排"抽成可测的 `handle_inbound(db, msg: InboundMessage)`，覆盖：
- 未授权 open_id → `send_ack` 发"未授权"、不注入、不建 inbox。
- 已授权 + 会话忙碌（`registry.is_active=True`）→ 发"总管正忙"、写 `inbox(status=rejected)`、不注入。
- 已授权 + 空闲 → `resolve_active_curator_conversation` 命中 → `inject_curator_instruction` 被调、写 `inbox(status=acked)`、`send_ack` 发"收到"。
- 重复 event_id → `record_event` 返回 None → 不重复处理。
用 monkeypatch 替换 `registry`、`inject_curator_instruction`、`resolve_active_curator_conversation`、self 的 send_ack。

- [ ] **Step 2–3: 实现 FeishuChannel**

```python
# src/service/channel/feishu_channel.py（核心编排骨架）
class FeishuChannel(Channel):
    name = "feishu"

    def __init__(self, app_id, app_secret, whitelist: set[str]):
        self._whitelist = whitelist
        self._im = FeishuIMService(app_id, app_secret)
        self._ws = None  # lark-oapi ws.Client，Step Task6.3 接

    def is_authorized(self, uid): return uid in self._whitelist
    def send_ack(self, chat_id, text): self._im.send_text(chat_id, text)
    def send_report(self, chat_id, report): self._im.send_text(chat_id, report)

    def handle_inbound(self, db, msg: InboundMessage) -> None:
        if not self.is_authorized(msg.external_user_id):
            self.send_ack(msg.external_chat_id, "未授权"); return
        from src.service.channel import inbox_service
        from src.service.channel.resolve import resolve_active_curator_conversation
        from src.service.agent.orchestrator.curator_injection import inject_curator_instruction
        from src.service.stream_registry import registry

        # 先占坑去重（避免重投并发）：先 resolve 会话拿 workspace/conv，再 record_event
        conv = resolve_active_curator_conversation(db)
        # 主 loop 内做权威忙碌检查 + 注入；ACK 同步发
        if registry.is_active(conv.id):
            inbox_service.record_event(db, channel="feishu",
                external_event_id=msg.external_event_id, external_user_id=msg.external_user_id,
                external_chat_id=msg.external_chat_id, workspace_id=conv.workspace_id,
                conversation_id=conv.id, text=msg.text, status="rejected")
            self.send_ack(msg.external_chat_id, "⏳ 总管正忙，待会再试"); return

        row = inbox_service.record_event(db, channel="feishu",
            external_event_id=msg.external_event_id, external_user_id=msg.external_user_id,
            external_chat_id=msg.external_chat_id, workspace_id=conv.workspace_id,
            conversation_id=conv.id, text=msg.text, status="acked")
        if row is None:
            return  # 重复事件
        try:
            user_mid, asst_mid = inject_curator_instruction(db, conv, msg.text, source="feishu")
        except Exception:
            inbox_service.mark(db, row, "failed")
            self.send_ack(msg.external_chat_id, "❌ 启动失败，请稍后重试")
            raise
        inbox_service.mark(db, row, "running",
                           user_message_id=user_mid, assistant_message_id=asst_mid)
        self.send_ack(msg.external_chat_id, "✅ 收到，已开始执行")
```
> ⚠️ **线程归属**：真正的 `handle_inbound` 调用必须经 `call_soon_threadsafe` 投回主 loop（见 Task 6.3），且在主 loop 闭包内新开 DB session。忙碌检查、注入都在主 loop（防 TOCTOU）。ACK/report 是纯 HTTP，可同步发。
>
> ⚠️ **会话绑定 plan_run_id（回填时机，已在 Task 5.1 处理）**：`handle_inbound` 注入后 inbox 是 `running`/`acked` 但 `plan_run_id=None`。**回填发生在 ChannelManager 收到 `conversation_status_changed(idle)` 时**（那一刻总管流已结束、PlanRun 已存在但还没 settle）——用 `resolve_latest_run_id_by_conversation` 查到 run_id 回填、保持 running、不回执；等 `plan_run_settled` 再按 plan_run_id 命中回执。Task 6.2 不需要自己回填，只要把 inbox 置 `running` 即可。

- [ ] **Step 4: 确认通过 → Step 5: 提交**

```bash
git add apps/server/src/service/channel/feishu_channel.py apps/server/src/service/channel/resolve.py apps/server/tests/test_feishu_channel.py
git commit -m "feat(channel): FeishuChannel.handle_inbound（去重/授权/忙碌兜底/注入/ACK）"
```

> 附带 Task：`resolve_active_curator_conversation(db)`（放 `src/service/channel/resolve.py`）：
> ```python
> def resolve_active_curator_conversation(db):
>     from sqlalchemy import select
>     from src.models.conversation import Conversation
>     conv = db.scalars(select(Conversation)
>         .where(Conversation.target_type == "curator")
>         .order_by(Conversation.updated_at.desc())).first()
>     if conv is not None:
>         return conv
>     # fallback：ensure 默认工作空间总管会话
>     from src.service.chat_service import ChatService
>     from src.service.workspace_service import WorkspaceService
>     ws = WorkspaceService.ensure_default_workspace(db)  # 已核实存在（非 get_active_or_default）
>     read = ChatService.ensure_curator_conversation(db, ws.user_id, ws.id)  # ws.user_id 可能为 None，OK
>     return db.get(Conversation, read.id)
> ```
> 单独写 `test_resolve.py` 覆盖：① 有 curator 会话 → 取 `updated_at` 最近；② 无会话 → 走 fallback（含 `ws.user_id=None` 分支，断言返回的会话 `target_type=="curator"`）。

### Task 6.3：lark-oapi ws 接线 + 启动护栏

**Files:** Modify: `apps/server/src/service/channel/feishu_channel.py`

- [ ] **Step 1: 实现 start()/stop()**

`start()`：按 spike 范式构造 `lark.ws.Client(app_id, app_secret, event_handler=...)`，事件 handler 把 SDK event → `InboundMessage` → `_get_main_loop().call_soon_threadsafe(lambda: self._dispatch_on_main(msg))`；`_dispatch_on_main` 新开 `get_session_local()()` 调 `handle_inbound`。在后台线程跑 ws client（`client.start()` 阻塞 → 用 `threading.Thread(daemon=True)`）。
`stop()`：停 ws client / 置标志。

- [ ] **Step 2: 手动验证**（接 Phase 7 一并冒烟，无单测）

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/service/channel/feishu_channel.py
git commit -m "feat(channel): FeishuChannel lark-oapi ws 长连接接线 + 主 loop 投递"
```

---

## Phase 7：接线 server.py + 冒烟

### Task 7.1：ChannelManager 启停 + 注册 FeishuChannel

**Files:** Modify: `apps/server/src/server.py:259/268`

- [ ] **Step 1: 实现接线**

在 `TaskSchedulerService.start()` 附近：
```python
from src.service.channel.manager import manager as channel_manager
from src.service.channel.feishu_channel import FeishuChannel
from src.core.config import get_settings
from src.core.runtime_capabilities import get_capabilities

# 启动护栏（分级）
_s = get_settings()
if get_capabilities().feishu_platform and _s.feishu_app_id and _s.feishu_app_secret \
        and _s.feishu_channel_enabled:
    wl = _parse_whitelist(_s.feishu_whitelist_open_ids)  # 空集合也启动（全拒答）
    if not wl:
        logger.warning("飞书 channel 白名单为空，所有飞书消息将被拒答")
    channel_manager.register(FeishuChannel(_s.feishu_app_id, _s.feishu_app_secret, wl))
    channel_manager.start()
```
`yield` 后、`TaskSchedulerService.shutdown()` 附近加 `channel_manager.stop()`。

- [ ] **Step 2: 类型检查 + 启动验证**

Run: `cd apps/server && uv run python -m pytest tests/ -q`
Expected: 全绿（或仅既有失败，无新增）。
Run（能起来不报错）: `cd apps/server && uv run python -c "from src.server import create_app; create_app()"`
Expected: 无 import / 接线错误。

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/server.py
git commit -m "feat(channel): lifespan 启停 ChannelManager + 注册 FeishuChannel（分级护栏）"
```

### Task 7.2：端到端冒烟（HUMAN GATE）

- [ ] 配 `FEISHU_APP_ID/SECRET/CHANNEL_ENABLED=true/WHITELIST_OPEN_IDS=<本人 open_id>`，启动后端。
- [ ] 白名单号私聊机器人："帮我整理一份今天的日报" → 收到 `✅ 收到` → 稍后收到结构化报告（纯对话或编排轮）。
- [ ] 非白名单号私聊 → 收到 `未授权`。
- [ ] 桌面端该总管会话里直接敲一条 → 正常执行、**不**回飞书（无 inbox 行）。
- [ ] 会话正跑流时飞书再发一条 → 收到 `⏳ 总管正忙，待会再试`。
- [ ] 飞书消息在桌面端对应会话里带**飞书徽标**（前端按 inbox `user_message_id` 渲染——前端改动若超出后端范围，另立前端任务）。
- [ ] 跑编排轮中途重启后端 → 重启对账回 `执行被中断`。

---

## 完成判据

- Phase 1–7 全部 Task 的单测通过；`cd apps/server && uv run python -m pytest tests/ -q` 无新增失败。
- 冒烟清单全过。
- 前端"飞书徽标"渲染若需改前端，作为后续独立任务（本计划聚焦后端）。

## 后续（不在本计划）

- 飞书 interactive card 富报告（起步文本）。
- 定时轮结果自动推飞书（给定时轮打 source）。
- 总管主动发飞书富消息 → lark-cli skill。
- 前端：飞书来源消息徽标渲染（读 ChannelInbox / extra_meta）。
