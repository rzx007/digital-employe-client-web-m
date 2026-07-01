# 总管 = 结果导向 swarm 主管 体验重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让总管像 swarm 主管:员工结果到达即去抖增量唤醒总管反应(异步前提不变)、去掉机械「(系统)请整合团队成果」、总管随时掌握整盘概况;前端撤时间线任务卡、改常驻员工任务面板 + 在执行计数指示。

**Architecture:** 后端在每个员工任务终态收尾(`_finalize_task_stream`)时往 per-总管会话的内存去抖器投「待汇报」;去抖窗口结束且总管流槽空闲则起一轮总管 turn(brief=新结果+整盘快照),总管占线则在总管流结束钩子(`_run_agent_background` finally)补触发;`TaskExecutionLog.reported_at` 做持久 per-task 幂等,重启时扫 `reported_at IS NULL` 对账。前端时间线回到纯总管↔用户对话,员工任务挪进 chat header 可展开的常驻面板。

**Tech Stack:** Python/FastAPI/SQLAlchemy(后端)、React 19/TanStack Query/Zustand(前端)、pytest / vitest。

**Spec:** `docs/superpowers/specs/2026-06-16-orchestrator-swarm-leader-experience-design.md`

**验证基线(每个 commit 前后保持)**:后端 `cd apps/server && uv run pytest -q` 已知 5 基线失败(test_agent_runtime_policy×2 / test_orchestrator_execution_summary / test_shell_error_steering×2)不得新增;前端 `cd apps/web && npx tsc -p tsconfig.app.json --noEmit` 基线 90、`npx vitest run` 基线 1 失败(resolve-workbench-curator-panel),均零新增。**注意 `pnpm typecheck` 是浅检,必须用 `tsc -p tsconfig.app.json`。**

---

## 文件结构(改动地图)

**阶段 B(后端)**
- Modify `apps/server/src/service/agent/orchestrator/reentry.py` — 去「请整合」user 消息;brief 改「新结果+快照」;去 plan.status 门闩;暴露可被去抖器调用的「对一组任务起一轮汇报 turn」入口。
- Modify `apps/server/src/models/task_execution_log.py` — 加 `reported_at` 列。
- Modify `apps/server/src/db/init_db.py` — `ensure_column` 加 `reported_at`。
- Create `apps/server/src/service/agent/orchestrator/report_debouncer.py` — per-总管会话去抖器(内存态 + 主事件循环 timer + 占线队列 + 重启对账扫描)。
- Modify `apps/server/src/service/stream_registry.py` — `_finalize_task_stream`/`on_task_finalized` 通知去抖器(员工任务);`_run_agent_background` finally 加「总管流结束」钩子通知去抖器 drain。
- Modify `apps/server/src/service/agent/orchestrator/dependency_scheduler.py` — 移除 all_settled→`trigger_orchestrator_reentry` 一次性调用,改为依赖去抖器。
- Modify `apps/server/src/service/agent/orchestrator/prompts.py` — 接线 `build_delegation_execution_context`;再入 prompt 提示「对结果发话、不复述、不轮询」。
- Modify `apps/server/src/service/agent/orchestrator/agent.py` — `get_orchestrator_agent` 注入整盘执行快照。
- Modify `apps/server/src/server.py` — startup 钩子加 `reported_at IS NULL` 对账扫描。
- Tests: `apps/server/tests/test_report_debouncer.py`(新)、复用/扩展 `test_orchestrator_*`。

