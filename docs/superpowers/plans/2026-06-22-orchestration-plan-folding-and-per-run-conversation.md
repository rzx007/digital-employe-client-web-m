# 编排计划折叠 + 每轮新会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让总管的递归编排每次触发开一个全新总管会话作汇报落点（不污染主对话），并把「今日任务」面板上一个编排计划的多个子任务折叠成一行；侧栏把这些每轮会话归到独立的「定时任务」分组。

**Architecture:** 三块——A 后端：`PlanRun` 加 `conversation_id` 列；`run_plan_job` 每轮新建 curator 会话并把它作显式 `orchestrator_conversation_id` 透传给整条派单链（root + 后继），子任务日志和再入汇报自动落到本轮会话；交互式 manual run 把 `run.conversation_id` 写成 `plan.conversation_id` 保持现状。B 今日任务：后端按 `orchestration_plan_id` 聚合，独立任务不动；前端 plan 行直接打开 curator 会话。C 侧栏：暴露 `session_flags` 字段，前端把 `kind=scheduled_run` 会话分到「定时任务」可折叠分组，进去走只读视图。

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2.x / pytest（内存 SQLite，`db_session` fixture）/ React 19 / TanStack Query / TypeScript / Vite。

**Spec:** [docs/superpowers/specs/2026-06-22-orchestration-plan-folding-and-per-run-conversation-design.md](../specs/2026-06-22-orchestration-plan-folding-and-per-run-conversation-design.md)

---

## 关键约定（动手前必读）

- **工作目录**：后端路径相对 `apps/server/`；前端路径相对 `apps/web/`。
- **跑测试**：后端 `cd apps/server && uv run pytest <path> -v`，全量 `uv run pytest -q`。前端 typecheck `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`（参考记忆里 spec 测试约定）；前端单测 `cd apps/web && pnpm test -- <path>`。
- **测试基线**：开工前 `cd apps/server && uv run pytest -q` 应是 `1 failed, 975 passed`（pre-existing `tests/test_workspace_crud_userlevel.py::test_create_user_workspace_empty`）。每个 Task 完成后只允许新增 passed、零新增 failed。
- **不破坏现有定时递归编排** ([scheduled-recurring-orchestration spec](../specs/2026-06-22-scheduled-recurring-orchestration-design.md))：本特性是它的增量优化，所有变更保持向后兼容（PlanRun.conversation_id 可空、orchestrator_conversation_id 覆盖参可选）。
- **不破坏前端正在并行进行的 curator/slash-command 工作**：只动本特性涉及的文件，提交前 `git status` 看一眼。
- **DB 迁移**：新列由 `_ensure_orchestration_recurring_columns`（[init_db.py](../../../apps/server/src/db/init_db.py)）幂等 ALTER 加列。测试用内存库自动 `create_all`，无需手工迁移。
- **测试风格**：照已有 [tests/test_scheduled_recurring_orchestration.py](../../../apps/server/tests/test_scheduled_recurring_orchestration.py) ——`db_session` fixture、`_seed_ws_plan` helper、`_NoCloseSession` 屏蔽 `close()`、`monkeypatch` 替换 `get_session_local`。
- **subagent 提交时**：用显式 `git add <文件>` 列文件名，禁用 `git add -A` / `git add .`（仓库有并行未提交的前端 WIP 文件，不能误带）。提交消息结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## 文件结构总览

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/models/plan_run.py` | 加 `conversation_id` FK 列 | 改 |
| `src/db/init_db.py` | `_ensure_orchestration_recurring_columns` 追加 plan_runs.conversation_id 的 ALTER | 改 |
| `src/service/orchestrator_conversation_links.py` | `resolve_orchestrator_conversation_id` 不动（覆盖逻辑在调用端） | 不改 |
| `src/service/agent/orchestrator/execution.py` | start_immediate_tasks / start_task_as_conversation 加 `orchestrator_conversation_id` 覆盖；execute_plan 给 manual run 写 conversation_id | 改 |
| `src/service/agent/orchestrator/dependency_scheduler.py` | on_employee_task_completed 取 PlanRun.conversation_id；_dispatch_successor 加 keyword 转发 | 改 |
| `src/service/task_scheduler_service.py` | run_plan_job 建每轮会话、种 user_input、写 run.conversation_id、透传 orch_conv | 改 |
| `src/service/task_service.py` | list_today_tasks 按 plan 聚合 | 改 |
| `src/schemas/task.py` | TodayTaskRead 加 is_plan / plan_id / run_seq | 改 |
| `src/schemas/conversation.py` | ConversationRead 加 session_flags | 改 |
| `apps/web/src/types/schedule-monitor.ts` | TodayTask interface 加 3 字段 | 改 |
| `apps/web/src/types/chat.ts` | Conversation interface 加 sessionFlags | 改 |
| `apps/web/src/api/types.ts` | ConversationListItemDto 加 session_flags | 改 |
| `apps/web/src/lib/chat/chat-mappers.ts` | mapConversationListItemToConversation / mapCreatedConversationListItem 透传 session_flags | 改 |
| `apps/web/src/components/workbench/today-task-list.tsx` | plan 行按 is_plan 走 curator 选会话路径，不走 navigateToEmployeeFromCurator | 改 |
| `apps/web/src/components/chat/conversations/conversation-list.tsx` | 分桶 scheduled_run 会话 + 末尾可折叠「定时任务」分组 | 改 |
| `apps/web/src/components/chat/views/chat-view.tsx` + `views/curator-view.tsx` | CuratorView 接 readOnly prop；chat-view 根据当前会话 session_flags.kind == "scheduled_run" 透传 readOnly | 改 |
| `tests/test_scheduled_recurring_orchestration.py` | 追加本特性测试（后端） | 改 |
| `tests/test_today_tasks_folding.py`（新）| 后端 list_today_tasks 聚合单测 | 新建 |

---

## Task 1: PlanRun.conversation_id 列 + 迁移

**Files:**
- Modify: `src/models/plan_run.py`
- Modify: `src/db/init_db.py`（`_ensure_orchestration_recurring_columns`）
- Test: `tests/test_scheduled_recurring_orchestration.py`（APPEND）

- [ ] **Step 1: 写失败测试（schema 存在性）**

APPEND 到 `tests/test_scheduled_recurring_orchestration.py`：

```python
def test_plan_run_has_conversation_id_column():
    from src.models.plan_run import PlanRun
    assert "conversation_id" in PlanRun.__table__.columns
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py::test_plan_run_has_conversation_id_column -v`
Expected: FAIL（列不存在）。

- [ ] **Step 3: 加列**

`src/models/plan_run.py`，在 `ended_at` 列附近加：

```python
    # 该轮专属总管会话（scheduled 轮新建；manual 轮 = plan.conversation_id）。SET NULL 防级联。
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
```

`src/db/init_db.py` 的 `_ensure_orchestration_recurring_columns(engine)` 函数里，仿照同函数对 `task_execution_logs.run_id` 的处理，加 plan_runs.conversation_id 的 ALTER。先 `pr_cols = {c["name"] for c in insp.get_columns("plan_runs")}`，再：

```python
        if "conversation_id" not in pr_cols:
            conn.execute(text("ALTER TABLE plan_runs ADD COLUMN conversation_id INTEGER"))
            logger.info("added column plan_runs.conversation_id")
