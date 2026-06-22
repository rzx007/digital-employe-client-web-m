# 定时调度收敛重构 — 设计 spec（总纲 + 阶段A）

- 日期：2026-06-22
- 分支：feat/orchestrator-centric
- 关联：
  - [2026-06-22-scheduled-recurring-orchestration-design.md](2026-06-22-scheduled-recurring-orchestration-design.md)（定时递归：冻结 DAG + run_id 按轮重跑）
  - [2026-06-22-orchestration-plan-folding-and-per-run-conversation-design.md](2026-06-22-orchestration-plan-folding-and-per-run-conversation-design.md)（折叠 + 每轮新会话）

## 1. 背景：为什么要收敛

定时编排在多次迭代后，反复出 bug（调度真空、状态误判 pending、点击不跳、世界杯提醒会每天重复…）。审计定位到**单一结构性病根**：

> **定时编排存在两条平行的触发路径（计划级 `run_plan_job` 与任务级 `run_task_job`），被独立打补丁、行为发散；PlanRun 在 5 个不同位置以不同语义被打开。** 每个 bug 都是"哪条路又漏了一处"。

审计还暴露一批**尚未撞到但确定会撞**的隐患（详见 §2）。本次做一次性收敛，终结这一类问题，而非继续打补丁。

**已敲定的方向（用户拍板）**：
1. 编排计划的定时**一律收敛到计划级**一条路径（禁止子任务级 cron）。
2. 支持**"跑一次"**（once）语义：到点跑完自动停。
3. 无 MCP 任务（遗留死代码），可删。
4. 每轮新会话**保留 + 后台清理旧轮**（每计划留最近 N 轮，默认 20）。

**分三阶段**（每阶段独立 spec→plan→实现→验证）：
- **阶段A（keystone，本 spec 详述）**：调度收敛 + run-once + 单一执行原语 + 删任务级 cron/ MCP 路径。消灭最多 bug。
- **阶段B**：PlanRun 生命周期（重启 settle 孤儿轮 / 回填修正 / 保留清理）。
- **阶段C**：折叠取轮 + 显示一致性收尾。

## 2. 审计发现的隐患清单（收敛要覆盖/消灭的）

| 编号 | 隐患 | 阶段A是否消灭 |
|---|---|---|
| C1 | "5分钟后"类一次性任务被存成每天重复 cron（`valid_until` 字段存在但全代码无人写） | ✅ run-once |
| C3 | run_task_job 的 MCP 子任务不开 PlanRun（已修 bug 的 MCP 版） | ✅ 删 MCP 分支 + 计划级统一 |
| C4 | 多子任务 plan 里某子任务带 task 级 cron → 触发误拉 DAG 兄弟 | ✅ 禁止子任务级 cron |
| 双路径发散 | run_plan_job / run_task_job 各开各的 PlanRun+会话 | ✅ 收敛 + 单一原语 |
| C2 | 每轮新会话无清理、无限膨胀 | 阶段B |
| I1 | 回填给"从没跑过"的计划造假 settled 轮 | 阶段B |
| I4 | 重启时在飞 PlanRun 永远卡 running | 阶段B |
| I3 | 折叠按 max(run_seq) 取轮，混合计划状态张冠李戴 | 阶段C（A 收敛后大幅缓解） |

## 3. 阶段A 目标 / 非目标

### 目标
- 编排计划的定时**只走计划级**：`reload_jobs` 只为计划挂 job，编排子任务**永不**单独挂 task 级 job。
- 计划节拍区分 **once / recurring**；once 到点跑一次后**自动停用**。
- 抽出**唯一**执行原语 `execute_plan_run`，被确认派活、定时触发共用；PlanRun 不再散落多处打开。
- 删除：`run_task_job` 的 MCP 分支（死代码）、`run_task_job` 的"编排子任务"分支（上次补丁，收敛后无用）、`create_orchestration_plan` 的 per-task `cron` 处理。
- `run_task_job` 收窄为：**只服务独立非编排任务**（`orchestration_plan_id IS NULL`，遗留/手动创建的定时任务）。

