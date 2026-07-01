# 排班收敛 + 月历重接总管编排 + 员工 tab 合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Spec: [../specs/2026-06-23-schedule-convergence-and-employee-tab-merge-design.md](../specs/2026-06-23-schedule-convergence-and-employee-tab-merge-design.md)。

**Goal:** 工作台月历从「员工 cron」重接「总管编排计划的即将到来运行」；删冗余的独立排班日历；员工详情 3 tab→2（编辑+执行历史合并）。

**Tech:** FastAPI/SQLAlchemy/APScheduler + React19/TS。后端测 `cd apps/server && uv run pytest`；前端 `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`（baseline ~79 错，零新增）。

**约定:** 显式 `git add <files>`，禁 `-A`（分支有并行 WIP）。提交结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。前端无分号/双引号/2空格。

---

## Part A — 后端月历重接编排计划

### Task A1: build_monthly_calendar 改读 OrchestrationPlan（TDD）

**Files:** `apps/server/src/service/task_service.py`、`apps/server/src/schemas/task.py`、`apps/server/src/api/task_api.py`(包装适配)。Test: NEW `tests/test_monthly_calendar_orchestration.py` + 改写 `tests/test_monthly_calendar_userlevel.py`。

- [ ] **Step 1: 失败测试** `test_monthly_calendar_orchestration.py`：
  - 建 user 的两个 workspace（验多工作空间聚合）；recurring plan（cron `0 9 * * *` 每日9点, status confirmed）→ 断言本月每天 runs 含该 plan、time="09:00"；once plan（run_at 本月某天, last_run_at None）→ 落当天；once 已跑（last_run_at 非空）→ 不出现；不可解析 cron → 跳过不崩；空 → days 各 runs=[]。用 `build_monthly_calendar(db, user_id, year, month)` 直调，断言 `days[d]["runs"]` 结构。
- [ ] **Step 2: 跑确认失败**
- [ ] **Step 3: 实现**
  - 重写 `build_monthly_calendar`：用 `list_user_workspaces(db, user_id)` 取 ws_ids → `select(OrchestrationPlan).where(workspace_id.in_(ws_ids), status=="confirmed", schedule_kind.isnot(None))`。
  - 逐 plan 投影本月 [start_of_month, end_of_month]：
    - recurring：`trig = CronTrigger.from_crontab(plan.cron, timezone=CST)`；从 `max(month_start_dt, cst_now())` 起 `prev=None; t=trig.get_next_fire_time(None, base)`；循环 `while t and t.date() <= end_of_month: 记 days[t.date()].runs += {plan_id,title,schedule_kind:"recurring",time:t.strftime("%H:%M"),cron}; t=trig.get_next_fire_time(t, t)`；每 plan 每天去重（set 记 (plan_id, date)）；cron 解析异常→ warn 跳过。
    - once：`ra=plan.run_at`；naive→`ra=ra.replace(tzinfo=CST)`；若 `last_run_at is None and start_of_month<=ra.date()<=end_of_month` → 记当天 {schedule_kind:"once", time:ra.strftime("%H:%M"), cron:None}。
  - `title` = `(plan.user_input or "")[:30]`。
  - 响应 `{year, month, days:{date:{day,date,runs:[...]}}}`，每天都建（空 runs=[]）。
  - `schemas/task.py`：`MonthlyCalendarDayRead.runs: list[MonthlyCalendarRunRead]`（新模型: plan_id:int, title:str, schedule_kind:str, time:str, cron:str|None）；删 `MonthlyCalendarEmployeeRead`/`MonthlyCalendarTaskRead`（确认无其它引用）。`task_api.py` 包装适配。
- [ ] **Step 4: 改写 test_monthly_calendar_userlevel.py** 旧断言 `day["employees"]`→`day["runs"]`（或删该文件并入新测试，二选一，不弱化覆盖）。
- [ ] **Step 5: 通过 + 全量** `uv run pytest -q`（1 预存失败 test_create_user_workspace_empty）。
- [ ] **Step 6: Commit** `feat(sched): 月历改读总管编排计划的即将到来运行（弃员工cron）`

## Part B — 前端收敛 + retarget 月历

### Task B1: 删独立排班日历 shift-calendar（终态）
- [ ] **Step 1:** 删 `apps/web/src/components/shift-calendar/` 整folder + `workbench/workbench-shift-calendar-sheet.tsx`。
- [ ] **Step 2:** `workbench-left-panel.tsx` 删「员工排班」按钮 + WorkbenchShiftCalendarSheet import/state/render（恢复成 bcb57e6b 后状态）；`lib/query-keys/chat.ts` 删 `shiftCalendar` key。
- [ ] **Step 3:** grep `shift-calendar`/`ShiftCalendar`/`WorkbenchShiftCalendar` 零残留；typecheck 零新增。
- [ ] **Step 4: Commit** `feat(sched): 删独立排班日历，收敛到工作台月历`