```

放在已有 ALTER 的同 `with engine.begin() as conn:` 块内。

- [ ] **Step 4: 跑通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py::test_plan_run_has_conversation_id_column -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd "D:\code\company\digital-employe-client-web-main"
git add apps/server/src/models/plan_run.py apps/server/src/db/init_db.py apps/server/tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): PlanRun.conversation_id 列 + 迁移

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 派单链 `orchestrator_conversation_id` 覆盖参数 + on_employee_task_completed 取本轮会话

**Files:**
- Modify: `src/service/agent/orchestrator/execution.py`（`start_immediate_tasks`、`start_task_as_conversation`）
- Modify: `src/service/agent/orchestrator/dependency_scheduler.py`（`_dispatch_successor`、`on_employee_task_completed`）
- Test: `tests/test_scheduled_recurring_orchestration.py`（APPEND）

- [ ] **Step 1: 写失败测试（覆盖参生效 + 下游用本轮会话）**

APPEND：

```python
def test_start_task_explicit_orch_conv_overrides_default(db_session, monkeypatch):
    """显式 orchestrator_conversation_id 直接生效，不再 fallback 到 task.source_conversation_id。"""
    import src.service.agent.orchestrator.execution as ex
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from sqlalchemy import select as _select

    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    # 计划创建源会话
    src_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="原")
    # 本轮专属会话
    run_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="本轮")
    db_session.add_all([src_conv, run_conv]); db_session.flush()
    plan.conversation_id = src_conv.id; db_session.commit()
    task = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                       execute_mode="immediate", orchestration_plan_id=plan.id,
                       user_prompt="a", source_conversation_id=src_conv.id)
    db_session.add(task); db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()

    # 截 stream 启动：只关心日志的 orchestrator_conversation_id 落到哪
    monkeypatch.setattr(ex, "get_main_loop", lambda: type("L", (), {"call_soon_threadsafe": lambda self, fn: None})())
    monkeypatch.setattr(ex, "get_agent", lambda *a, **k: object())
    monkeypatch.setattr(ex, "resolve_output_tokens", lambda t: 1024)
    monkeypatch.setattr("src.service.product_paths.resolve_conversation_product_root", lambda db, c: "/tmp")
    monkeypatch.setattr("src.service.stream_registry.registry.can_admit", lambda cls: True)

    ex.start_task_as_conversation(
        db_session, task, emp, ws.id,
        run_id=run.id,
        orchestrator_conversation_id=run_conv.id,
    )
    log = db_session.scalars(_select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id)).first()
    assert log is not None and log.orchestrator_conversation_id == run_conv.id  # 用了本轮会话
    # 模板 task.source_conversation_id 不被改写
    db_session.refresh(task)
    assert task.source_conversation_id == src_conv.id


def test_on_employee_task_completed_dispatches_downstream_with_run_conversation(db_session, monkeypatch):
    """下游派发也走本轮 PlanRun.conversation_id（不走 task.source_conversation_id fallback）。"""
    import src.service.agent.orchestrator.dependency_scheduler as ds
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.agent.orchestrator.plan_run_service import open_plan_run

    proxy = _NoCloseSession(db_session)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: proxy))
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    src_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="原")
    run_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="本轮")
    db_session.add_all([src_conv, run_conv]); db_session.flush()
    plan.conversation_id = src_conv.id; db_session.commit()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     orchestration_plan_id=plan.id, source_conversation_id=src_conv.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     orchestration_plan_id=plan.id, source_conversation_id=src_conv.id, user_prompt="b")
    db_session.add_all([A, B]); db_session.commit()

    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    run.conversation_id = run_conv.id; db_session.commit()

    dispatched_orch_conv = []
    monkeypatch.setattr(ds, "_dispatch_successor",
        lambda db, t, e, w, brief, run_id, *, stream_class=None, orchestrator_conversation_id=None:
            dispatched_orch_conv.append(orchestrator_conversation_id))
    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    # A 本轮 success + accepted → 触发 on_employee_task_completed(A)
    db_session.add(TaskExecutionLog(task_id=A.id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="A", run_status="success", run_result="ok", input_json="{}",
        output_json="{}", started_at=cst_now(), run_id=run.id,
        qa_accepted_at=cst_now(), orchestrator_conversation_id=run_conv.id))
    db_session.commit()
    ds.on_employee_task_completed(A.id, ws.id)
    # B 被派、orch_conv 是本轮会话
    assert dispatched_orch_conv == [run_conv.id]
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k "explicit_orch_conv or dispatches_downstream_with_run_conversation" -v`
Expected: FAIL（kwarg 不存在 / 下游不带本轮 orch_conv）。

- [ ] **Step 3: 改 `start_task_as_conversation` 签名 + 覆盖逻辑**

`src/service/agent/orchestrator/execution.py`（~line 232），给 `start_task_as_conversation` 加一个 keyword 参 `orchestrator_conversation_id: int | None = None`：

```python
def start_task_as_conversation(
    db: Session,
    task: EmployeeTask,
    employee: Employee,
    workspace_id: int,
    *,
    priority: int = ORCHESTRATION_PRIORITY,
    source: str = "orchestration",
    prereq_briefing: str = "",
    stream_class: str | None = None,
    run_id: int | None = None,
    orchestrator_conversation_id: int | None = None,
) -> int:
```

在函数体里，`orch_conv_id = resolve_orchestrator_conversation_id(db, task)` 这一行改成：

```python
    if orchestrator_conversation_id is not None:
        orch_conv_id = orchestrator_conversation_id
    else:
        orch_conv_id = resolve_orchestrator_conversation_id(db, task)
