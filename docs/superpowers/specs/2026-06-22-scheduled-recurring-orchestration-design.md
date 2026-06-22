# 定时递归编排：创建时冻结流程、按轮重跑 — 设计 spec

- 日期：2026-06-22
- 分支：feat/orchestrator-centric
- 关联：
  - [2026-06-17-orchestrator-qa-dag-gating-design.md](2026-06-17-orchestrator-qa-dag-gating-design.md)（下游派发以 QA 接受为闸）
  - [2026-06-17-orchestrator-rework-invalidation-propagation-design.md](2026-06-17-orchestrator-rework-invalidation-propagation-design.md)（返工作废下游）
  - [2026-06-15-orchestrator-centric-agent-redesign-design.md](2026-06-15-orchestrator-centric-agent-redesign-design.md)（总管中心总纲）

## 1. 背景与需求

用户要"**定时 + 多步依赖**"编排，典型场景：**「每天上午 10 点帮我查热搜，再总结成文档」**（热搜专员 → 文档助手，每日重复）。

核心诉求（用户原话）：**生成定时任务时就固定好流程，而不是每次触发时总管根据提问重新调度分发任务。**

即 **规划与执行分离**：
- **创建时**：总管分析一次，把 DAG（任务 + 依赖 + 节拍）冻结存库 = "冻结模板"。
- **触发时**：调度器到点**直接重跑这张冻结模板**，**不**再让总管重新分析/分单。

## 2. 现状盘点（已读码取证）

### 2.1 已具备
- `create_orchestration_plan`（[tools/plans.py:28](../../../apps/server/src/service/agent/orchestrator/tools/plans.py)）每个任务支持 `cron` + `depends_on`，冻结模板的**任务/依赖**部分已落地（`plan_json` 存依赖下标）。
- 调度用 APScheduler，按**单任务**挂 cron job（`employee_task:{task_id}` → `run_task_job(task_id)`，[task_scheduler_service.py:90/558](../../../apps/server/src/service/task_scheduler_service.py)）。
- DAG 下游靠"完成驱动 + DB 派生状态"派发（[dependency_scheduler.py:393](../../../apps/server/src/service/agent/orchestrator/dependency_scheduler.py) `on_employee_task_completed`）。
- **单步定时任务已正常可用**。

### 2.2 缺口（多步定时会坏）
执行语义是**一次性**的，去重/依赖判断基于 **TaskExecutionLog 的全部历史**，没有"轮次"概念：

- 去重谓词 `_already_dispatched`（[dependency_scheduler.py:281](../../../apps/server/src/service/agent/orchestrator/dependency_scheduler.py)）：只要某 task 历史日志里出现过 `success/failed/running/...`，就永远算"已派过"。
- 状态聚合 `_log_status_by_task`（:126）、QA 接受集 `_load_accepted_task_ids`（:145）、前置产物 `_collect_prereq_artifacts`（:324）——全部"扫该 task 全历史"。

**后果**：每日重跑同一张冻结计划时，第 2 天根任务（热搜）历史里有 `success` → 被判"已派过" → 跳过 → 下游（文档）等不到上游完成 → **永久卡死**。所以"单步定时能用、多步定时坏"。

此外，下游派发还要等 `qa_accepted_at`（总管人工验收，:480）——定时**无人值守**时没人点验收，下游同样卡死。

## 3. 目标 / 非目标

### 目标
- 多步定时编排：到点**按整张冻结 DAG 重跑一遍**，每轮 fresh、互不干扰。
- 触发时**不调用总管重新分析分单**（绕开 `_start_curator_task`）。
- 定时（无人值守）轮：下游**自动放行**（不等人工 QA），整轮跑完给总管一份汇报。
- 去重/依赖判断**按"轮（run）"作用域**算，根治"全历史去重"卡死。

### 非目标
- **不**做"运行中操控"（打断 / 追加 / 重指派定时轮）。
- **不**做"手动重跑这张计划"按钮 UI（但数据模型为其铺路，留作后续增量）。
- **不**改独立的手动 / MCP 定时任务（非编排计划、`orchestration_plan_id IS NULL`）的现有 `run_task_job` 路径。
- **不**兼容旧数据 / 旧执行语义（用户明确：开发库干净起步，`run_id` 直接 NOT NULL，无 null 回落分支）。
- **不**在 confirm 时为递归计划立即跑一轮（首次执行在首个 cron 节拍；"现在也跑一次"留后续）。

