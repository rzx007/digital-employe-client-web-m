# 编排计划折叠 + 每轮新会话 — 设计 spec

- 日期：2026-06-22
- 分支：feat/orchestrator-centric
- 关联：
  - [2026-06-22-scheduled-recurring-orchestration-design.md](2026-06-22-scheduled-recurring-orchestration-design.md)（定时递归编排：冻结 DAG + run_id 按轮重跑）
  - [2026-06-15-orchestrator-centric-agent-redesign-design.md](2026-06-15-orchestrator-centric-agent-redesign-design.md)（总管中心总纲）

## 1. 背景与问题

定时递归编排已落地（每天上午10点查热搜→总结成文档，每轮按冻结 DAG 自动重跑）。手测后用户提出**两个体验问题**：

1. **「今日任务」面板把一个计划拆成多行**：「获取热搜榜单 / 热搜文档编辑助手」+「总结成文档 / 文档办公助手」各占一行。在「员工幕后、总管唯一入口」的产品形态下，用户只下发**一个**需求（「每2分钟查热搜并总结成文档」），不关心总管把它拆给了谁、几个员工——只想看**一行**：那个计划现在怎么样了。
2. **每轮汇报都落进同一个主对话**：递归计划每次触发都在你的总管主对话里追加一轮汇报，污染主对话流。希望**每次触发开一个新总管会话**，主对话保持干净。

## 2. 现状盘点（已读码取证）

### 2.1 今日任务面板（扁平列任务）
- 前端组件 [today-task-list.tsx](../../../apps/web/src/components/workbench/today-task-list.tsx) 渲染 `executions: TodayTask[]`，每条 = task_name + employee_name + 时间 + 状态徽章。
- 数据 hook `useTodayAllExecutions`（[use-schedule-monitor-queries.ts:203](../../../apps/web/src/hooks/use-schedule-monitor-queries.ts)）→ `GET /workspaces/{id}/tasks/today` → 后端 `TaskService.list_today_tasks`（[task_service.py:347](../../../apps/server/src/service/task_service.py)）。
- 该服务**完全不按 `orchestration_plan_id` 聚合**：联合查询今日 `TaskExecutionLog`（已执行）+ 今日 `EmployeeTask`（待执行 cron），扁平返回。DTO `TodayTaskRead`（[schemas/task.py:167](../../../apps/server/src/schemas/task.py)）14 字段，**无 `orchestration_plan_id`**。
- 结果：一个编排计划的 N 个子任务在面板上是 N 行，互相无关联。

### 2.2 每轮汇报落到同一会话
- `run_plan_job`（[task_scheduler_service.py:600](../../../apps/server/src/service/task_scheduler_service.py)）调用 `start_immediate_tasks(db, tasks, plan, plan.workspace_id, run_id=run.id)`。
- `start_task_as_conversation`（[execution.py:232](../../../apps/server/src/service/agent/orchestrator/execution.py)）取子任务的 `orchestrator_conversation_id` 经 `resolve_orchestrator_conversation_id(db, task)`（[orchestrator_conversation_links.py:16](../../../apps/server/src/service/orchestrator_conversation_links.py)）解析：优先 `task.source_conversation_id`（计划创建时绑定的会话）→ 否则 `plan.conversation_id`。
- 即冻结模板每个子任务的报告目标会话**永远是计划创建时的那一个**，多轮重跑都共用，没有"每轮一个"概念。
- 再入汇报（[reentry.py:196](../../../apps/server/src/service/agent/orchestrator/reentry.py)）根据 `TaskExecutionLog.orchestrator_conversation_id` 找会话起总管轮——所以**只要派单时写对 orch_conv_id，再入汇报会自动落对会话**。

### 2.3 侧栏会话列表
- 选中总管 → [conversation-sidebar.tsx](../../../apps/web/src/components/chat/conversations/conversation-sidebar.tsx) 拉该 curator 的会话历史，扁平列出。
- 后端 `GET /workspaces/{id}/chat/conversations?target_type=curator&target_id=...`（[chat_api.py:105](../../../apps/server/src/api/chat_api.py)）→ `ConversationRead`（[schemas/conversation.py:33](../../../apps/server/src/schemas/conversation.py)）。
- `Conversation.session_flags`（[models/conversation.py:24](../../../apps/server/src/models/conversation.py)）TEXT 字段**已存在但目前是死列**：没人写、没人读、DTO 没暴露。