**阶段 A(前端)**
- Modify `apps/web/src/components/chat/curator/build-curator-timeline.ts` — 不再插执行卡(回退 e4ae98c3 + 移除终态卡插入)。
- Modify `apps/web/src/components/chat/curator/build-curator-timeline.test.ts` — 断言执行不入时间线。
- Modify `apps/web/src/components/chat/curator/curator-view.tsx` — 移除 execution 时间线分支渲染。
- Revert(部分)`apps/web/src/components/chat/message-blocks/execution-report-card.tsx` — 进行中态若仅服务时间线则回退;面板复用则迁移(见 A2)。
- Create `apps/web/src/components/chat/panel/employee-tasks-panel.tsx` — 常驻员工任务面板(数据 `useCuratorTaskExecutions`)。
- Modify `apps/web/src/components/chat/shell/chat-layout.tsx` — `rightPanel` 加 "employee-tasks" 槽位 + 渲染。
- Modify chat header(`curator-chat-header.tsx` / `curator-compact-toolbar.tsx`)— 加打开面板的图标按钮。
- Create `apps/web/src/components/chat/curator/running-tasks-indicator.tsx` — 「N 个任务在执行」指示。
- Modify `apps/web/src/stores/...` — 面板开关状态(新 store slice 或并入现有)。

---

# 阶段 B —— 编排回流(后端)

## Task B1: 去掉「(系统)请整合团队成果」

**Files:** Modify `apps/server/src/service/agent/orchestrator/reentry.py`(约 L120-122)

- [ ] **Step 1: 定位** 读 `trigger_orchestrator_reentry`,找到 `ChatService._append_message(db, conversation=conv, role="user", content="（系统）请整合团队成果")`。
- [ ] **Step 2: 删除该 user 消息插入**(保留其后的 assistant 占位消息与 `brief` 作为实际 LLM 输入不变)。若删后 `conv`/变量有未用,顺带清理。
- [ ] **Step 3: 跑回归** `cd apps/server && uv run pytest tests/ -q -k "reentry or orchestrator"`,确认无新增失败(对照基线)。
- [ ] **Step 4: 手验要点(记入 commit body)** 组队派活跑通后,总管会话里不再出现「(系统)请整合团队成果」气泡,总管仍能整合输出。
- [ ] **Step 5: Commit** `git commit -m "refactor(orchestrator): 去掉机械「(系统)请整合团队成果」消息,总管自发整合"`

## Task B2: `TaskExecutionLog.reported_at` 列 + 迁移

**Files:** Modify `apps/server/src/models/task_execution_log.py`、`apps/server/src/db/init_db.py`

- [ ] **Step 1: 加 ORM 列** 在 `TaskExecutionLog` 模型加:
```python
reported_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```
(import 与现有 datetime 列一致;注释:「已纳入某次总管增量汇报 turn 的时间;NULL=待汇报」)
- [ ] **Step 2: 加迁移** 在 `init_db.py` 的 `ensure_column` 序列(task_execution_logs 同表附近)加:
```python
ensure_column("task_execution_logs", "reported_at", "reported_at TIMESTAMP")
```
- [ ] **Step 3: 验证迁移** `cd apps/server && uv run python -c "from src.db.init_db import init_db; init_db()"`(或既有初始化入口),确认无报错、列存在。
- [ ] **Step 4: 跑后端全量** `uv run pytest -q`,5 基线不得新增。
- [ ] **Step 5: Commit** `git commit -m "feat(orchestrator): TaskExecutionLog 加 reported_at(增量汇报幂等)+ 迁移"`

## Task B3: 接线整盘执行快照(总管掌握全局)

**Files:** Modify `apps/server/src/service/agent/orchestrator/prompts.py`(`build_delegation_execution_context`)、`apps/server/src/service/agent/orchestrator/agent.py`(`get_orchestrator_agent`)