## 4. 核心模型：每一次"执行一张计划"都是一个 run

引入 **PlanRun（一轮执行实例）**。统一覆盖**交互式 confirm**、**定时到点**、**返工**三种触发——全系统去重按 run 收敛，无两套语义并存。

### 4.1 数据模型

**新表 `PlanRun`**（`models/plan_run.py`）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | int PK | = run_id |
| `plan_id` | FK → orchestration_plans (CASCADE) | 所属冻结模板 |
| `workspace_id` | FK → workspaces | 冗余便于查询 |
| `run_seq` | int | 第几轮（同一 plan 内自增，从 1） |
| `trigger` | str(32) | `manual`（confirm）/ `scheduled`（cron）/ `rework`（仅标注，返工沿用所属 run，见 §4.3） |
| `auto_accept` | bool | True → 下游免人工 QA 自动放行 |
| `status` | str(32) | `running` / `settled`（全部定局） |
| `started_at` / `ended_at` | datetime | |
| `created_at` | datetime | |

**`TaskExecutionLog` 加列**（[models/task_execution_log.py](../../../apps/server/src/models/task_execution_log.py)）：
- `run_id: int` → FK `plan_runs.id`（**NOT NULL**；orchestration 来源的日志一律写值）。

> 注：独立手动 / MCP 定时任务（`run_task_job` 路径）也写 TaskExecutionLog（[task_scheduler_service.py:600](../../../apps/server/src/service/task_scheduler_service.py)）。它们不属编排计划、无 PlanRun。为保持 `run_id` NOT NULL 的单一语义又不波及该路径，方案见 §7「run_id 与非编排日志」——结论：`run_id` 设为 **nullable=False 但仅对编排日志强制**不可行（同一列），故最终取 **`run_id` nullable=True，但编排路径的所有读查询一律带 `run_id` 过滤、绝不回落全历史**；非编排日志 `run_id` 为 NULL 且从不被编排查询触及。详见 §7。

**`OrchestrationPlan` 加列**（[models/orchestration_plan.py](../../../apps/server/src/models/orchestration_plan.py)）：
- `cron: str(128) | None` — 计划级节拍（冻结模板的一部分）。非空即递归计划。
- `is_recurring: bool` — 冗余标志，默认 False；`cron` 非空时为 True。

迁移：模型新增列 + `init_db.ensure_column` 增量加列（与既有 `qa_accepted_at` 等同模式）。开发库干净起步，无需回填。

### 4.2 何时开一个 run

| 触发 | run | auto_accept |
|---|---|---|
| 交互式 confirm（`execute_plan`） | 新 PlanRun，run_seq=1，trigger=`manual` | **False**（QA / 返工行为完全不变） |
| 定时到点（`run_plan_job`） | 新 PlanRun，run_seq=N+1，trigger=`scheduled` | **True**（自动放行） |
| 返工（rework） | **沿用任务当前所在 run**（不新开），见 §4.3 | 跟随该 run |

### 4.3 返工与 run 的关系
返工是"在当前这一轮内重做某步"，**不新开 run**。`redispatch_task` / `invalidate_downstream`（[rework.py](../../../apps/server/src/service/agent/orchestrator/rework.py)、[dependency_scheduler.py:220](../../../apps/server/src/service/agent/orchestrator/dependency_scheduler.py)）重派时，新日志写**与被作废日志相同的 run_id**。同一 run 内同一 task 可并存 `superseded`（旧）+ `running/success`（新）——与现有返工语义一致（`superseded` 不在 `_ALREADY_DISPATCHED_STATES`，可重派）。

## 5. 去重 / 依赖全面按 run 收敛

`dependency_scheduler` 的状态读取一律加 `run_id` 维度。改动点：