### 2.4 已具备的素材
- `PlanRun`（一轮执行实例，[models/plan_run.py](../../../apps/server/src/models/plan_run.py)）已有 plan_id/run_seq/trigger/auto_accept/status/started_at/ended_at。
- `OrchestrationPlan.user_input`（用户原始需求）+ `cron` + `is_recurring` 都已落库。
- 只读会话视图链已成熟：`ChatView → ConversationChatView readOnly → ChatPanel readOnly`（员工执行转录已在用）。

## 3. 目标 / 非目标

### 目标
- **A** 后端：每次 `run_plan_job` 触发开一个**全新**总管会话作本轮汇报落点；子任务报到该会话；冻结模板不动。
- **B** 今日任务面板：编排计划（`orchestration_plan_id` 非空的任务）**按 plan 聚合成一行**——标题=`plan.user_input`、状态=**最新一轮**子任务的聚合、点击跳该轮总管会话（只读）。独立定时任务（`orchestration_plan_id` 空）原样不动。
- **C** 侧栏：每轮会话进侧栏会话列表，但归类到**独立可折叠「定时任务」分组**与主对话分开，靠 `session_flags` 标记。
- 范围：**所有编排计划**都折叠（定时 + 交互式一次性）；不只递归。

### 非目标
- **不**在每轮会话里支持继续追聊：v1 是**只读**（看那轮汇报）。要操控回主对话找总管。
- **不**做会话保留/清理策略（YAGNI，靠"折叠分组"缓解视觉拥挤；后续按需）。
- **不**做"展开看子任务"的下钻交互：聚合行只链到会话，不在面板里展开。
- **不**改 `OrchestrationPlan.conversation_id`（计划创建时的会话）的语义，它仍是模板上的"创建源会话"。

## 4. Part A · 每轮开新总管会话

### 4.1 数据模型
**`PlanRun` 加列** `conversation_id: Mapped[int | None]` → FK `conversations.id` ondelete=SET NULL，nullable=True。指向该轮的总管会话。

迁移：`init_db._ensure_orchestration_recurring_columns`（[init_db.py](../../../apps/server/src/db/init_db.py)）追加该列的幂等 ALTER。

### 4.2 `run_plan_job` 改造
顺序：
1. 取 plan、校验（`status=="confirmed"` 且 `cron` 非空）；取 active 子任务、校验非空。
2. `open_plan_run(...)` 开新 PlanRun（trigger="scheduled", auto_accept=True）。
3. **新建本轮总管会话**：
   - 取 curator employee（用 `ensure_curator_conversation` 的 curator 解析逻辑——或抽个 helper `get_curator_employee(db, workspace_id, user_id)`，避免与默认主对话耦合）。
   - 解析 user_id：与 `_start_curator_task` 一致——从 `plan.workspace_id` 的 Workspace 取 owner。
   - `Conversation(workspace_id, user_id, target_type="curator", target_id=curator.id, title=<§4.4 标题>, session_flags=json.dumps({"kind":"scheduled_run","plan_id":plan.id,"run_seq":run.run_seq}))`，add/flush。
4. **种用户消息** = `plan.user_input`，stream_state="completed"。让会话可读、再入汇报时上下文不悬空。
5. **回写** `run.conversation_id = 新会话.id`，db.commit。
6. 调 `start_immediate_tasks(db, tasks, plan, plan.workspace_id, run_id=run.id, orchestrator_conversation_id=新会话.id)`，把会话作显式覆盖往下传。
7. 余下 `last_run_at` / `next_run_at` 更新 + 异常时标 run failed 不变。

### 4.3 派单链显式覆盖 `orchestrator_conversation_id`
- `start_immediate_tasks(...)` 加 keyword 参 `orchestrator_conversation_id: int | None = None`，转给 `start_task_as_conversation`。
- `start_task_as_conversation` 加 keyword 参 `orchestrator_conversation_id: int | None = None`；当非空时**直接用作 `orch_conv_id`，绕过 `resolve_orchestrator_conversation_id`**（不写回 `task.source_conversation_id`，保留模板"创建源会话"语义不变）。
- `_dispatch_successor`（[dependency_scheduler.py:602](../../../apps/server/src/service/agent/orchestrator/dependency_scheduler.py)）**不**改：它转发用的 `task.source_conversation_id` 已被 manual run 派单时写过（交互式仍按现状），定时轮下游通过 `on_employee_task_completed` 入口推 run → 取 PlanRun.conversation_id 作显式覆盖再调 `_dispatch_successor` 的辅助路径——具体见 §4.5。