- [ ] **Step 1: 读现状** 读 `build_delegation_execution_context`(prompts.py:189)真实签名:`(db, workspace_id, orchestrator_conversation_id, *, limit, output_max_chars)` —— **注意 `workspace_id` 是第二个位置参数,调用处务必传**。确认它按会话取任务的 (task_name, employee, run_status, 结果摘要截断)。
- [ ] **Step 2: 写测试** `apps/server/tests/test_orchestrator_snapshot_context.py`:构造一个总管会话 + 2 条 TaskExecutionLog(1 success 含 output、1 running),调用快照构建函数,断言返回文本含两任务名、含 success 的结果摘要、含 running 状态,且结果摘要被截断到上限(如 ≤800 字)。
- [ ] **Step 3: 跑测试看失败/通过** `uv run pytest tests/test_orchestrator_snapshot_context.py -v`(若函数已满足则直接绿;否则按断言补足函数)。
- [ ] **Step 4: 在 `get_orchestrator_agent` 注入** 构建总管 agent 的 system prompt 时,追加 `build_delegation_execution_context(db, workspace_id, orchestrator_conversation_id)` 的输出(**workspace_id 必传**;限定本会话、空则不注入)。确保用户主动接话与再入 turn 都走到。
- [ ] **Step 5: 跑相关测试 + 全量** `uv run pytest -q`,零新增失败。
- [ ] **Step 6: Commit** `git commit -m "feat(orchestrator): 总管上下文注入整盘任务执行快照,随时掌握全局"`

## Task B4: 去抖器模块(核心,纯逻辑先行)

**Files:** Create `apps/server/src/service/agent/orchestrator/report_debouncer.py`、Test `apps/server/tests/test_report_debouncer.py`

设计:一个 per-`orchestrator_conversation_id` 的去抖器。对外接口(纯函数 + 可注入的「起一轮汇报」回调,便于单测不依赖真实 stream):

```python
# report_debouncer.py(要点;实现时按真实事件循环/线程接入)
import asyncio, logging
logger = logging.getLogger(__name__)

class ReportDebouncer:
    def __init__(self, *, loop, debounce_ms: int = 1500,
                 fire,            # async fn(orch_conv_id) -> bool: 起一轮汇报 turn;返回是否成功消费
                 is_busy):        # fn(orch_conv_id) -> bool: 总管会话是否正在流式
        self._loop = loop        # 装配时捕获主事件循环(notify 经 call_soon_threadsafe 跨线程进来)
        self._debounce = debounce_ms / 1000
        self._fire = fire
        self._is_busy = is_busy
        self._timers: dict[int, asyncio.TimerHandle] = {}
        self._pending: set[int] = set()   # 有待汇报的会话

    def notify(self, orch_conv_id: int) -> None:
        """任务完成时调用(已在主事件循环线程内:经 call_soon_threadsafe 投递)。(重)启去抖计时。"""
        self._pending.add(orch_conv_id)
        if (t := self._timers.pop(orch_conv_id, None)):
            t.cancel()
        self._timers[orch_conv_id] = self._loop.call_later(
            self._debounce, lambda: asyncio.ensure_future(self._flush(orch_conv_id)))

    async def _flush(self, orch_conv_id: int) -> None:
        self._timers.pop(orch_conv_id, None)
        if self._is_busy(orch_conv_id):
            return  # 总管占线:留待 on_stream_end 补触发
        ok = await self._fire(orch_conv_id)  # fire 内部:取 reported_at IS NULL 的终态任务、起 turn、标记
        if ok:
            self._pending.discard(orch_conv_id)

    def on_stream_end(self, orch_conv_id: int) -> None:
        """总管流结束钩子调用:若该会话仍有待汇报→补触发一次去抖。"""
        if orch_conv_id in self._pending:
            self.notify(orch_conv_id)
```

- [ ] **Step 1: 写测试(去抖合并)** `test_report_debouncer.py`:用 `asyncio` + fake clock/`asyncio.sleep` 或注入小 `debounce_ms`;连续 `notify(7)` 三次(间隔小于窗口),断言 `fire` 只被调用一次。
- [ ] **Step 2: 写测试(占线→on_stream_end 补触发)** `is_busy` 先返回 True → `notify` + 等窗口 → `fire` 未被调;再 `on_stream_end(7)`(此时 `is_busy` 返回 False)→ 等窗口 → `fire` 被调一次。
- [ ] **Step 3: 写测试(消费成功清 pending)** `fire` 返回 True 后,`_pending` 不再含该会话;返回 False(占线被拒)则保留。
- [ ] **Step 4: 实现模块**让 1-3 通过。`uv run pytest tests/test_report_debouncer.py -v`。
- [ ] **Step 5: Commit** `git commit -m "feat(orchestrator): 增量汇报去抖器(合并/占线补触发/幂等清理)+ 单测"`