### 5.1 入口推导 run_id
`on_employee_task_completed(task_id, workspace_id)`（[:393](../../../apps/server/src/service/agent/orchestrator/dependency_scheduler.py)）：
- 由 `server._on_task_finalized` 调用，只有 task_id + workspace_id。
- **新增第一步**：查该 task 的**最新一条** TaskExecutionLog 取其 `run_id`（刚完成的那条）。
- 整盘评估（级联跳过 / 派发 / all_settled）全部限定在该 `run_id` 内。
- 若该日志 `run_id` 为 NULL（非编排任务）→ 早返回（本就 `orchestration_plan_id is None` 会返回，双保险）。

### 5.2 查询函数加 run_id 形参
- `_log_status_by_task(db, task_ids, run_id)` → `WHERE task_id IN (...) AND run_id = :run_id`
- `_load_accepted_task_ids(db, task_ids, run_id)` → 追加 `AND run_id = :run_id`
- `_collect_prereq_artifacts(db, dep_ids, run_id)` → 追加 `AND run_id = :run_id`（取本轮前置产物，不串到上一轮）
- `_record_skip(db, task, workspace_id, reason, run_id)` → 写 skip 日志时带 run_id
- `_dispatch_successor(...)` → 透传 run_id 给 `start_task_as_conversation`

### 5.3 返工 / 只读状态函数加 run_id
- `invalidate_downstream(task_id)` → 推导该 task 当前 run_id，作废**本轮**下游（不误伤其它轮）。
- `waiting_status_for_task(db, task, run_id)`、`task_prereqs_accepted(db, task, run_id)`：按"该任务关心的那一轮"判断。调用方（进度面板 / 返工闸）需提供 run_id —— 一般取该 plan 的**最新 run**（`MAX(run_seq)`）。
- `release_accepted_downstream(orchestrator_conversation_id)`：交互式 QA 放行（auto_accept=False 才用）。其扫描的 log 自带 run_id，盖 `qa_accepted_at` 后调 `on_employee_task_completed`（内部按 §5.1 自推 run_id），天然按轮。**定时轮 auto_accept=True 不走此路**（见 §6.3）。

## 6. 触发链路（绕开总管重分析）

### 6.1 计划级 job 注册
`TaskSchedulerService.reload_jobs`（[:90](../../../apps/server/src/service/task_scheduler_service.py)）新增一段：
- 扫 `OrchestrationPlan` where `cron` 非空且 `status == "confirmed"`（已确认的递归计划）。
- 为每个挂 job `plan:{plan_id}`，`CronTrigger.from_crontab(plan.cron)`，`max_instances=1` / `coalesce=True` / `misfire_grace_time=120`（**重叠自动跳过**，符合"上一轮没跑完则跳过本轮"）。
- 现有按 `EmployeeTask.cron_expression` 挂 `employee_task:{task_id}` 的逻辑**追加过滤 `orchestration_plan_id IS NULL`**：编排计划的子任务不再各自挂 task 级 job（避免与 plan 级双重调度）。独立手动 / MCP 定时任务不属任何计划，照常挂。

### 6.2 `run_plan_job(plan_id)`（新增）
到点触发时：
1. 取 plan；校验 `status == "confirmed"` 且 `cron` 非空且 `is_active` 类条件。
2. **开新 PlanRun**：run_seq = 该 plan 现有 max+1，trigger=`scheduled`，auto_accept=True，status=`running`。
3. **重跑冻结 DAG 根任务**：复用 `start_immediate_tasks(db, plan_tasks, plan, workspace_id, run_id=新run)`（§6.4 透传 run_id）。下游照旧由 `on_employee_task_completed` 完成驱动。
4. 更新 plan 的 `last_run_at` / `next_run_at`（沿用 `TaskService.compute_next_run`）。
5. **完全不调用 `_start_curator_task`、不重发总管消息、不重新分析**。