### 4.4 会话标题
格式：`<user_input 截断 30 字> · 第N轮`，例：`「每2分钟查热搜并总结成文档」· 第3轮`。
用 `plan.user_input[:30]`（去首尾空白），N=`run.run_seq`。

### 4.5 下游派发同样落到本轮会话
- 现状：`_dispatch_successor → start_task_as_conversation(...)` 不带显式 orch_conv_id → 走 `resolve_orchestrator_conversation_id`，会回到 `plan.conversation_id`（计划创建源），错落到主对话。
- 改：`on_employee_task_completed`（[dependency_scheduler.py:393](../../../apps/server/src/service/agent/orchestrator/dependency_scheduler.py)）入口已知 `run_id`；新增一行 `run_conv_id = db.get(PlanRun, run_id).conversation_id`，在派下游分支调 `_dispatch_successor(db, t, employee, workspace_id, briefing, run_id, stream_class=..., orchestrator_conversation_id=run_conv_id)`。
- `_dispatch_successor` 新增 keyword `orchestrator_conversation_id: int | None = None`，转给 `start_task_as_conversation`。
- 交互式 manual run：PlanRun.conversation_id 等于 plan.conversation_id（§4.6），行为不变。

### 4.6 交互式 manual run 也写 `conversation_id`
- `execute_plan`（[execution.py:127](../../../apps/server/src/service/agent/orchestrator/execution.py)）开 manual run 后 `run.conversation_id = plan.conversation_id`（即创建源会话）。
- 好处：Part B 折叠行的"链到该轮会话"统一从 `PlanRun.conversation_id` 取，manual 计划链到创建源（=主对话），scheduled 链到本轮新会话，无分支。

### 4.7 边角
- **新会话写失败**：try/except 包裹会话+种消息+回写 run.conversation_id 全块；失败时把 run.status="failed"+ended_at 立即落库（沿用 §C1 已有的失败收尾模式），不继续派任务。该轮自然失败，下一轮节拍正常。
- **再入汇报自动跟随**：[reentry.py](../../../apps/server/src/service/agent/orchestrator/reentry.py) 按 `TaskExecutionLog.orchestrator_conversation_id` 找会话，子任务日志的 orch_conv_id 已落到本轮会话 → 再入汇报自然落对，无需改 reentry。
- **debouncer**：`report_debouncer` 按 conversation 维度去抖；本轮新会话 vs 主对话天然不互相挤压（不同 conv_id）。

## 5. Part B · 今日任务折叠

### 5.1 后端服务改造
`TaskService.list_today_tasks`（[task_service.py:347](../../../apps/server/src/service/task_service.py)）新增"按 plan 聚合"逻辑：

**步骤**：
1. 现有 Part A（已执行 logs）+ Part B（待执行 EmployeeTask）扁平结果照常算出，命名为 `flat_rows`。
2. 把 `flat_rows` 按 task 的 `orchestration_plan_id` 分桶：
   - `plan_id is None` 的行**直接保留**（独立任务）。
   - `plan_id` 非空的行**按 plan_id 分组**进 `plan_groups: dict[int, list]`。
3. 对每个 `plan_id`：
   - 取该 plan 的**最新一轮 PlanRun**（`MAX(run_seq)`，或最新 `id`）。
   - 取该轮内的子任务执行日志（`TaskExecutionLog.run_id == latest_run.id`）。若该轮还没任何日志（waiting 状态）→ 状态="等待"，时间用 `plan.next_run_at`。
   - **聚合状态**（§5.2）+ 时间（取本轮最早 `started_at` 或最新 `planned_at`）+ 时长（本轮已结束子任务的 `duration_ms` 总和）。
   - 输出一行**plan 聚合行**：`task_id=0`、`is_plan=True`、`plan_id=plan.id`、`task_name=plan.user_input[:60]`（截断防过长）、`employee_name="编排计划"`（固定填充，前端可显示成「定时计划」灰色标签）、`conversation_id=latest_run.conversation_id`、`execution_id=None`、`cron_expression=plan.cron`。