```

紧跟其后的 `if task.source_conversation_id is None and orch_conv_id is not None: task.source_conversation_id = orch_conv_id` 这一段**只在没有显式覆盖时执行**——把它包成 `if orchestrator_conversation_id is None and task.source_conversation_id is None and orch_conv_id is not None:`，避免显式覆盖污染模板。

- [ ] **Step 4: `start_immediate_tasks` 透传**

同文件 `start_immediate_tasks`（~line 161），签名加 `orchestrator_conversation_id: int | None = None`，把它转给 `start_task_as_conversation(...)` 的对应 kwarg。

- [ ] **Step 5: `_dispatch_successor` 加 keyword 转发**

`src/service/agent/orchestrator/dependency_scheduler.py`（~line 602），把 `_dispatch_successor` 签名末尾加 keyword：

```python
def _dispatch_successor(db, task, employee, workspace_id, prereq_briefing, run_id, *,
                       stream_class=None, orchestrator_conversation_id=None) -> int:
    from src.service.agent.orchestrator.execution import start_task_as_conversation
    return start_task_as_conversation(
        db, task, employee, workspace_id,
        prereq_briefing=prereq_briefing, stream_class=stream_class, run_id=run_id,
        orchestrator_conversation_id=orchestrator_conversation_id,
    )
```

- [ ] **Step 6: `on_employee_task_completed` 取 PlanRun.conversation_id 传给下游**

同文件 `on_employee_task_completed`（~line 393）。函数体内已有 `run_id = latest_run_id_for_task(db, task_id)` 推导。在派下游分支调用 `_dispatch_successor` 之前，再取一次该 run 的 `conversation_id`：

在函数体上方 imports 里加 `from src.service.agent.orchestrator.plan_run_service import latest_run_id_for_task, settle_plan_run` 之外，引入 `PlanRun`：
```python
        from src.models.plan_run import PlanRun
        run_conv_id = None
        if run_id is not None:
            _r = db.get(PlanRun, run_id)
            run_conv_id = _r.conversation_id if _r else None
```
（紧接 run_id 推导后即可）。

派发循环中，把 `_dispatch_successor(db, t, employee, workspace_id, briefing, run_id, stream_class=cls_by_id.get(cid))` 改成：

```python
                _dispatch_successor(
                    db, t, employee, workspace_id, briefing, run_id,
                    stream_class=cls_by_id.get(cid),
                    orchestrator_conversation_id=run_conv_id,
                )
```

- [ ] **Step 7: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k "explicit_orch_conv or dispatches_downstream_with_run_conversation" -v`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/execution.py apps/server/src/service/agent/orchestrator/dependency_scheduler.py apps/server/tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): 派单链加 orchestrator_conversation_id 覆盖参 + 下游用本轮会话

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: execute_plan 给 manual run 写 conversation_id

**Files:**
- Modify: `src/service/agent/orchestrator/execution.py`（`execute_plan` ~line 127）
- Test: `tests/test_scheduled_recurring_orchestration.py`（APPEND）

- [ ] **Step 1: 写失败测试**

APPEND：

```python
def test_execute_plan_manual_run_writes_conversation_id_from_plan(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.plan_run import PlanRun
    from sqlalchemy import select as _select
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="源")
    db_session.add(conv); db_session.flush()
    plan.conversation_id = conv.id; db_session.commit()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])
    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    ex.execute_plan(db_session, plan, ws.id)
    run = db_session.scalars(_select(PlanRun).where(PlanRun.plan_id == plan.id)).first()
    assert run is not None and run.trigger == "manual" and run.conversation_id == conv.id
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k execute_plan_manual_run_writes_conversation -v`
Expected: FAIL（run.conversation_id 仍是 NULL）。

- [ ] **Step 3: 改 execute_plan**

`src/service/agent/orchestrator/execution.py`，在 `execute_plan` 里、`open_plan_run(...)` 返回后、`start_immediate_tasks(...)` 之前，把现在的：

```python
    if immediate_tasks:
        from src.service.agent.orchestrator.plan_run_service import open_plan_run
        run = open_plan_run(db, plan.id, workspace_id, trigger="manual", auto_accept=False)
        db.commit()
        results += start_immediate_tasks(db, immediate_tasks, plan, workspace_id, run_id=run.id)
```

改成：

```python
    if immediate_tasks:
        from src.service.agent.orchestrator.plan_run_service import open_plan_run
        run = open_plan_run(db, plan.id, workspace_id, trigger="manual", auto_accept=False)
        # manual run 把 PlanRun.conversation_id 写成 plan.conversation_id（创建源），
        # 让 Part B 的 today-task 折叠行可以统一从 PlanRun.conversation_id 取链接。
        if plan.conversation_id is not None:
            run.conversation_id = plan.conversation_id
        db.commit()
        results += start_immediate_tasks(
            db, immediate_tasks, plan, workspace_id, run_id=run.id,
            orchestrator_conversation_id=run.conversation_id,
        )
```

> 这里也把 `orchestrator_conversation_id=run.conversation_id` 透传——manual 计划的 root 任务日志的 orch_conv 用 run.conversation_id（等于 plan.conversation_id，与现状等价），但走的是新的显式覆盖路径，统一行为。

- [ ] **Step 4: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k execute_plan_manual_run_writes_conversation -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/agent/orchestrator/execution.py apps/server/tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): manual run 写 conversation_id = plan.conversation_id

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: run_plan_job 每轮新建 curator 会话 + 种 user_input + 透传 orch_conv