### 6.3 无人值守自动放行（auto_accept）
定时轮 auto_accept=True 时，员工任务一进 `success`，在 finalize 处**自动盖 `qa_accepted_at = now`**：
- 钩子点：`_finalize_task_stream`（[stream_registry.py](../../../apps/server/src/service/stream_registry.py)，成功终态分支，紧邻现有 `_capture_journal_safe` 等挂载点）。
- 逻辑：查该 log 的 `run_id` → 取 PlanRun.auto_accept；若 True 且本条 success → 盖 `qa_accepted_at`。
- 效果：现成 `_all_prereqs_accepted` 闸（§5.2）自然通过，**派发分支零 if 改动**，下游自动衔接。
- 交互式轮 auto_accept=False → 不自动盖，沿用 §5.3 `release_accepted_downstream` 人工放行链路，QA / 返工零变化。

### 6.4 root 首发透传 run_id
`execute_plan` / `start_immediate_tasks` / `start_task_as_conversation`（[execution.py](../../../apps/server/src/service/agent/orchestrator/execution.py)）增 `run_id` 形参：
- `execute_plan`（交互式 confirm）：先开 PlanRun（manual / auto_accept=False），把 run_id 透传给 `start_immediate_tasks`。
- `start_task_as_conversation` 建 `TaskExecutionLog` 时写 `run_id`（[:278](../../../apps/server/src/service/agent/orchestrator/execution.py)）。
- `_start_curator_task` 建 log 时同样需 run_id —— 但总管类编排任务的递归走 `run_plan_job`，§6.2 不调它；其单步定时若仍存在，归一到 plan 级（见 §8 工具改动）。

### 6.5 计划节拍的表达（工具层）
`create_orchestration_plan` 工具改动：
- 新增**计划级** `schedule: str | None` 参数（cron / 自然语言经 `parse_nl_cron`）。非空 → `OrchestrationPlan.cron` = 解析后 cron、`is_recurring = True`。
- 递归计划的**子任务不再各自带 cron**（per-task `cron` 字段对编排计划弃用；标准 cron 无法表达"仅一次"的老坑随之消失——一次性计划 `schedule=null`，confirm 后立即执行）。
- 单步定时也归一为"单任务 + 计划级 schedule"，走 `run_plan_job`，删除编排路径对 per-task cron 的依赖。
- 工具 docstring 同步更新（节拍语义从 per-task 上移到 plan）。
- `confirm_orchestration_plan` → `execute_plan`：递归计划（cron 非空）**只注册调度、不立即跑**（首轮在首个节拍）；一次性计划照旧立即执行。`reload_jobs()` 在 execute_plan 注册阶段调用以挂上 `plan:{plan_id}` job。

## 7. run_id 与非编排日志（关键边界）

`run_task_job` 的 MCP / 普通员工独立定时任务也写 TaskExecutionLog，但**不属任何 PlanRun**。处理：
- `TaskExecutionLog.run_id` 设 **nullable=True**；非编排日志写 NULL。
- **铁律**：编排路径（dependency_scheduler 全部读查询、auto_accept 判定）**一律带 `run_id = :run_id` 过滤**，绝不出现"run_id 为空时回落扫全历史"的分支。因此 NULL 行永远不被编排查询命中，与编排日志天然隔离。
- 编排写路径（execute_plan / run_plan_job / start_task_as_conversation / _record_skip / 返工）**一律写非空 run_id**。
- 即：列在 schema 上可空（容纳非编排日志），但在**编排语义内等价于 NOT NULL**——满足用户"不要 null 回落逻辑"的本意（没有"null 就走旧逻辑"的兼容分支）。

## 8. 改动面清单（纯后端）

| 文件 | 改动 |
|---|---|
| `models/plan_run.py` | **新建** PlanRun 模型 |
| `models/task_execution_log.py` | 加 `run_id` 列 + 关系 |
| `models/orchestration_plan.py` | 加 `cron` / `is_recurring` 列 |
| `db/init_db.py` | `ensure_column` 增量加 3 列 + 建 plan_runs 表 |
| `service/agent/orchestrator/dependency_scheduler.py` | 全读查询 + 入口推导 + 返工/只读函数加 run_id（§5） |
| `service/agent/orchestrator/execution.py` | execute_plan 开 run、透传 run_id（§6.4） |
| `service/agent/orchestrator/rework.py` | 返工重派沿用所在 run_id（§4.3） |
| `service/task_scheduler_service.py` | reload_jobs 计划级 job + 排除编排子任务的 task 级 job；新增 `run_plan_job`（§6.1/6.2） |
| `service/stream_registry.py` | finalize 处 auto_accept 自动盖 qa_accepted_at（§6.3） |
| `service/agent/orchestrator/tools/plans.py` | 计划级 `schedule` 参数、docstring、execute_plan 递归只调度不即跑（§6.5） |
| `service/task_service.py` | `compute_next_run` 复用（无改或微调）|