### 非目标（留给 B/C 或不做）
- PlanRun 生命周期（孤儿 settle、保留清理、回填修正）→ 阶段B。
- 折叠取轮的混合历史兜底 → 阶段C。
- 不改总管的对话/流式；不改 DAG 依赖调度核心（`on_employee_task_completed` 派发逻辑不动，只是入口统一）。
- 不动独立非编排定时任务的既有 `run_task_job` 行为（除删 MCP 分支）。

## 4. 数据模型

`OrchestrationPlan` 加列（[models/orchestration_plan.py](../../../apps/server/src/models/orchestration_plan.py)）：
- `schedule_kind: str | None` —— `"once"` / `"recurring"` / `None`（即时计划，无调度）。
- `run_at: datetime | None` —— once 的绝对触发时间（recurring 用 `cron`，已有）。

保留既有 `cron` / `is_recurring`：`is_recurring` 仍 = `schedule_kind == "recurring"`（创建时一并写，向后兼容现有读取点）。

迁移：`init_db._ensure_orchestration_recurring_columns` 追加 `schedule_kind` / `run_at` 的幂等 ALTER（[init_db.py](../../../apps/server/src/db/init_db.py)）。

> 编排子任务（`EmployeeTask`）**不再使用** `cron_expression` / `execute_mode="scheduled"`：编排计划下的子任务一律 `execute_mode="immediate"`、`cron_expression=""`。调度时机完全由 plan 的 schedule_kind 决定。`EmployeeTask.cron_expression` 字段仍保留（独立非编排任务还用）。

## 5. 调度解析（once vs recurring）

新增 `parse_schedule(nl_or_cron, *, now) -> ScheduleSpec | None`（放 task_scheduler_service 或新 `schedule_parser.py`）：
- 返回 `ScheduleSpec(kind="once", run_at=<datetime>)` 或 `ScheduleSpec(kind="recurring", cron=<5段cron>)`，无法解析 → None。
- **recurring**：周期性表达（"每天/每周/每N分钟/标准cron"）→ cron（复用现有 `parse_nl_cron` 逻辑）。
- **once**：相对/绝对一次性（"5分钟后/今晚8点/明天上午9点/2026-06-23 21:34"）→ 绝对 datetime（基于传入的 `now`，CST）。
- 判别由 LLM 一次性归类（沿用 `parse_nl_cron` 的 `build_chat_model().invoke` 模式，但 prompt 要它先判 once/recurring 再给值），失败回落保守：纯 5 段数字 → recurring cron；其余无法判 → None（创建时报错，不静默降级）。

> `now` 由调用方（create_orchestration_plan）传入 `cst_now()`，便于测试注入。

## 6. 工具层：`create_orchestration_plan`

[tools/plans.py](../../../apps/server/src/service/agent/orchestrator/tools/plans.py) 改：
- `schedule` 参数解析改用 `parse_schedule(schedule, now=cst_now())`：
  - `kind=="recurring"` → `plan.cron = spec.cron`、`plan.schedule_kind="recurring"`、`plan.is_recurring=True`。
  - `kind=="once"` → `plan.run_at = spec.run_at`、`plan.schedule_kind="once"`、`plan.is_recurring=False`、`plan.cron=None`。
  - `schedule` 给了但解析失败 → 返回错误串（不静默降级，沿用现有 §最终评审#1 行为）。
  - `schedule` 为空 → 即时计划（schedule_kind=None）。
- **删除 per-task `cron` 处理**：子任务一律 `cron_expression=""`、`execute_mode="immediate"`（无论计划是否定时）。docstring 移除 per-task `cron` 字段，schedule 说明改为"计划级、支持一次性(如『5分钟后』『今晚8点』)与重复(如『每天10点』)"。
- `compute_requires_confirmation`（[confirmation_policy.py:35](../../../apps/server/src/service/agent/orchestrator/confirmation_policy.py)）的 `_task_is_readonly_query` 里"无 cron"判定改为看 plan 级 schedule（定时计划不免确认）；细节实现时对齐。

## 7. 调度注册：`reload_jobs`

[task_scheduler_service.py:90](../../../apps/server/src/service/task_scheduler_service.py) 改：