**Files:**
- Modify: `src/service/task_scheduler_service.py`（`run_plan_job` ~line 582）
- Test: `tests/test_scheduled_recurring_orchestration.py`（APPEND）

- [ ] **Step 1: 写失败测试**

APPEND：

```python
def test_run_plan_job_creates_per_run_conversation_and_seeds_user_input(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.conversation import Conversation, ConversationMessage
    from src.models.employee_task import EmployeeTask
    from src.models.plan_run import PlanRun
    from sqlalchemy import select as _select
    from sqlalchemy.orm import sessionmaker
    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True
    plan.plan_json = '[{"depends_on": null}]'
    plan.user_input = "每2分钟查热搜并总结成文档"
    db_session.commit()
    # 必须先有 curator employee
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="热搜", employee_code="hot", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()
    plan_id = plan.id

    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    seen = {}
    monkeypatch.setattr(ex, "start_immediate_tasks",
        lambda db, tasks, plan, ws_id, run_id, orchestrator_conversation_id=None:
            seen.setdefault("orch_conv", orchestrator_conversation_id) or [])

    tss.TaskSchedulerService.run_plan_job(plan_id)

    with sf() as d:
        run = d.scalars(_select(PlanRun).where(PlanRun.plan_id == plan_id)).first()
        assert run is not None and run.conversation_id is not None
        conv = d.get(Conversation, run.conversation_id)
        assert conv is not None
        assert conv.target_type == "curator"
        # session_flags 标记
        import json
        flags = json.loads(conv.session_flags or "{}")
        assert flags.get("kind") == "scheduled_run"
        assert flags.get("plan_id") == plan_id
        assert flags.get("run_seq") == run.run_seq
        # 种 user_input 消息
        msgs = list(d.scalars(_select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conv.id)).all())
        assert any(m.role == "user" and "每2分钟查热搜并总结成文档" in (m.content or "") for m in msgs)
    # orch_conv 透传到派单链
    assert seen.get("orch_conv") == run.conversation_id
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k creates_per_run_conversation -v`
Expected: FAIL。

- [ ] **Step 3: 改 run_plan_job**

`src/service/task_scheduler_service.py`，把 `run_plan_job` 改成（替换现有方法体，保持类方法签名）：

```python
    @classmethod
    def run_plan_job(cls, plan_id: int) -> None:
        """递归计划到点：每轮新建 curator 会话作汇报落点，重跑冻结 DAG 根任务。

        绝不调 _start_curator_task / 不重发总管消息 / 不重新分析分单。
        """
        import json
        from src.models.conversation import Conversation, ConversationMessage
        from src.models.orchestration_plan import OrchestrationPlan
        from src.service.agent.orchestrator.execution import start_immediate_tasks
        from src.service.agent.orchestrator.plan_run_service import open_plan_run
        from src.service.employee_service import EmployeeService

        with get_session_local()() as db:
            plan = db.get(OrchestrationPlan, plan_id)
            if plan is None or plan.status != "confirmed" or not (plan.cron or "").strip():
                return
            tasks = list(db.scalars(
                select(EmployeeTask).where(
                    EmployeeTask.orchestration_plan_id == plan_id,
                    EmployeeTask.is_active.is_(True),
                ).order_by(EmployeeTask.priority.desc(), EmployeeTask.id.asc())
            ).all())
            if not tasks:
                return

            run = open_plan_run(db, plan_id, plan.workspace_id, trigger="scheduled", auto_accept=True)
            db.commit()

            # —— 建本轮专属 curator 会话 + 种 plan.user_input ——
            try:
                ws = db.get(Workspace, plan.workspace_id)
                user_id = ws.user_id if ws is not None else DEFAULT_USER_ID
                curator = EmployeeService.ensure_curator_employee(db, user_id, plan.workspace_id)
                # 标题：user_input 截断 30 字 + 第N轮
                summary = (plan.user_input or "").strip().replace("\n", " ")
                if len(summary) > 30:
                    summary = summary[:30] + "…"
                title = f"「{summary}」· 第{run.run_seq}轮"
                flags = json.dumps(
                    {"kind": "scheduled_run", "plan_id": plan_id, "run_seq": run.run_seq},
                    ensure_ascii=False,
                )
                run_conv = Conversation(
                    workspace_id=plan.workspace_id,
                    user_id=user_id,
                    target_type="curator",
                    target_id=curator.id,
                    title=title,
                    session_flags=flags,
                )
                db.add(run_conv); db.flush()
                # 种 user_input 消息：作为本轮会话上下文
                db.add(ConversationMessage(
                    conversation_id=run_conv.id,
                    role="user",
                    content=plan.user_input or title,
                    stream_state="completed",
                ))
                run.conversation_id = run_conv.id
                db.commit()
            except Exception:
                logger.error("run_plan_job 建本轮会话失败 plan=%s run=%s", plan_id, run.id, exc_info=True)
                run.status = "failed"
                run.ended_at = cst_now()
                db.commit()
                return

            try:
                start_immediate_tasks(
                    db, tasks, plan, plan.workspace_id, run_id=run.id,
                    orchestrator_conversation_id=run.conversation_id,
                )
            except Exception:
                logger.error("run_plan_job 派发失败 plan=%s run=%s", plan_id, run.id, exc_info=True)
                run.status = "failed"
                run.ended_at = cst_now()
                db.commit()
            plan.last_run_at = cst_now()
            plan.next_run_at = TaskService.compute_next_run(plan.cron, now=plan.last_run_at)
            db.commit()
            logger.info("递归计划到点 plan=%s run_seq=%s conv=%s（绕开总管重分析）",
                        plan_id, run.run_seq, run.conversation_id)
```

注意：`ConversationMessage` 模型已在别处使用（参考 `_start_curator_task`），路径 `src.models.conversation`。

- [ ] **Step 4: 跑确认通过**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k creates_per_run_conversation -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/service/task_scheduler_service.py apps/server/tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): run_plan_job 每轮新建 curator 会话 + 种 user_input + 透传 orch_conv

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: TodayTaskRead DTO 扩展 + 前端类型