PlanRun 生命周期收尾：`on_employee_task_completed` 的 all_settled 分支（[:531](../../../apps/server/src/service/agent/orchestrator/dependency_scheduler.py)）顺手把本轮 PlanRun.status=`settled`、ended_at=now。

## 9. 测试策略

- **核心回归（多步定时重跑）**：模拟同一冻结计划连开 run-1 / run-2；断言 run-2 根任务**照常派发**（不被 run-1 历史 `success` 挡），下游在 run-2 内衔接。
- **run 隔离**：`_log_status_by_task` / `_load_accepted_task_ids` / `_collect_prereq_artifacts` 带 run_id → 只返回本轮；跨轮不串。
- **auto_accept**：scheduled run 的 success log finalize 后 `qa_accepted_at` 自动盖 → 下游免人工放行；manual run 不自动盖。
- **重叠跳过**：plan 级 job `max_instances=1`/`coalesce` 语义（可单测注册参数 + 行为说明）。
- **失败级联**：本轮某步失败 → 下游本轮 skipped；**不污染下一轮**（下一轮新 run 干净重跑）。
- **触发不重分析**：`run_plan_job` 不调 `_start_curator_task`（mock 断言未被调用），直接经 `start_immediate_tasks` 派根任务。
- **交互式零回归**：confirm 开 manual run（auto_accept=False）；QA 接受 / 返工作废下游 / 放行对账全部按 run 正确工作（覆盖统一方案最大风险面）。
- **非编排隔离**：`run_task_job` 写 NULL run_id 日志，从不被编排查询命中。
- **工具层**：`create_orchestration_plan(schedule=...)` → plan.cron / is_recurring 落库；递归计划 confirm 只注册不即跑；一次性计划立即执行。
- **基线**：后端当前 passed 数为基线，零新增回归（worktree 比对预存失败）。

## 10. 风险

- **统一 run 的爆炸半径**：交互式 QA / 返工链路（`release_accepted_downstream` / `invalidate_downstream` / `waiting_status_for_task` / `task_prereqs_accepted`）全部要按 run 收敛——最大风险面。缓解：§9 重点回归 + 这些函数 run_id 来源统一为"该 plan 最新 run"，语义单一。
- **入口推导 run_id 的正确性**：`on_employee_task_completed` 靠"最新一条 log"取 run_id。返工同 run 内并存多条 log，最新一条即当前在跑那条，run_id 一致，安全。需测"返工后最新 log 的 run_id == 原 run"。
- **节拍语义上移**：编排弃用 per-task cron，总管 prompt / 工具 docstring 要同步，否则总管可能仍按老格式在子任务塞 cron。缓解：docstring 明确 + 工具内若检测到子任务带 cron 给出纠正提示（可选防呆）。
- **首轮不即跑的预期差**：用户若期望"现在也跑一次"，递归计划首轮要等节拍。已在 §3 非目标声明；如需"立即 + 递归"留作后续 `schedule` 旁加 `run_now` 旗标的增量。
- **PlanRun 膨胀**：每天一轮 → 长期累积 run 行 + 每轮一组 TaskExecutionLog。本期不做清理（YAGNI）；体量与现有逐次执行日志同量级，留意后续加保留策略。

## 11. 验收对照

- 「每天 10 点查热搜 → 总结文档」：confirm 后注册 `plan:{id}` job、不立即跑；次日 10:00 自动开 run、热搜→文档全链自动跑完（无人点验收）、总管收到一份"定时任务第 K 轮结果"汇报；连续多日每轮 fresh、互不卡死。
- 交互式编排（QA / 返工）行为与改动前一致。