### Task B2: ScheduleCalendar 改读 runs 契约
**Files:** `schedule-monitor/sections/schedule-calendar.tsx`、`hooks/use-schedule-monitor-queries.ts`、`types/schedule-monitor.ts`。
- [ ] **Step 1:** `types/schedule-monitor.ts`：`ScheduleDay.employees`→`runs: ScheduleRun[]`（{plan_id,title,schedule_kind,time,cron}）；退役 `ScheduleEmployee`；`MonthlyOverview.days` 同步。
- [ ] **Step 2:** `use-schedule-monitor-queries.ts` `useMonthlyScheduleOverview` 返回类型改 runs；映射后端 `days[].runs`。
- [ ] **Step 3:** `schedule-calendar.tsx`：`countDayTasks`→数 `runs.length`；`getLevel` 密度按 runs 数；`ScheduleDayHoverContent` 列出 runs（标题+time+recurring/once 标签），去掉 employee/cron 旧渲染。
- [ ] **Step 4:** typecheck 零新增；工作台月历能渲染（runs 空时显示无）。
- [ ] **Step 5: Commit** `feat(sched): ScheduleCalendar 渲染编排计划运行（runs 契约）`

## Part C — 员工详情 tab 合并 + MonitorPanel 一致化

### Task C1: 合并「编辑+执行历史」+ 删 StatsCards/旧月历
**Files:** `chat/contacts/contact-detail-panel.tsx`、删 `schedule-monitor/sections/task-stats-cards.tsx`、`monitor-panel.tsx`、`use-schedule-monitor-queries.ts`(删 useTaskSummary)。
- [ ] **Step 1:** READ `contact-detail-panel.tsx` 三 tab 结构 + `monitor-panel.tsx`。先确认 `chat-layout.tsx` `rightPanel==='monitor'` 是否仍可达（grep 设置 rightPanel='monitor' 的入口）；记录结论。
- [ ] **Step 2:** 员工 tab 由 3→2：`[资料与执行(合并), 成长履历]`。合并 tab 单列滚动：`EmployeeEditForm` 上 + 分隔 + `ExecutionMetricsCard`(useExecutionMetrics7d) + `ExecutionDetail`(useTodayTaskRuns) 下。移除 `TaskStatsCards` + 该 tab 内 `ScheduleCalendar` 挂载 + `useTaskSummary`/`useMonthlyScheduleOverview` 在本组件的调用。
- [ ] **Step 3:** MonitorPanel：可达→删其 `TaskStatsCards`(+useTaskSummary 调用)，ScheduleCalendar 留(已 retarget)；不可达→整体退役 MonitorPanel + `chat-layout.tsx` 的 monitor 分支（记 log）。
- [ ] **Step 4:** 两处都去掉 StatsCards 后，grep `useTaskSummary`/`TaskStatsCards` 零引用 → 删 `task-stats-cards.tsx` + `useTaskSummary`。
- [ ] **Step 5:** typecheck 零新增；无悬挂引用。
- [ ] **Step 6: Commit** `feat(employee): 员工详情3→2 tab（编辑+执行历史合并），删失真的排班统计`

---

## Part D — 协调后端清理任务（不在本计划实现）
月历 retarget 落地后，`shift_schedule`/员工 cron 再无前端读消费者。更新 [[shift-schedule-backend-cleanup-blocked]] 那个任务：可彻底删 shift_schedule（字段/列/_replace/_normalize/serialize）+ `build_monthly_calendar` 旧的 `_extract_shift_info`/`_describe_cron` 退役分支；保留 employee_tasks 表/upsert/orchestrator 写入/execution 端点。

## 完成标准
- [ ] 工作台月历显示总管编排计划的即将到来运行；无独立「员工排班」入口。
- [ ] 员工详情 2 tab；合并 tab 上编辑下执行历史；任务监控只剩 Metrics+Detail。
- [ ] 后端全量零新增失败；前端 typecheck 零新增；无悬挂引用。

## 收尾
- `superpowers:requesting-code-review` 整条 diff 复审。
- 手测：建递归定时计划→工作台月历对应天出现；员工详情两 tab；执行历史正常。
- 更新记忆 + 协调后端任务。