## Task B5: `fire` 回调 —— 起一轮总管汇报 turn(新结果 + 快照)

**Files:** Modify `apps/server/src/service/agent/orchestrator/reentry.py`

- [ ] **Step 1: 加函数** `trigger_incremental_report(db, orchestrator_conversation_id, workspace_id) -> bool`:
  - 查本会话 `reported_at IS NULL` 且终态(success/failed/timeout/cancelled/skipped)的 TaskExecutionLog;无则返回 True(无事可做、视为已消费)。
  - 组 brief = `build_reentry_brief(新结果)` + `build_delegation_execution_context(db, workspace_id, orchestrator_conversation_id)`(复用 B3;**workspace_id 必传**,本函数在 `trigger_incremental_report` 入参里就有)。
  - `request_start(source="orchestrator_reentry", messages=[{"role":"user","content":brief}])`;若 REJECTED(总管占线)→ 返回 False(不标记,留待补触发)。
  - 成功起流 → 把这些任务 `reported_at = now`,commit;返回 True。
- [ ] **Step 2: 移除 plan.status 门闩** 删 `trigger_orchestrator_reentry` 里 `if plan.status == "summarized": return` 早返回(per-task `reported_at` 已负责幂等);`plan.status` 仅保留为只读展示(可在整盘全 reported 时置终态值)。
- [ ] **Step 3: 写测试** `test_incremental_report`:2 条 reported_at NULL 的 success 任务 + mock `request_start` 成功 → 调用后两任务 reported_at 非空、brief 含两结果 + 快照;再调一次 → 无未汇报任务、返回 True 且不重复起流(幂等)。mock `request_start` 返回 REJECTED → reported_at 仍为 NULL、返回 False。
- [ ] **Step 4: 跑测试 + 全量** `uv run pytest -q`,零新增失败。
- [ ] **Step 5: Commit** `git commit -m "feat(orchestrator): 增量汇报 turn(新结果+整盘快照,reported_at 幂等,去 plan.status 门闩)"`

## Task B6: 接线 —— 完成事件通知去抖器 + 总管流结束钩子 + 去掉 all_settled 一次性触发

**Files:** Modify `apps/server/src/service/stream_registry.py`、`apps/server/src/service/agent/orchestrator/dependency_scheduler.py`;去抖器单例装配处(如 `report_debouncer` 模块级单例,`fire=trigger_incremental_report` 包装、`is_busy`=查 registry 活跃流)