4. 合并独立行 + plan 聚合行；现有排序（运行中优先，时间倒序）不变。

> 注：第3步取最新 run + 取该轮日志的 SQL 在递归计划频繁触发场景下可能在 N 个 plan 上各 2 次查询。本期接受（plan 总数低）；性能问题后续按需再说。

### 5.2 聚合状态规则
按优先级取本轮子任务 `run_status` 集合：
1. 有 `running` 或 `queued` → **`running`**
2. 否则有 `failed`/`error`/`timeout` → **`failed`**
3. 否则有 `cancelled` → **`cancelled`**
4. 否则有 `skipped` → **`skipped`**
5. 否则全 `success` → **`success`**
6. 否则（本轮无日志）→ **`pending`**

### 5.3 DTO 扩展
`TodayTaskRead`（[schemas/task.py:167](../../../apps/server/src/schemas/task.py)）加：
- `is_plan: bool = False`
- `plan_id: int | None = None`
- `run_seq: int | None = None`（该轮序号，便于前端展示「第N轮」）

前端 `TodayTask` interface（[types/schedule-monitor.ts:163](../../../apps/web/src/types/schedule-monitor.ts)）同步加这 3 个字段。

### 5.4 前端行渲染
[today-task-list.tsx](../../../apps/web/src/components/workbench/today-task-list.tsx) **最小改动**：
- 行点击：`task.conversation_id` 仍是统一字段——plan 行的 `conversation_id` 即最新轮的会话，直接打开它。无需分支。
- 视觉小区分（可选）：`is_plan=true` 的行右上角加灰色「定时计划 · 第N轮」小标（或不加，靠 `employee_name="编排计划"` 字样区分）。
- 行的 `task_name` 直接显示 `plan.user_input` 文本——服务端已截断。

### 5.5 边角
- 计划今日**还没跑过**（递归计划首轮等节拍 / 取消后保留的已 settled 计划）→ 取 plan 的 `next_run_at` 落 `planned_at`，状态 `pending`。若 plan 没有 next_run_at（已 cancelled），跳过不出现在面板。
- 跨日：plan 行只看**今日有活动的子任务**——若最新轮跨在昨天，今日内没新日志且没 next_run_at 在今日，不出现（与现有"今日"语义一致）。
- 一次性 manual 计划：`PlanRun.run_seq=1`，行展示「第1轮」可看不别扭，但若想隐藏序号给"manual 计划且 run_seq=1"特判去掉「· 第N轮」段——本期不做。

## 6. Part C · 侧栏「定时任务」分组

### 6.1 后端 DTO 暴露 `session_flags`
`ConversationRead`（[schemas/conversation.py:33](../../../apps/server/src/schemas/conversation.py)）加 `session_flags: str | None = None`。
前端 `ConversationListItemDto`（[api/types.ts:194](../../../apps/web/src/api/types.ts)）同步加 `session_flags?: string`。
`mapConversationListItemToConversation`（[chat-mappers.ts:33](../../../apps/web/src/lib/chat/chat-mappers.ts)）透传。

### 6.2 前端分组渲染
[conversation-list.tsx](../../../apps/web/src/components/chat/conversations/conversation-list.tsx) 行渲染前一步做**简单分桶**：
- 解析每条会话 `session_flags`（容错 JSON.parse；非 JSON / 解析失败当作普通会话）。
- `kind == "scheduled_run"` → 进「定时任务」分组；否则进主列表。

UI：
- 主列表照常渲染（普通 curator 会话）。
- 末尾追加一个**可折叠分区**「定时任务（N）」（`<details>`/`<summary>` 或现有折叠组件），默认折叠。展开后显示 scheduled_run 会话列表。
- 行渲染同 `ConversationItem` 复用——但 plan 行点击进只读视图（§6.3）。

### 6.3 进入只读视图
- 当选中会话 `session_flags.kind == "scheduled_run"` → `ChatView`（[chat-view.tsx:128](../../../apps/web/src/components/chat/views/chat-view.tsx)）把它当 curator 但 `readOnly=true` 透传到 `ConversationChatView` / `ChatPanel`（已有的 readOnly 链）。
- 只读文案沿用既有：「只读 · 仅查看执行记录，如需派活请通过总管」。