**Files:**
- Modify: `src/schemas/task.py`（`TodayTaskRead` ~line 167）
- Modify: `apps/web/src/types/schedule-monitor.ts`（`TodayTask` ~line 163）
- Test: `tests/test_scheduled_recurring_orchestration.py`（APPEND，schema 存在性）

- [ ] **Step 1: 写失败测试**

APPEND：

```python
def test_today_task_read_has_plan_fields():
    from src.schemas.task import TodayTaskRead
    fields = TodayTaskRead.model_fields
    assert "is_plan" in fields and "plan_id" in fields and "run_seq" in fields
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py::test_today_task_read_has_plan_fields -v`
Expected: FAIL。

- [ ] **Step 3: 改 DTO**

`apps/server/src/schemas/task.py`，在 `TodayTaskRead` 末尾加：

```python
    is_plan: bool = False
    plan_id: int | None = None
    run_seq: int | None = None
```

- [ ] **Step 4: 前端 TodayTask interface 同步**

`apps/web/src/types/schedule-monitor.ts`，给 `TodayTask` interface 加 3 字段（位置在末尾即可）：

```typescript
  is_plan?: boolean
  plan_id?: number | null
  run_seq?: number | null
```

- [ ] **Step 5: 跑确认通过 + 前端 typecheck**

```bash
cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py::test_today_task_read_has_plan_fields -v
cd ../web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | head -20
```
后端：PASS。前端 typecheck：与基线相比零新增错误（基线即记忆里 ~90 预存错；只看 diff signature 即可）。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/schemas/task.py apps/server/tests/test_scheduled_recurring_orchestration.py apps/web/src/types/schedule-monitor.ts
git commit -m "feat(orch): TodayTaskRead 加 is_plan/plan_id/run_seq + 前端类型

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: list_today_tasks 按 plan 聚合 + 前端 plan 行路由

**Files:**
- Modify: `src/service/task_service.py`（`list_today_tasks` ~line 347）
- Modify: `apps/web/src/components/workbench/today-task-list.tsx`（plan 行不走 navigateToEmployeeFromCurator）
- Test: 新建 `tests/test_today_tasks_folding.py`

- [ ] **Step 1: 写失败测试**

新建 `apps/server/tests/test_today_tasks_folding.py`：

```python
"""list_today_tasks 按 plan 聚合的单测。"""
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now
from src.service.agent.orchestrator.plan_run_service import open_plan_run
from src.service.task_service import TaskService


def _seed_plan_two_tasks(db: Session):
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db.add(ws); db.flush()
    plan = OrchestrationPlan(
        workspace_id=ws.id, conversation_id=1, user_input="每2分钟查热搜并总结成文档",
        plan_json='[{"depends_on": null}, {"depends_on": [0]}]', status="confirmed",
        total_tasks=2, cron="*/2 * * * *", is_recurring=True,
    )
    db.add(plan); db.flush()
    emp = Employee(workspace_id=ws.id, name="emp", employee_code="c"); db.add(emp); db.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="获取热搜",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="总结成文档",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="b")
    db.add_all([A, B]); db.commit()
    return ws, plan, emp, A, B


def _log(db, task, ws_id, emp_id, status, run_id):
    db.add(TaskExecutionLog(
        task_id=task.id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot=task.task_name, run_status=status, run_result="r",
        input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id,
    ))
    db.commit()


def test_plan_subtasks_fold_into_single_row(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    run.conversation_id = 999; db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "success", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    plan_rows = [i for i in items if i.get("is_plan")]
    assert len(plan_rows) == 1
    row = plan_rows[0]
    assert row["plan_id"] == plan.id
    assert row["run_seq"] == run.run_seq
    assert row["task_name"].startswith("每2分钟查热搜并总结成文档")
    assert row["run_status"] == "success"
    assert row["conversation_id"] == 999
    # 子任务不再单独占行
    sub_rows = [i for i in items if not i.get("is_plan") and i.get("task_id") in (A.id, B.id)]
    assert sub_rows == []


def test_plan_status_running_when_any_subtask_running(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "running", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    plan_rows = [i for i in items if i.get("is_plan")]
    assert plan_rows[0]["run_status"] == "running"


def test_plan_status_failed_priority(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "failed", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    assert [i for i in items if i.get("is_plan")][0]["run_status"] == "failed"


def test_plan_status_cancelled_when_only_cancelled_no_failure(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "cancelled", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    assert [i for i in items if i.get("is_plan")][0]["run_status"] == "cancelled"


def test_standalone_task_not_affected(db_session):
    """无 orchestration_plan_id 的独立定时任务保持原样、不被聚合。"""
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="emp", employee_code="c"); db_session.add(emp); db_session.flush()
    standalone = EmployeeTask(
        workspace_id=ws.id, employee_id=emp.id, task_name="下班打卡提醒",
        execute_mode="scheduled", cron_expression="30 17 * * *",
        user_prompt="x", is_active=True,
    )
    db_session.add(standalone); db_session.commit()
    _log(db_session, standalone, ws.id, emp.id, "success", run_id=None)
    items = TaskService.list_today_tasks(db_session, ws.id)
    # 一定有这条独立任务、is_plan 不为 True
    found = [i for i in items if i.get("task_id") == standalone.id]
    assert len(found) == 1 and not found[0].get("is_plan")
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_today_tasks_folding.py -v`
Expected: 4 FAIL（聚合未实现）+ 1 standalone PASS（独立任务现状即正确）。

- [ ] **Step 3: 改 list_today_tasks 加聚合**

`apps/server/src/service/task_service.py`，在 `list_today_tasks` 现有逻辑（聚合 logs + tasks 得到 `result: list[dict]`，sort 之前）插入"按 plan 聚合"——把 `orchestration_plan_id` 非空的行从 result 中抽出来按 plan 分组重写成单行：