- [ ] **Step 1: 装配单例** 在 `report_debouncer.py`(或 reentry/registry 装配处)建模块级 `get_report_debouncer()`,注入 `fire`(包装 `trigger_incremental_report`,内部开自己的 DB session)与 `is_busy`(查 `stream_registry` 该 orchestrator 会话是否有活跃流)。
- [ ] **Step 2: 员工任务完成→notify** 在 `_finalize_task_stream`(写完 summary、`on_task_finalized` 回调里,且确有 `orchestrator_conversation_id`)经 `loop.call_soon_threadsafe(debouncer.notify, orch_conv_id)` 通知(跨 `_DB_WRITE_EXECUTOR` 线程→主循环)。
- [ ] **Step 3: 总管流结束钩子** 在 `_run_agent_background` 的 finally(总管流真正收尾;`orchestrator_conversation_id` 是该方法入参、finally 内在作用域)判断本流 conversation 是某 orchestrator 会话,**直接调** `debouncer.on_stream_end(orch_conv_id)`。**注意:finally 已在主事件循环线程,无需 `call_soon_threadsafe`**(与 Step 2 员工路径不同——那条在 `_DB_WRITE_EXECUTOR` 线程,必须 `call_soon_threadsafe`)。**不要复用员工专用 `on_task_finalized`。**
- [ ] **Step 4: 去掉 all_settled 一次性触发** 在 `dependency_scheduler.py:~397` 移除 `if all_settled: trigger_orchestrator_reentry(...)`(增量去抖已覆盖最终整合);保留 all_settled 仅作日志/状态。
- [ ] **Step 5: 写/改测试** 集成向:mock registry,模拟 3 个任务先后完成 → 断言 `notify` 被调、去抖后 `trigger_incremental_report` 起一次、3 任务 reported_at 全非空。占线分支:总管 busy 时完成 → on_stream_end 后补汇报。
- [ ] **Step 6: 跑全量** `uv run pytest -q`,5 基线不得新增。
- [ ] **Step 7: Commit** `git commit -m "feat(orchestrator): 任务完成→去抖通知、总管流结束补触发、移除 all_settled 一次性整合"`

## Task B7: 重启对账 + 再入 prompt 提示

**Files:** Modify `apps/server/src/server.py`(startup)、`apps/server/src/service/agent/orchestrator/prompts.py`(再入提示)

- [ ] **Step 1: 启动对账** 在 server startup 钩子,扫描所有「终态且 `reported_at IS NULL`」的 TaskExecutionLog,按其 `orchestrator_conversation_id` 调 `debouncer.notify`(重建待汇报、触发一次补汇报)。
- [ ] **Step 2: 再入 prompt** 在再入 brief/总管 system 提示加一句:你是 swarm 主管,**对新到的结果简短发话/把控**,结果不达标可直接返工(再派活),**不要逐条复述、不要轮询 list_tasks(快照已给)**。
- [ ] **Step 3: 测试** 单测:种 1 条终态 reported_at NULL 任务 → 调对账函数 → `notify` 被调一次。
- [ ] **Step 4: 跑全量** `uv run pytest -q` 零新增。
- [ ] **Step 5: 手验(记 commit body)** 跑中途重启,残留未汇报任务能被补汇报。
- [ ] **Step 6: Commit** `git commit -m "feat(orchestrator): 启动对账补汇报 + 再入 prompt 提示(结果导向/不复述)"`

---

# 阶段 A —— 前端呈现

## Task A1: 撤时间线任务卡(回退 e4ae98c3 + 移除终态卡插入)

**Files:** Modify `build-curator-timeline.ts`、`build-curator-timeline.test.ts`、`curator-view.tsx`

- [ ] **Step 1: 改测试先行** 在 `build-curator-timeline.test.ts`:把原「执行入时间线」断言改为**断言执行不入时间线**——给 success/running 执行,`orderKeys` 结果**不含** `exec:*`(只含 message)。删/改我在 e4ae98c3 加的「运行中入线」测试块。
- [ ] **Step 2: 跑测试看失败** `cd apps/web && npx vitest run src/components/chat/curator/build-curator-timeline.test.ts` → 失败(当前仍插卡)。
- [ ] **Step 3: 改实现** `build-curator-timeline.ts`:`buildCuratorTimeline` 只返回 message 条目,不再 push execution(移除 `ACTIVE_EXECUTION_STATUSES`/`TERMINAL_EXECUTION_STATUSES` 相关插卡逻辑;`TimelineEntry` 可收窄为 message-only 或保留类型但不产出 execution)。`getExecutionCardTs` 等若无用一并删。
- [ ] **Step 4: curator-view 清理** 移除 `entry.kind === "execution"` 渲染分支及其 `ExecutionReportCard` 引用(timeline 处);`buildCuratorTimeline` 调用签名相应简化。`execution-report-card.tsx` 若就此零引用→留待 A2 决定(面板可能复用),先不删。
- [ ] **Step 5: 跑测试 + typecheck** vitest 该文件绿;`npx tsc -p tsconfig.app.json --noEmit` 基线 90 零新增。
- [ ] **Step 6: Commit** `git commit -m "refactor(chat): 撤总管时间线员工任务卡(改由常驻面板承载)"`