### 6.4 边角
- 老会话 `session_flags=null`：分桶时归普通列表（默认行为安全）。
- 用户手动从今日任务面板点 plan 行打开本轮会话 → 同样进只读视图（同一会话，复用链）。
- 该分组只展示当前 curator 的 scheduled_run 会话（数据天然按 curator 拉取），无跨 curator 漏归类。

## 7. 改动面清单（按 Part）

| Part | 文件 | 改动 |
|---|---|---|
| A | `models/plan_run.py` | 加 `conversation_id` FK 列 |
| A | `db/init_db.py` | `_ensure_orchestration_recurring_columns` 追加 plan_runs.conversation_id 的 ALTER |
| A | `service/task_scheduler_service.py` | `run_plan_job` 建会话 + 种消息 + 透传 orch_conv |
| A | `service/agent/orchestrator/execution.py` | `start_immediate_tasks` / `start_task_as_conversation` 加 keyword orch_conv 覆盖；`execute_plan` 给 manual run 写 conversation_id |
| A | `service/agent/orchestrator/dependency_scheduler.py` | `on_employee_task_completed` 取 PlanRun.conversation_id；`_dispatch_successor` 加 keyword 转发 |
| B | `service/task_service.py` | `list_today_tasks` 按 plan 聚合 |
| B | `schemas/task.py` | `TodayTaskRead` 加 is_plan/plan_id/run_seq |
| B | 前端 `types/schedule-monitor.ts` | `TodayTask` 加 3 字段 |
| C | `schemas/conversation.py` | `ConversationRead` 加 session_flags |
| C | 前端 `api/types.ts` | `ConversationListItemDto` 加 session_flags |
| C | 前端 `lib/chat/chat-mappers.ts` | 透传 session_flags |
| C | 前端 `components/chat/conversations/conversation-list.tsx` | 分桶 + 可折叠分组 |
| C | 前端 `components/chat/views/chat-view.tsx` | scheduled_run 标记 → readOnly 透传 |

测试：
- A：新单测覆盖（i）run_plan_job 每轮新建会话 + 种 user_input 消息 + run.conversation_id 写值 + 子任务日志的 orchestrator_conversation_id 落到本轮会话；（ii）on_employee_task_completed 下游派发用本轮会话；（iii）execute_plan manual run 写 conversation_id=plan.conversation_id。
- B：新单测覆盖 list_today_tasks 的聚合（多子任务一行；最新轮状态聚合规则各分支；独立任务不被影响）。
- C：前端单测/组件测覆盖分桶 + 只读视图触发；后端 DTO 暴露 session_flags。
- 全套件零新增回归（基线：1 pre-existing failure / 975 passed）。

## 8. 风险

- **Conversation 列暴增**：递归计划 + 长期运行 → 大量 per-run 会话。本期靠侧栏折叠分组缓解视觉拥挤；不做清理。属技术债，后续配清理策略（按天保留 + 老 run 归档）。
- **每轮新会话的存量 plan**：实施前已有的 PlanRun 行 `conversation_id` 为 NULL；today 面板按"取最新轮的 conversation_id"展示 plan 行——若为 NULL，行的点击行为退化为"不跳"（前端容错）。新轮起照常写值。
- **session_flags JSON 解析容错**：前端必须 try/catch，非法 JSON 当普通会话不分组。
- **manual 计划 conversation_id 与 plan.conversation_id 等同**：交互式重跑（如果将来支持手动重跑同一 plan）会让多个 PlanRun.conversation_id 共指同一 conversation；today 面板取最新轮链接，行为合理。
- **会话标题截断 30 字**：长 user_input 会被裁；可接受。

## 9. 验收对照

- 「每2分钟查热搜并总结成文档」：
  - 今日任务面板：**只有一行**「每2分钟查热搜并总结成文档 · 编排计划 · 第N轮 · success/running/...」——而不是热搜 + 文档两行。
  - 主对话保持干净——不再被每轮汇报追加新 turn。
  - 侧栏出现可折叠的「定时任务」分组，每轮一个会话条目（如「每2分钟查热搜并总结成文档 · 第3轮」），点进去只读看本轮汇报。
- 「下班打卡提醒」（独立单任务）：面板上仍是一行原样，行为不变。
- 交互式一次性多步计划：折叠成一行，链到创建源会话（=主对话当前位置），不污染（本就是用户当时下的需求）。
