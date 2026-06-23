# 退场员工手动排班/任务编辑 UI（前端）Implementation Plan

> **For agentic workers:** 纯前端退场（删除+改造），后端本轮不动（单独任务 task_328dcb4d 跟进）。验证以 `tsc --noEmit` 零新增错误 + 无悬挂引用为准。

**Goal:** 移除「员工手动排班/任务编辑」的全部前端入口——员工详情编辑tab的「配置排班和任务」段、入职 HireSheet 的排班/任务段、整个排班日历 shift-calendar 功能——因总管中心化后任务统一由总管编排，这套手动入口已是历史遗留。

**背景/决策:**
- 总管(orchestrator)是任务唯一入口；员工手动排班+手动建 cron 任务退场。
- 只读「任务监控」tab（ContactMonitorSection，走 schedule-monitor 查询）**独立、保留**，不受影响。
- 后端**完全不动**（端点/employee_tasks 表/upsert/orchestrator 写入全保留，总管在用）；前端只是不再发送 `tasks`/`shift_schedule`。后端死代码清理 = 单独任务。

**Tech Stack:** React 19 / TypeScript / Electron。前端 typecheck：`cd apps/web && npx tsc -p tsconfig.app.json --noEmit`（与已有 baseline 错误对比，零新增）。

**约定:** 显式 `git add <files>`，禁 `git add -A`（分支有并行 WIP）。提交结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。代码风格：无分号、双引号、2 空格。

---

## 退场表（来自完整探查）

### 删除整文件
- `apps/web/src/components/employee/schedule-task-config.tsx`（ScheduleTaskConfig）
- `apps/web/src/components/employee/task-edit-dialog.tsx`（TaskEditDialog）
- `apps/web/src/components/shift-calendar/`（**整个文件夹**：shift-calendar-page / grid / toolbar / day-cell / shift-edit-sheet / hooks/ / index.ts）

### 改造
- `apps/web/src/components/employee/employee-edit-form.tsx` — 删「配置排班和任务」开关段 + 相关 state/init/payload/imports
- `apps/web/src/components/employee/hire-sheet.tsx` — 删排班/任务段 + 相关 state/reset/payload/imports
- `apps/web/src/components/workbench/workbench-left-panel.tsx` — 删「员工排班」按钮 + WorkbenchShiftCalendarSheet 引用/state
- `apps/web/src/components/employee/index.ts` — 删 ScheduleTaskConfig / TaskEditDialog 导出
- `apps/web/src/api/employee.ts` — `CreateEmployeeParams` 去 `shift_schedule`/`tasks` 字段；`buildEmployeeBody` 去对应映射
- `apps/web/src/types/task.ts` — 删因此 orphan 的符号（grep 确认无其它引用后；典型 `scheduleTaskListItemToFormData`、`parseEmployeeTaskSource`，以及随 shift-edit-sheet 删除后才 orphan 的 `convertApiEmployeeTasksToListItems`/`tasksToApiPayload`/`ShiftScheduleForm`/`ScheduleTaskListItem`/`ApiEmployeeTaskRead` 等——**逐个 grep 全 apps/web/src 确认零引用再删**，仍被只读监控/其它处用的保留）

### 保留不动（确认独立）
- 只读「任务监控」tab：`contact-detail-panel.tsx` ContactMonitorSection + `hooks/use-schedule-monitor-queries` + `schedule-monitor/` 组件。

---

## Task 1: 删两个员工配置组件 + 改两个员工表单 + barrel

- [ ] **Step 1: 改 employee-edit-form.tsx**
  删除：imports（convertApiEmployeeTasksToListItems, tasksToApiPayload, ApiEmployeeTaskRead, ScheduleTaskListItem, ShiftScheduleForm, ScheduleTaskConfig）；state（showScheduleAndTask, tasks, schedule）；`getEmployeeFormInitialState` 里 tasks/schedule 提取逻辑及返回字段；handleSubmit payload 里 `shift_schedule`/`tasks` 两行；UI「配置排班和任务」开关段（toggle + `{showScheduleAndTask && <ScheduleTaskConfig.../>}`）。保留：基本信息、能力配置、提交校验、CapabilityPicker。
- [ ] **Step 2: 改 hire-sheet.tsx**
  同上模式：删 imports（tasksToApiPayload, ScheduleTaskListItem, ShiftScheduleForm, ScheduleTaskConfig）、state、useEffect reset 三行、handleSubmit payload 两行、UI 段。保留基本信息+能力配置+提交。
- [ ] **Step 3: 删 employee/index.ts 的 ScheduleTaskConfig / TaskEditDialog 导出**
- [ ] **Step 4: 删文件** `schedule-task-config.tsx`、`task-edit-dialog.tsx`
- [ ] **Step 5: typecheck** `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`，对比 baseline 零新增。先不删 types/task.ts 符号（Task 3 统一处理），此步允许临时 unused。
- [ ] **Step 6: Commit**（`git add` 上述文件）：`feat(employee): 退场员工详情编辑/入职里的手动排班+任务配置入口`

## Task 2: 退场整个排班日历 shift-calendar

- [ ] **Step 1: 改 workbench-left-panel.tsx** 删「员工排班」按钮、WorkbenchShiftCalendarSheet import + state + 渲染。
- [ ] **Step 2: grep** `shift-calendar`、`ShiftCalendar`、`ShiftEditSheet`、`use-shift-calendar` 全 apps/web/src，确认除 workbench-left-panel 外无其它引用（有则一并处理）。
- [ ] **Step 3: 删整个 `apps/web/src/components/shift-calendar/` 文件夹**
- [ ] **Step 4: typecheck** 零新增。
- [ ] **Step 5: Commit**：`feat(employee): 退场排班日历 shift-calendar（总管中心化后无手动排班入口）`

## Task 3: 清理 api/employee.ts + types/task.ts orphan 符号

- [ ] **Step 1: api/employee.ts** `CreateEmployeeParams` 去 `shift_schedule`/`tasks`；`buildEmployeeBody` 去对应条件映射块。grep 这两字段的其它使用确认安全。
- [ ] **Step 2: types/task.ts** 逐个 grep（`scheduleTaskListItemToFormData`、`parseEmployeeTaskSource`、`convertApiEmployeeTasksToListItems`、`tasksToApiPayload`、`ShiftScheduleForm`、`ScheduleTaskListItem`、`TaskFormData`、`CronExpressionType` 等）在 apps/web/src 的引用；**仅删零引用者**，被只读监控/其它处用的保留。
- [ ] **Step 3: 删 `@/lib/cron-utils`** 里仅被已删组件用的函数（grep `parseCronToExecuteTime`/`executeTimeToCronExpression` 确认零引用后删；否则保留）。
- [ ] **Step 4: typecheck 零新增 + 无 unused 残留**（`tsc` + 可选 `pnpm lint --filter=web`）。
- [ ] **Step 5: Commit**：`chore(employee): 清理退场后 orphan 的排班/任务类型与工具`

---

## 完成标准
- [ ] 三处入口（编辑tab、入职、排班日历）手动排班/任务 UI 全部移除；工作台无「员工排班」按钮。
- [ ] 只读「任务监控」tab 正常。
- [ ] `tsc --noEmit` 零新增错误；无悬挂 import / unused 符号。
- [ ] 后端零改动（单独 task_328dcb4d 跟进）。

## 收尾
- 手测：员工详情编辑tab 只剩基本信息+能力配置；入职流程无排班/任务段；工作台无排班入口；任务监控 tab 仍显示执行。
- 更新记忆。
