# 排班可视化收敛 + 月历重接总管编排 + 员工详情 tab 合并 设计

**日期:** 2026-06-23　**分支:** feat/orchestrator-centric

## 背景

总管中心化 + 员工手动排班/任务编辑已退场后，遗留三处问题：
1. 工作台有**两套排班可视化**冗余——常驻紧凑月历 `ScheduleCalendar`(schedule-monitor) + 独立「员工排班」整页 `shift-calendar`(刚临时恢复的只读视图)，且都吃今后没人维护的「员工 cron / shift_schedule」。
2. 月历数据源(`employee_tasks.cron_expression`)在新模型下基本为空——总管编排任务 `cron_expression=NULL`，只在 `OrchestrationPlan` 上有 `schedule_kind/cron/run_at`。
3. 员工详情「任务监控」tab 里 `TaskStatsCards`/`ScheduleCalendar` 两块绑死废弃的员工 cron，失真误导；`ExecutionMetricsCard`/`ExecutionDetail`(读 `task_execution_log`)仍真实有效。

## 决策（已与用户敲定）

- **A. 月历语义** = 即将到来的计划运行：`OrchestrationPlan` 中 recurring 按 cron 展开到本月各天 + once 的 `run_at` 落当天。让月历在新模型下重新有意义。
- **B. 收敛形态** = 保留工作台**紧凑月历**(retarget)，删掉独立「员工排班」shift-calendar 整套（弹窗/按钮/页面）。一处入口。
- **C. 员工详情 3→2 tab**：`编辑员工` + `任务监控` 合并成一个 tab（上「编辑」下「执行历史」单 tab 滚动）；`成长履历` tab 保留。任务监控只留 `ExecutionMetricsCard` + `ExecutionDetail`，删 `TaskStatsCards` + 旧月历。

## 架构

四部分，可分批落、互相低耦合：

### Part A — 后端月历重接总管编排计划（task_service.build_monthly_calendar）

**现状:** `build_monthly_calendar` 按员工 + `employee_tasks`(is_active, dispatch_type='skill') 的 cron 逐天填充；响应 `{year,month,days:{date:{day,date,employees:[{...tasks[]...}]}}}`。

**改为:** 数据源换成 `OrchestrationPlan`（workspace 维度；该 user 的工作空间下 `status='confirmed' AND schedule_kind IS NOT NULL`）。逐天投影**即将到来的计划运行**：
- `schedule_kind='recurring'`：用 `CronTrigger.from_crontab(plan.cron, timezone=CST)`，从本月初(或 max(月初, now))逐次 `get_next_fire_time` 迭代，落在本月范围内的每个 fire time → 当天 +1 run。
- `schedule_kind='once'`：若 `run_at` 在本月且未跑（`last_run_at IS NULL`/status confirmed）→ 落当天。
- **工作空间解析（评审定）**：用 **`list_user_workspaces(user_id)` 取该用户全部工作空间** 的 id 集合，`OrchestrationPlan.workspace_id.in_(ws_ids)`。不能只取 `ensure_user_default_workspace`（用户现可有多工作空间，否则外部文件夹工作空间的计划会从月历消失）。
- **naive/aware**：`plan.run_at` naive → 比较/投影前 `replace(tzinfo=CST)`（见边界节）。
- **cron 迭代有界**：`get_next_fire_time` 循环以 `end_of_month` 为上界，每个 plan 每天最多记 1 条（避免 `* * * * *` 爆炸）。
- `employee_id` 参数：保留签名兼容但**忽略**（编排计划非员工维度；月历去员工 tab 后只剩 workspace 级调用，不传 employee_id）。

**新响应契约**（plan-run 维度）：
```
{ year, month, days: { "YYYY-MM-DD": {
    day, date,
    runs: [ { plan_id, title, schedule_kind, time: "HH:MM", cron: str|null } ]  // 当天的计划运行
} } }
```
`title` = `plan.user_input` 截断或计划名；`time` = 该 fire time 的时分（once 用 run_at 时分）。空天 `runs: []`。

**Pydantic 契约（评审补：必做）**：`schemas/task.py` 的 `MonthlyCalendarRead`/`MonthlyCalendarDayRead` 改写——`MonthlyCalendarDayRead.employees` 改为 `runs: list[MonthlyCalendarRunRead]`（新模型 plan_id/title/schedule_kind/time/cron），退役 `MonthlyCalendarEmployeeRead`/`MonthlyCalendarTaskRead`。`task_api.py:180` 的 `MonthlyCalendarRead(**payload)` 包装随之适配，否则 ValidationError。

**测试**：新增 `tests/test_monthly_calendar_orchestration.py`（recurring cron 月内展开、once run_at 落当天、已跑 once 不出现、多工作空间隔离/聚合、空结果、不可解析 cron 跳过）；并**改写或删除既有 `tests/test_monthly_calendar_userlevel.py`**（它断言旧 `day["employees"]` + `shift_schedule_json` 夹具，retarget 后必破——不在「1 预存失败」豁免内）。

### Part B — 前端收敛排班可视化