## Task A2: 常驻员工任务面板

**Files:** Create `employee-tasks-panel.tsx`;Modify `chat-layout.tsx`、chat header(`curator-chat-header.tsx`/`curator-compact-toolbar.tsx`)、面板开关 store

- [ ] **Step 1: 面板组件** `employee-tasks-panel.tsx`:入参 `curatorConversationId`;用 `useCuratorTaskExecutions` 取数;按状态分「进行中(running/queued)/已完成(终态)」两区;每条:状态徽章 + 员工名 + 任务名 + 可展开结果(`output.content`/`run_result` 截断)+「查看对话」(`navigateToEmployeeFromCurator`,运行中也可)。复用 `ExecutionReportCard`/`StarRating` 视觉。**实时性说明**:`useCuratorTaskExecutions` 本身是 10s 轮询;真正的"实时"靠 chat-layout 的 `useWorkspaceEvents` 在 `task_started/completed/failed` SSE 事件里 invalidate `curator-executions`(已有,`refetchTaskExecutionQueries`)——面板复用这条即近实时,无需新接 SSE。
- [ ] **Step 2: 开关 store** 加 `isEmployeeTasksPanelOpen` + open/close(并入现有 chat-store 或新 slice;与其它右面板互斥参照 artifact/monitor 模式)。
- [ ] **Step 3: chat-layout 接入** `rightPanel` 联合类型加 `"employee-tasks"`;在 chat 且开启时渲染 `<EmployeeTasksPanel>`(窄面板宽度 `NARROW_RIGHT_PANEL_WIDTH`);纳入互斥。
- [ ] **Step 4: header 图标** 在 curator 头部/compact 工具栏加一个图标按钮(如 `IconLayoutGrid`/任务图标),`onClick` 开关面板;带运行中数量 badge(可选)。
- [ ] **Step 5: typecheck + vitest** 基线零新增;补一个面板渲染轻测试(给 mock executions,断言分区与条数)。
- [ ] **Step 6: Commit** `git commit -m "feat(chat): 常驻员工任务面板(header 图标开,状态+结果,SSE 实时)"`

## Task A3: 「N 个任务在执行」指示

**Files:** Create `running-tasks-indicator.tsx`;Modify `curator-view.tsx`(挂载点)

- [ ] **Step 1: 组件** `running-tasks-indicator.tsx`:`useCuratorTaskExecutions` 过滤 running/queued 计数;count>0 时渲染紧凑条「🔄 N 个任务在执行」;`onClick` 打开 A2 面板(调 store open)。count=0 不渲染。
- [ ] **Step 2: 挂载** 在 `curator-view.tsx` 合适处(如最后一条总管消息下方或 composer 上方常驻)挂载该指示。
- [ ] **Step 3: 测试** 轻测试:mock 2 running → 渲染含「2」;0 → 不渲染。
- [ ] **Step 4: typecheck + vitest** 零新增。
- [ ] **Step 5: Commit** `git commit -m "feat(chat): 「N 个任务在执行」指示,点击开员工任务面板"`

---

## 完成判定

- 组队派活:总管派活后这一轮结束(异步);员工陆续完成→总管去抖增量接话(无「(系统)请整合」);最终整合自然收尾。
- 总管随时能在快照里看到整盘(被唤醒或主动接话都行)。
- 时间线无员工任务卡;header 图标可开常驻面板看状态+结果;消息区有「N 个在执行」指示。
- 后端 pytest 5 基线零新增;前端 tsc 90 / vitest 1 基线零新增。