**(A) 计划级 job**（统一入口）：扫 `OrchestrationPlan` where `status=="confirmed"` 且 `schedule_kind` 非空：
- `schedule_kind=="recurring"` 且 `cron` 可解析 → `CronTrigger.from_crontab(plan.cron)`，job id `plan:{id}`，回调 `run_plan_job`。
- `schedule_kind=="once"` 且 `run_at` 在未来且**尚未跑过**（`last_run_at IS NULL`）→ **`DateTrigger(run_date=plan.run_at)`**，job id `plan:{id}`，回调 `run_plan_job`。once 已跑过（last_run_at 非空）或 run_at 已过 → 不挂（防重复/防补触发）。
- 写 `plan.next_run_at`（recurring=下次 cron；once=run_at 或 None）。

**(B) 任务级 job**：**收窄为只扫独立非编排任务**——where 加 `orchestration_plan_id IS NULL`（去掉上次那段"OR plan.cron 为空"的复杂 OR；编排子任务现在永不带 cron，根本不会进来）。其余（is_active / dispatch_type / valid_until / cron 非空）不变。

**job 清理**：循环移除 `employee_task:` 与 `plan:` 前缀 job 不变。

`DateTrigger` 引入：`from apscheduler.triggers.date import DateTrigger`。

## 8. 单一执行原语：`execute_plan_run`

新增（放 execution.py）`execute_plan_run(db, plan, *, trigger, auto_accept) -> PlanRun`：
1. `run = open_plan_run(db, plan.id, plan.workspace_id, trigger=trigger, auto_accept=auto_accept)`；commit。
2. 解析本轮会话：
   - `trigger=="scheduled"` → `run.conversation_id = TaskSchedulerService._create_scheduled_run_conversation(db, plan, run)`（每轮新会话）。
   - `trigger=="manual"` → `run.conversation_id = plan.conversation_id`（创建源会话）。
   - 失败容错：标 run failed + 抛/返回（调用方处理）。commit。
3. 取 active 子任务，`start_immediate_tasks(db, tasks, plan, plan.workspace_id, run_id=run.id, orchestrator_conversation_id=run.conversation_id)`。
4. 返回 run（调用方负责 last_run/next_run 等后续）。

> `_create_scheduled_run_conversation` 已存在（上次抽出），保持；可考虑移到 execution.py 或保留在 scheduler、execute_plan_run 引用之。实现时择一，避免循环 import（scheduler 已 import execution，execution 不应反向 import scheduler → 把会话 helper 下沉到一个无环依赖的位置，如 execution.py 或新 `plan_run_service`）。

### 8.1 `run_plan_job` 改用原语 + once 自停
[task_scheduler_service.py:635](../../../apps/server/src/service/task_scheduler_service.py)：
- 校验 plan confirmed 且 `schedule_kind` 非空。
- 调 `execute_plan_run(db, plan, trigger="scheduled", auto_accept=True)`（替换原内联的 open_plan_run + 建会话 + start_immediate_tasks）。
- **once 自停**：`schedule_kind=="once"` → 跑完设 `plan.status="done"`（或 `is_active` 语义；新状态值 `"done"`）使 reload_jobs 不再挂 + 不再出现在 confirmed 调度扫描；`recurring` → 更新 `last_run_at` / `next_run_at`。
- 失败处理（建会话失败 / 派发失败）沿用现有标 run failed 逻辑。

### 8.2 `execute_plan` 改用原语
[execution.py:127](../../../apps/server/src/service/agent/orchestrator/execution.py)：
- **定时计划（schedule_kind 非空）**：只 `reload_jobs()` 注册（recurring 挂 CronTrigger、once 挂 DateTrigger），**不立即跑**，返回"已设为定时"。
- **即时计划（schedule_kind 为空）**：`execute_plan_run(db, plan, trigger="manual", auto_accept=False)`，立即派活。
- 删除原"immediate_tasks / scheduled_tasks 拆分"——收敛后编排子任务全是 immediate，是否定时只看 plan.schedule_kind。