```python
        # === Part C: 按 orchestration_plan_id 聚合编排计划子任务 ===
        from src.models.orchestration_plan import OrchestrationPlan
        from src.models.plan_run import PlanRun

        # 现 result 里既有"已执行"也有"待执行"。先按 task_id 找回 orchestration_plan_id。
        plan_id_by_task: dict[int, int] = {}
        if executed_task_ids or {t.id for t in tasks}:
            all_task_ids = {r["task_id"] for r in result if r["task_id"]}
            if all_task_ids:
                rows = db.execute(
                    select(EmployeeTask.id, EmployeeTask.orchestration_plan_id)
                    .where(EmployeeTask.id.in_(all_task_ids), EmployeeTask.orchestration_plan_id.isnot(None))
                ).all()
                plan_id_by_task = {tid: pid for tid, pid in rows}

        if plan_id_by_task:
            # 把属于编排计划的行从 result 中抽出，按 plan_id 分组
            kept: list[dict] = []
            plan_buckets: dict[int, list[dict]] = {}
            for r in result:
                pid = plan_id_by_task.get(r["task_id"])
                if pid is None:
                    kept.append(r)
                else:
                    plan_buckets.setdefault(pid, []).append(r)

            plan_rows: list[dict] = []
            for pid, sub_rows in plan_buckets.items():
                plan = db.get(OrchestrationPlan, pid)
                if plan is None:
                    # 防御：找不到 plan 时把原始子任务行放回 kept
                    kept.extend(sub_rows)
                    continue
                # 最新一轮 run
                latest_run = db.scalars(
                    select(PlanRun).where(PlanRun.plan_id == pid)
                    .order_by(PlanRun.run_seq.desc()).limit(1)
                ).first()
                # 本轮内的子任务执行日志（不是所有今日子任务行，因为子任务行可能跨多个 run；
                # 但 today 数据天然只看今天的 log，按 run_id 过滤精确到本轮）
                run_logs: list[TaskExecutionLog] = []
                if latest_run is not None:
                    run_logs = list(db.scalars(
                        select(TaskExecutionLog).where(
                            TaskExecutionLog.run_id == latest_run.id,
                        ).order_by(TaskExecutionLog.started_at.asc())
                    ).all())

                # 聚合状态（按 §5.2 优先级）
                statuses = {(l.run_status or "") for l in run_logs}
                if statuses & {"running", "queued"}:
                    agg_status = "running"
                elif statuses & {"failed", "error", "timeout"}:
                    agg_status = "failed"
                elif "cancelled" in statuses:
                    agg_status = "cancelled"
                elif "skipped" in statuses:
                    agg_status = "skipped"
                elif statuses and statuses <= {"success", "completed"}:
                    agg_status = "success"
                else:
                    agg_status = "pending"  # 本轮无日志 / 未跑

                started_iso = None
                if run_logs:
                    earliest = min((l.started_at for l in run_logs if l.started_at), default=None)
                    started_iso = earliest.strftime("%Y-%m-%d %H:%M:%S") if earliest else None
                duration_total = sum(
                    (l.duration_ms or 0) for l in run_logs if l.ended_at and l.duration_ms
                ) or None

                # planned_at：用 plan.next_run_at 兜底（行还没跑过时）
                planned_iso = None
                if started_iso is None and plan.next_run_at is not None:
                    planned_iso = plan.next_run_at.strftime("%Y-%m-%d %H:%M:%S")

                # 标题：user_input 截断 60 字
                summary = (plan.user_input or "").strip().replace("\n", " ")
                if len(summary) > 60:
                    summary = summary[:60] + "…"

                plan_rows.append({
                    "task_id": 0,
                    "task_name": summary or f"编排计划 #{pid}",
                    "employee_id": 0,
                    "employee_name": "编排计划",
                    "cron_expression": plan.cron,
                    "execute_mode": "scheduled" if plan.is_recurring else "immediate",
                    "planned_at": planned_iso or started_iso,
                    "execution_id": None,
                    "run_status": agg_status,
                    "run_result": None,
                    "started_at": started_iso,
                    "ended_at": None,
                    "duration_ms": duration_total,
                    "conversation_id": latest_run.conversation_id if latest_run else None,
                    "is_plan": True,
                    "plan_id": pid,
                    "run_seq": latest_run.run_seq if latest_run else None,
                })

            result = kept + plan_rows
```

把这段放在原 `result.sort(...)` 之前。`is_plan`/`plan_id`/`run_seq` 字段必须存在（DTO 已加，pydantic 会补默认）。独立任务行的 `is_plan` 不显式设置——`TodayTaskRead(**item)` 转换时 `is_plan` 取默认 `False`。

- [ ] **Step 4: 前端 plan 行改路由**

`apps/web/src/components/workbench/today-task-list.tsx`，`openTaskConversation` 当前一律走 `navigateToEmployeeFromCurator`（把会话当员工执行会话深链）。plan 行的 `conversation_id` 是 curator 会话不是员工会话，必须走另一条路径：

把 `openTaskConversation` 改成：

```typescript
  const openTaskConversation = useCallback(
    (task: TodayTask) => {
      if (task.conversation_id == null) return
      if (task.is_plan) {
        // plan 折叠行：直接打开本轮 curator 会话（不走员工深链）
        selectConversationById(task.conversation_id)
        return
      }
      // 普通员工执行会话：用既有深链
      const state = useChatStore.getState()
      const curatorContact = state.contacts.find((c) => c.type === "curator")
      const curatorContactId = curatorContact ? getContactId(curatorContact) : null
      navigateToEmployeeFromCurator({
        curatorContactId: curatorContactId ?? "",
        curatorConversationId: state.workbenchCuratorConversationId ?? "",
        employeeId: String(task.employee_id),
        employeeConversationId: task.conversation_id,
      })
    },
    []
  )
```

顶部加 import：`import { selectConversationById } from "@/lib/chat/conversation-selection"`。

- [ ] **Step 5: 跑确认通过**

```bash
cd apps/server && uv run pytest tests/test_today_tasks_folding.py -v
cd ../web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail -20
```
Expected: 5 PASS（含 standalone）；typecheck 零新增错误。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/service/task_service.py apps/server/tests/test_today_tasks_folding.py apps/web/src/components/workbench/today-task-list.tsx
git commit -m "feat(orch): 今日任务按 plan 聚合折叠成一行 + 前端 plan 行直接打开总管会话

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 暴露 session_flags 到前端 DTO 链