- **删除**：整套 `apps/web/src/components/shift-calendar/`（撤回本会话先前的只读恢复，决策 B 取代它）+ `workbench-shift-calendar-sheet.tsx` + 工作台「员工排班」按钮 + `chatKeys.shiftCalendar`（与上次退场 commit bcb57e6b 等价，这次为终态）。
- **保留并 retarget** `schedule-monitor/sections/schedule-calendar.tsx`：改读新 `runs` 契约——`countDayTasks`/`getLevel`/hover 的 `ScheduleDayHoverContent` 三处全改按 `dayData.runs`（不再 `employees`）；密度 = `runs.length` 分级；hover 列出当天计划运行（标题 + 时间 + recurring/once 标）。同步改 `use-schedule-monitor-queries.ts` 的 `useMonthlyScheduleOverview` 返回类型 + `types/schedule-monitor.ts` 的 `MonthlyOverview`/`ScheduleDay`（`employees`→`runs`，退役 `ScheduleEmployee`）。
- **三个消费者**（评审补：`useMonthlyScheduleOverview`/`ScheduleCalendar` 实有三处）：① `workbench-left-panel.tsx`（workspace 级，留）② `contact-detail-panel.tsx` 员工 tab（Part C 移除）③ **`schedule-monitor/monitor-panel.tsx`**（经 `chat-layout.tsx` `rightPanel==='monitor'` 挂载）。契约改动后 ② 删除、①③ 的 `ScheduleCalendar` 自动吃新数据。**先确认 MonitorPanel(`rightPanel==='monitor'`)是否仍可达**：可达则同步 retarget + 删其 `TaskStatsCards`；若已不可达（死面板）则整体退役 MonitorPanel（记 log）。
- 工作台左栏 `WorkbenchLeftPanel` 的「日程」`ScheduleCalendar`(workspace 级、不传 employee_id)继续用，自动吃到新数据。

### Part C — 前端员工详情 tab 合并（3→2）

- `contact-detail-panel.tsx`：员工 tab 从 `[任务监控, 成长履历, 编辑员工]` → `[资料与执行(合并), 成长履历]`。
- 合并 tab 单列滚动：`EmployeeEditForm`（基本信息+能力配置）在上 → 分隔 → 「执行历史」`ExecutionMetricsCard` + `ExecutionDetail` 在下。
- 删除：`TaskStatsCards` 挂载 + 该 tab 内 `ScheduleCalendar` 挂载。
- 清理 orphan：`useTaskSummary` + `TaskStatsCards` 在**两处**消费（contact 员工 tab + MonitorPanel）——**必须两处都移除**后 `useTaskSummary`/`TaskStatsCards` 才真正零引用可删（评审纠正：spec 早先「仅 StatsCards 用」结论不全，Part B 已把 MonitorPanel 纳入）。删除前 grep 实证零引用。`ScheduleCalendar`/`useMonthlyScheduleOverview`/`useExecutionMetrics7d`/`useTodayTaskRuns` 全保留（工作台/合并 tab/MonitorPanel 仍用）。

### Part D — 后端清理协调（shift_schedule 彻底可删）

月历 retarget 后，`shift_schedule` 与 `employee_tasks.cron` 再无任何前端读取消费者（shift-calendar 删、月历改源）。故[[shift-schedule-backend-cleanup-blocked]]那个被阻塞的后端清理任务**前提解除**：可彻底删 `shift_schedule`(字段/列/_replace/_normalize/serialize)与员工手动 cron 写路径——但 `employee_tasks` 表 + `upsert_employee_tasks` + orchestrator 写入 + `task_execution_log` + execution-metrics/executions 端点**全部保留**（总管/执行历史在用）。`build_monthly_calendar` 的 `_extract_shift_info`/`_describe_cron` 等随 Part A 重写而退役。本设计 Part A 在本工作内做；shift_schedule 字段级删除归该后端任务（更新其 scope）。

## 数据流

```
recurring/once OrchestrationPlan (schedule_kind/cron/run_at)
  └─ Part A: build_monthly_calendar 按 CronTrigger 展开/once 投影 → days{date:{runs[]}}
       └─ GET /tasks/calendar/monthly → useMonthlyScheduleOverview
            └─ 工作台 ScheduleCalendar 渲染密度 + hover 计划运行

task_execution_log (总管派活也写)
  └─ execution-metrics / executions 端点 → useExecutionMetrics7d / useTodayTaskRuns
       └─ 合并 tab 的「执行历史」ExecutionMetricsCard + ExecutionDetail
```

## 错误处理 / 边界
- recurring cron 无法解析 → 跳过该 plan（warn），不崩整个月历。
- cron 月内可能 fire 很多次（如每分钟）→ 单 plan 当天计数即可，避免 runs 爆炸（每 plan 每天最多记 1 条 + count，或限制单天 runs 上限）。
- naive/aware：plan.run_at 为 naive，比较/投影统一按 CST（参照 [[sqlite-naive-datetime-gotcha]]，补 tzinfo）。
- 时区：CronTrigger 用 timezone=CST，fire time 转本地日期。

## 测试
- 后端：Part A 新测试（cron 展开/once/已跑/隔离/空/不可解析 cron 跳过）。全量 `uv run pytest -q` 零新增失败（基线 1 预存）。
- 前端：`tsc --noEmit` 零新增；删 shift-calendar 后无悬挂引用；合并 tab typecheck 通过。

## 非目标
- 不在本设计做 shift_schedule 字段级后端删除（归后端清理任务）。
- 不做月历的历史执行视图（决策只要「即将到来」）。
- 不动 `task_execution_log`/execution 端点/成长履历。
