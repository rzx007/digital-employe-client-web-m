# 定时轮原生通知 + 铃铛重用 Implementation Plan

> 纯重接线，复用现成基建。前端 typecheck `cd apps/web && npx tsc -p tsconfig.app.json --noEmit`（baseline ~79，零新增）；后端 `cd apps/server && uv run pytest`（基线 1 预存失败 test_create_user_workspace_empty，+reminder WIP 的红与本工作无关）。

**Goal:** 定时编排轮触发时给原生 OS 通知 + 把失效的工具栏铃铛重用为「定时轮通知中心」。

**根因（复盘坐实）:** 原生通知 hook(`use-task-execution-notifications`) 与铃铛(`NotificationBell`) 都读 `useAllTaskExecutions()`，其内部 `filter(confirm_execution_result)`——该字段只由已退场的手动任务配置设；新模型下永远空 → 两条链空跑。改为由「定时轮事件」驱动。

**设计（决策已定）:** 定时轮在 `run_plan_job` **触发时**发一个 workspace 事件（一轮一条）→ 前端 `useWorkspaceEvents` 收 → ①调现成 `api.sendNotification`（IPC 自带「仅失焦弹」）②灌进 notification-store 未读列表 → 铃铛读 store，点项深链到本轮只读会话。

**约定:** 显式 `git add <files>`，禁 `-A`（分支有并行 WIP：SKILL.md / reminder 功能 / orchestration_plan.py 等，勿碰勿 stage）。提交结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。前端无分号/双引号/2空格。

---

## Task 1: 后端——run_plan_job 发定时轮事件

**Files:** `apps/server/src/service/task_scheduler_service.py`(run_plan_job ~475-515)、`apps/server/src/service/workspace_events.py`(事件常量)。Test: `tests/test_scheduled_recurring_orchestration.py` 或新增小测试。

- [ ] **Step 1: READ** `run_plan_job` 全文 + `execute_plan_run` 返回值（execution.py:160 返回 `run`，含 `conversation_id`/`run_seq`）+ `WorkspaceEventBus.push` 签名 + 现有事件 type 命名（task_started 等）。
- [ ] **Step 2: 失败测试** monkeypatch `WorkspaceEventBus.push` 收集调用；跑 `run_plan_job(plan_id)`（参照 `test_run_plan_job_once_auto_stops` 的 setup，monkeypatch execute_plan_run 返回一个带 conversation_id/run_seq 的假 run）；断言 push 被以 `{type:"scheduled_run", plan_id, run_id, run_seq, conversation_id, title}` 调用一次。
- [ ] **Step 3: 实现** `run_plan_job` 里捕获 `run = execute_plan_run(...)`（现在没接收返回值），成功后 `WorkspaceEventBus.push(plan.workspace_id, {"type":"scheduled_run","plan_id":plan.id,"run_id":run.id,"run_seq":run.run_seq,"conversation_id":run.conversation_id,"title":(plan.user_input or "")[:40]})`。包 try/except 不让发事件失败影响调度（记 log）。仅 `trigger=="scheduled"` 这条路径发（run_plan_job 本就是定时入口）。
- [ ] **Step 4: 通过 + 全量**（仅看本测试 + 与基线对比无新增失败；reminder WIP 的红忽略）。
- [ ] **Step 5: Commit** `feat(notify): 定时轮触发时发 scheduled_run 工作空间事件`

## Task 2: 前端——事件→原生通知 + store

**Files:** `apps/web/src/hooks/use-workspace-events.ts`(加事件类型)、`apps/web/src/stores/notification-store.ts`(加定时轮通知列表)、新 hook `apps/web/src/hooks/use-scheduled-run-notifications.ts`、`apps/web/src/components/chat/shell/chat-layout.tsx`(替换挂载)。

- [ ] **Step 1: READ** `use-workspace-events.ts:6-90` 事件 union + dispatch(159)；`notification-store.ts` 全文；`use-task-execution-notifications.ts`（要替换的死 hook）；`getElectronApi`/`api.sendNotification` 用法。
- [ ] **Step 2:** `use-workspace-events.ts`：给 `WorkspaceEvent` union 加 `{ type:"scheduled_run"; plan_id:number; run_id:number; run_seq:number; conversation_id:number; title:string }`。
- [ ] **Step 3:** `notification-store.ts`：加 `items: ScheduledRunNotification[]`（{run_id,title,run_seq,conversation_id,ts,read}）、`push(item)`（按 run_id 去重）、`markRead(run_id)`、`markAllRead()`、派生 `unreadCount`。保留既有 dialogOpen/autoPopupDisabled。
- [ ] **Step 4:** 新 hook `useScheduledRunNotifications()`：用 `useWorkspaceEvents` 订阅 `scheduled_run` 事件 → `store.push({...})` + `getElectronApi()?.sendNotification(`定时任务已运行`, `「${title}」· 第${run_seq}轮`, false)`（IPC 自带失焦判断，无需前端判焦点）。
- [ ] **Step 5:** `chat-layout.tsx:144`：把 `useTaskExecutionNotifications()` 换成 `useScheduledRunNotifications()`。删除死 hook 文件 `use-task-execution-notifications.ts`（grep 确认无其它引用）。
- [ ] **Step 6:** typecheck 零新增。
- [ ] **Step 7: Commit** `feat(notify): 定时轮事件驱动原生通知 + 写入通知 store（替换失效的执行结果轮询）`

## Task 3: 前端——铃铛重用为定时轮通知中心

**Files:** `apps/web/src/components/chat/notifications/notification-center.tsx`(NotificationBell + NotificationDialog)。

- [ ] **Step 1: READ** `notification-center.tsx` 全文（NotificationBell:173 / NotificationDialog:248），看清现有未读角标/列表/已读 UI；`today-task-list.tsx` 里点 plan 行跳会话的 `selectConversationForContact(curatorContactId, conversation_id)` 用法（复用作深链）。
- [ ] **Step 2:** `NotificationBell` 数据源从 `useAllTaskExecutions().filter(confirm...)` 改为 notification-store 的 `items`/`unreadCount`。角标显示 unreadCount，铃铛 filled/outline 逻辑保留。
- [ ] **Step 3:** `NotificationDialog` 列表渲染 store items（标题「『X』· 第N轮」+ 相对时间 + 未读点）；点项 → `markRead(run_id)` + 深链到 `conversation_id`（仿 today-task-list：切总管联系人 + selectConversationForContact）→ 关 dialog。「全部已读」调 markAllRead。空态文案「暂无定时任务通知」。
- [ ] **Step 4:** 移除对 `useAllTaskExecutions`/`confirm_execution_result` 的依赖（若该 query 退场后零引用，标注但本任务不删——它可能还被 curator-overview-section 用，grep 确认；仅解除铃铛对它的依赖）。
- [ ] **Step 5:** typecheck 零新增 + 无悬挂引用。
- [ ] **Step 6: Commit** `feat(notify): 铃铛重用为定时轮通知中心（未读+深链本轮会话）`

---

## 完成标准
- [ ] 定时编排轮触发 → 后端发 scheduled_run 事件 → 前端（应用失焦时）弹原生通知 + 铃铛未读+1。
- [ ] 点铃铛项 → 跳到该轮只读会话；可标已读/全部已读。
- [ ] 死的 confirm_execution_result 通知链解除；前端 tsc 零新增、后端无新增失败。

## 收尾
- 手测：建「每2分钟…」递归计划→切到别的窗口→到点收到系统通知→回来铃铛有未读→点开跳本轮会话。
- 更新记忆。