**Files:**
- Modify: `src/schemas/conversation.py`（`ConversationRead`）
- Modify: `apps/web/src/api/types.ts`（`ConversationListItemDto`）
- Modify: `apps/web/src/types/chat.ts`（`Conversation`）
- Modify: `apps/web/src/lib/chat/chat-mappers.ts`（两个 mapper 透传）
- Test: `tests/test_scheduled_recurring_orchestration.py`（APPEND）

- [ ] **Step 1: 写失败测试**

APPEND：

```python
def test_conversation_read_exposes_session_flags():
    from src.schemas.conversation import ConversationRead
    assert "session_flags" in ConversationRead.model_fields
```

- [ ] **Step 2: 跑确认失败**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py::test_conversation_read_exposes_session_flags -v`
Expected: FAIL。

- [ ] **Step 3: 后端 DTO 加 session_flags**

`apps/server/src/schemas/conversation.py` 的 `ConversationRead` 加：

```python
    session_flags: str | None = None
```

- [ ] **Step 4: 前端 DTO + Conversation 类型透传**

`apps/web/src/api/types.ts` 的 `ConversationListItemDto` 加：
```typescript
  session_flags?: string | null
```

`apps/web/src/types/chat.ts` 的 `Conversation` interface 加：
```typescript
  sessionFlags?: string | null
```

`apps/web/src/lib/chat/chat-mappers.ts` 的两个 mapper（`mapConversationListItemToConversation` 和 `mapCreatedConversationListItem`）末尾返回对象里加：
```typescript
    sessionFlags: item.session_flags ?? undefined,
```

- [ ] **Step 5: 跑确认通过 + typecheck**

```bash
cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py::test_conversation_read_exposes_session_flags -v
cd ../web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail -20
```
Expected: PASS / 零新增 typecheck 错。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/schemas/conversation.py apps/web/src/api/types.ts apps/web/src/types/chat.ts apps/web/src/lib/chat/chat-mappers.ts apps/server/tests/test_scheduled_recurring_orchestration.py
git commit -m "feat(orch): 暴露 Conversation.session_flags 到前端 DTO 链

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 侧栏「定时任务」可折叠分组

**Files:**
- Modify: `apps/web/src/components/chat/conversations/conversation-list.tsx`
- Test：`apps/web/src/components/chat/conversations/__tests__/conversation-list-grouping.test.tsx`（新建，若有现成 RTL 测试基础设施；否则跳过单测，靠手测）

- [ ] **Step 1: 阅读现有 grouping 容错点**

先确认 `visibleConversations.map((conversation) => ...)`（[conversation-list.tsx:244](../../../apps/web/src/components/chat/conversations/conversation-list.tsx)）的结构——这里要分桶。

- [ ] **Step 2: 加分桶 helper + 渲染**

`conversation-list.tsx`，在 `visibleConversations` 计算后加：

```typescript
  // 解析 session_flags 把 scheduled_run 会话分到独立分组
  const { mainConversations, scheduledRunConversations } = useMemo(() => {
    const main: typeof visibleConversations = []
    const scheduled: typeof visibleConversations = []
    for (const c of visibleConversations) {
      let kind: string | undefined
      if (c.sessionFlags) {
        try {
          const parsed = JSON.parse(c.sessionFlags)
          if (parsed && typeof parsed === "object") {
            kind = String(parsed.kind ?? "")
          }
        } catch {
          // 非法 JSON 按普通会话处理
        }
      }
      if (kind === "scheduled_run") scheduled.push(c)
      else main.push(c)
    }
    return { mainConversations: main, scheduledRunConversations: scheduled }
  }, [visibleConversations])
```

把 line 244 那段 `visibleConversations.map(...)` 改成 `mainConversations.map(...)`。

紧跟主列表渲染之后、`activeContactId && !conversationsPending && visibleConversations.length === 0` 的空态分支之前，加分组块：

```tsx
          {scheduledRunConversations.length > 0 && (
            <details className="mt-2 rounded-md border bg-muted/30">
              <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium text-muted-foreground select-none">
                定时任务（{scheduledRunConversations.length}）
              </summary>
              <div className="space-y-0.5 px-1 py-1">
                {scheduledRunConversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isSelected={
                      String(activeConversationId) === String(conversation.id)
                    }
                    onClick={() => {
                      if (onSelectConversationId) {
                        onSelectConversationId(conversation.id)
                      } else {
                        selectConversationById(conversation.id)
                      }
                      onSelectConversation?.()
                    }}
                  />
                ))}
              </div>
            </details>
          )}
```

空态判定也用 `mainConversations.length === 0 && scheduledRunConversations.length === 0`：

```tsx
          {activeContactId &&
            !conversationsPending &&
            mainConversations.length === 0 &&
            scheduledRunConversations.length === 0 &&
            (q ? (...) : (...))}
```

记得 `import { useMemo } from "react"`（如果未引入）。

- [ ] **Step 3: typecheck**

```bash
cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail -20
```
Expected: 零新增错。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/conversations/conversation-list.tsx
git commit -m "feat(orch): 侧栏「定时任务」分组——scheduled_run 会话独立可折叠

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: scheduled_run 会话进入只读视图

**Files:**
- Modify: `apps/web/src/components/chat/views/chat-view.tsx`（curator 分支）
- Modify: `apps/web/src/components/chat/views/curator-view.tsx`（加 readOnly prop 传给 ChatPanel）

- [ ] **Step 1: 给 CuratorView 加 readOnly prop**

READ `apps/web/src/components/chat/views/curator-view.tsx`。它内部应该最终渲染 `ChatPanel`（已支持 `readOnly`）。给 `CuratorView` 函数签名加 `readOnly?: boolean`，把它透传到内部的 `ChatPanel`/`ConversationChatView`。

- [ ] **Step 2: chat-view 按 session_flags 判定**

`apps/web/src/components/chat/views/chat-view.tsx`，在 curator 分支（~line 160-184）选中 `selectedConversation` 之后、`<CuratorView ... />` 之前，判定：

```typescript
      const isScheduledRunConv = (() => {
        const flags = selectedConversation?.sessionFlags
        if (!flags) return false
        try {
          const parsed = JSON.parse(flags)
          return parsed?.kind === "scheduled_run"
        } catch {
          return false
        }
      })()