### 8.3 `run_task_job` 收窄 + 删死代码
[task_scheduler_service.py:688](../../../apps/server/src/service/task_scheduler_service.py)：
- **删 MCP 分支**（`dispatch_type=="mcp"` 整段 + `_execute_mcp_tool_call`，确认无 MCP 任务）。reload_jobs 的 `dispatch_type.in_(("skill","mcp"))` 收为 `=="skill"`。
- **删上次加的"编排子任务"分支**（`if task.orchestration_plan_id is not None: 开 PlanRun…`）——收敛后编排子任务不再有 task 级 cron，run_task_job 不会再收到编排子任务。
- 保留：curator 独立定时（`_start_curator_task`）+ 普通员工独立定时（`_start_task_as_conversation`，不带 run_id/orch_conv，因为无 plan）。
- 防御：若 run_task_job 仍意外收到 `orchestration_plan_id` 非空的 task（脏数据），记 warning 并按独立任务跑（不再特殊处理），避免再分叉。

## 9. 边角与迁移

- **存量"子任务带 cron"的脏数据**（如已建的 plan#17/#18：plan.cron=None 但 task#19/#20 有 cron）：阶段A 后这些 task 级 job 不再被 reload_jobs 挂（编排子任务被 `orchestration_plan_id IS NULL` 过滤掉），于是它们**不再触发**。需一次性迁移：`init_db` 启动时把"`orchestration_plan_id` 非空且 `cron_expression` 非空"的存量子任务，按其 cron 反推 plan 的 schedule（recurring：plan.cron=task.cron + schedule_kind=recurring；难判 once/recurring 时一律按 recurring 保守）并清空 task.cron_expression。**或**更简单：标记这些计划 `status="cancelled"`（它们本就是测试脏数据，世界杯/打卡提醒），让用户重建。**实现时选后者（清理脏数据）**——避免反推歧义；spec 默认：迁移把"plan.cron 空但子任务带 cron"的计划 status 置 cancelled + 子任务 is_active=False，并日志列出，让用户按新模型重建。
- **once 的 DateTrigger 重启**：reload_jobs 对 once 只在 `last_run_at IS NULL` 且 `run_at>now` 时挂；跑过的不挂、过期未跑的不补触发（一次性过期即失效，记 warning）。
- **今日折叠**：once 计划未跑 → pending + planned_at=run_at；跑完自停后仍能在当天面板显示其最终状态（Part C 读 latest run）。

## 10. 测试策略（阶段A）

- **解析**：`parse_schedule` —— "5分钟后"→once+未来时间；"每天10点"→recurring+"0 10 * * *"；纯 cron→recurring；乱码→None。
- **工具**：create_orchestration_plan with once → plan.schedule_kind=once/run_at 写；recurring → cron/schedule_kind=recurring；子任务一律 immediate/cron 空。
- **reload_jobs**：recurring 计划挂 CronTrigger plan job；once 未跑挂 DateTrigger；once 已跑/过期不挂；编排子任务永不挂 task 级 job；独立非编排定时任务仍挂 task 级 job。
- **execute_plan_run 原语**：manual→reuse plan.conversation_id；scheduled→新 per-run 会话；都开 PlanRun + 透传 run_id/orch_conv。
- **run_plan_job**：once 跑完 plan.status=done（reload 不再挂）；recurring 更新 next_run。
- **execute_plan**：定时计划只注册不跑；即时计划立即跑。
- **run_task_job**：MCP 分支删除（不再有该路径）；编排子任务分支删除；独立任务行为不变。
- **脏数据迁移**：plan.cron 空 + 子任务带 cron 的计划被置 cancelled + 子任务停用。
- **全量回归零新增 failed**（基线：1 pre-existing / 当前 ~995 passed）。

## 11. 验收对照（阶段A）
- 「5分钟后提醒看世界杯」→ once 计划，到点触发一次后 status=done、**不再每天重复**。
- 「每天10点查热搜→总结文档」→ recurring 计划，每天计划级触发，行为同现有递归。
- 编排子任务**永不**单独出现在 task 级调度；run_task_job 只剩独立非编排任务 + curator 独立定时。
- PlanRun 只由 `execute_plan_run` 一处打开（确认 manual / 定时 scheduled）。
- 全后端套件零新增回归。