```

把 `<CuratorView ... />` 的 props 加 `readOnly={isScheduledRunConv}`。

- [ ] **Step 3: typecheck**

```bash
cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail -20
```
Expected: 零新增错。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/views/chat-view.tsx apps/web/src/components/chat/views/curator-view.tsx
git commit -m "feat(orch): scheduled_run 会话进入只读视图（CuratorView readOnly 透传）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 端到端集成 + 全量回归

**Files:**
- Test: `tests/test_scheduled_recurring_orchestration.py`（APPEND）

- [ ] **Step 1: 写端到端测试**

APPEND（基于已有的 `test_two_scheduled_runs_end_to_end` 风格——同步驱动 DAG）：

```python
def test_two_runs_get_separate_conversations(db_session, monkeypatch):
    """两轮调度各开一个 curator 会话，子任务日志 orch_conv 分别落到对应会话。"""
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    import src.service.agent.orchestrator.dependency_scheduler as ds
    import src.service.stream_registry as sr
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.plan_run import PlanRun
    from sqlalchemy import select as _select
    from sqlalchemy.orm import sessionmaker

    sf = sessionmaker(bind=db_session.get_bind())
    for mod in (tss, ds):
        monkeypatch.setattr(mod, "get_session_local", lambda: sf, raising=False)

    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True
    plan.user_input = "每天查热搜→总结文档"
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'
    db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="emp", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="b")
    db_session.add_all([A, B]); db_session.commit()
    plan_id = plan.id

    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    def _fake_start(db, task, employee, workspace_id, *, priority=0, source="orchestration",
                    prereq_briefing="", stream_class=None, run_id=None,
                    orchestrator_conversation_id=None):
        log = TaskExecutionLog(
            task_id=task.id, workspace_id=workspace_id, employee_id=employee.id,
            skill_id=None, task_name_snapshot=task.task_name, run_status="success",
            run_result="ok", input_json="{}", output_json="{}", started_at=cst_now(),
            run_id=run_id, orchestrator_conversation_id=orchestrator_conversation_id,
        )
        db.add(log); db.commit(); db.refresh(log)
        sr._auto_accept_if_scheduled_run_safe(db, log)
        ds.on_employee_task_completed(task.id, workspace_id)
        return 1

    monkeypatch.setattr(ex, "start_task_as_conversation", _fake_start)
    monkeypatch.setattr(ds, "_dispatch_successor",
        lambda db, t, e, w, brief, rid, *, stream_class=None, orchestrator_conversation_id=None:
            _fake_start(db, t, e, w, run_id=rid, orchestrator_conversation_id=orchestrator_conversation_id))

    # 两轮触发
    tss.TaskSchedulerService.run_plan_job(plan_id)
    tss.TaskSchedulerService.run_plan_job(plan_id)

    runs = db_session.scalars(_select(PlanRun).where(PlanRun.plan_id == plan_id)
                              .order_by(PlanRun.run_seq)).all()
    assert [r.run_seq for r in runs] == [1, 2]
    # 每轮一个 conversation，互不相同
    conv_ids = [r.conversation_id for r in runs]
    assert all(c is not None for c in conv_ids) and len(set(conv_ids)) == 2
    # 每轮的子任务日志 orch_conv 落到本轮会话
    for r in runs:
        logs = db_session.scalars(_select(TaskExecutionLog)
            .where(TaskExecutionLog.run_id == r.id)).all()
        assert all(l.orchestrator_conversation_id == r.conversation_id for l in logs)
    # 每个 conv session_flags 带正确标记
    import json
    for r in runs:
        conv = db_session.get(Conversation, r.conversation_id)
        flags = json.loads(conv.session_flags or "{}")
        assert flags["kind"] == "scheduled_run" and flags["plan_id"] == plan_id
        assert flags["run_seq"] == r.run_seq
```

- [ ] **Step 2: 跑端到端**

Run: `cd apps/server && uv run pytest tests/test_scheduled_recurring_orchestration.py -k two_runs_get_separate_conversations -v`
Expected: PASS。若 FAIL，用 systematic-debugging 定位（多为 orch_conv 透传/推导漏点）。

- [ ] **Step 3: 全量后端回归**

Run: `cd apps/server && uv run pytest -q`
Expected: `1 failed, <N> passed, 0 errors`——只有 pre-existing `tests/test_workspace_crud_userlevel.py::test_create_user_workspace_empty`。`N` 应比基线 975 多本特性新增（约 10 条）。

- [ ] **Step 4: 全量前端 typecheck**

```bash
cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | tail -20
```
Expected: 与基线相比零新增错。

- [ ] **Step 5: Commit**

```bash
git add apps/server/tests/test_scheduled_recurring_orchestration.py
git commit -m "test(orch): 两轮各开独立 curator 会话端到端集成

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成标准（验收）

- [ ] 全量 `cd apps/server && uv run pytest -q` 相对基线零新增 failed/errors。
- [ ] 全量 `cd apps/web && npx tsc -p tsconfig.app.json --noEmit` 零新增 typecheck 错。
- [ ] 核心新测试全绿：`test_run_plan_job_creates_per_run_conversation_and_seeds_user_input` / `test_two_runs_get_separate_conversations` / `test_plan_subtasks_fold_into_single_row` 等。
- [ ] manual run 行为不变：交互式确认计划仍在主对话回应，QA/返工链路不破坏（既有 `test_orchestrator_*` 套件全绿）。
- [ ] 独立定时任务（无 orchestration_plan_id）保持原样不被聚合（`test_standalone_task_not_affected`）。

## 收尾（实现完成后）

- 用 `superpowers:requesting-code-review` 对整条 diff 做一次复审。
- 手测剧本（spec §9）：
  1. 总管发「每2分钟查热搜并总结成文档」→ 确认。
  2. 等节拍到点 → 「今日任务」面板**只有一行**「每2分钟查热搜并总结成文档 · 编排计划 · 第N轮」，主对话保持干净。
  3. 侧栏出现可折叠「定时任务」分组，每轮一个会话条目。
  4. 点 plan 行或侧栏条目 → 进只读视图看本轮汇报。
  5. 独立定时任务（如「下班打卡提醒」）行为不变。
- 更新记忆：本特性落地。
