# 群协作：计划卡进度与协作流程 DAG 状态对齐（单一事实源）

日期：2026-06-19
状态：设计待评审

## 背景与问题

群聊会话里同一个编排计划，在两处展示执行状态：

1. **左侧聊天流的计划卡**（`plan-generated-card.tsx`）—— 确认执行后渲染 `TaskProgressBar`，
   显示「执行中 N/M (x%)」「待执行/执行中/成功」。
2. **右侧「协作流程」面板**（`group-sop-panel.tsx`）—— 渲染后端权威 DAG，
   显示节点「待命/进行中/已交付」与「N/M 已交付」。

**实测现象**：同一请求下，左侧计划卡停在「执行中 0/2 (0%)、待执行」，
右侧协作流程却已全绿「已交付 1/1」。两个视图描述同一件事，状态完全相反。

### 根因

两个视图的执行状态来自**两套独立数据源，没有单一事实源**：

- 左侧进度条的 `total/completed/statusByTaskId` 全部来自 `usePlanProgress`
  （`apps/web/src/hooks/use-plan-progress.ts`）。该 hook **只监听 SSE 事件**
  `task_started/completed/failed`，在前端本地按 `task_id` 累加，**不查任何接口**。
- 这条 `WorkspaceEventBus` 事件流**无重放**（见 `use-group-room.ts` 断后重连注释）。
  断流窗口内漏掉一条 `task_completed`，计划卡就**永久卡在 0/2**，因为它没有回补机制。
- 右侧 DAG 来自 `fetchGroupRoomDag` 后端权威态（基于 `TaskExecutionLog` 落库），
  带 `useQuery` staleTime + 事件 invalidate 回补，所以它显示的是真相。

→ 一个看易丢的瞬时流、一个看落库真相，必然在某些时刻打架，且 SSE 漏事件后左侧永久错。

## 设计决策（已与用户确认）

1. **SSE 保留，只做「领先提示」**：后端权威态（DAG / orchestrationPlans query）为唯一真相；
   SSE 事件仅用于在后端落库前提前点亮 running，让进度更跟手。漏事件不再导致永久错误，
   因为权威态会回补。
2. **计划卡化简，重状态交给 DAG**：左侧计划卡只保留「计划已生成 / 确认执行 / 取消」这个
   **决策点**，确认后不再在卡内重复画实时进度条；所有「执行中 N/M、已交付」的辐度状态
   只由右侧 DAG 展示。

## 范围

### 改动点 1：计划卡化简（核心，消除打架的数据源）

文件：`apps/web/src/components/chat/message-blocks/plan-generated-card.tsx`

- 删除确认后渲染的 `TaskProgressBar`（当前第 351–375 行 `showConfirmedMessage` 分支里
  `planTaskIds.length > 0` 的那支）。
- `showConfirmedMessage` 为真时，统一渲染一句静态提示，例如：
  「✓ 已确认执行，进度见右侧「协作流程」。」
- 移除本组件对 `usePlanProgress`、`TaskProgressBar`、`OrchestrationTaskProgress` 的 import 与调用
  （`planTaskIds`、`statusByTaskId`、`completed`、`total` 一并删除）。
- **不动**确认/取消流程：`handleConfirm` / `handleCancel` / `remoteStatus` / `showActionPanel`
  / `showConfirmedMessage` / `showCancelledMessage` 的判定逻辑全部保留（它们已走后端权威态）。

> 说明：化简后左侧不再持有任何独立进度数据源，与右侧 DAG 的不一致从根上消失。
> 由于群协作场景右侧 DAG 面板常驻可见，用户不会失去进度可见性。

### 改动点 2：重复「编排计划已生成」卡的去重

文件：`apps/web/src/hooks/use-group-room.ts`（`orchestration_plan_generated` 事件处理）
及计划卡的渲染入口。

- 现象：同一请求出现两张「编排计划已生成」卡。
- 方向：渲染时按 `plan_id` 去重（同一 `plan_id` 只渲染一张计划卡）。
- 实现前需先定位计划卡在聊天流中的装配位置（`block-render-map.tsx` / `chat-message-item.tsx`），
  确认重复来源是「同一 plan_id 的两条投影消息」还是「事件重复触发 append」，再决定去重落点。
  （此点列为本期范围，但在写实现计划阶段先补一次定位。）

### 不在本期范围

- 左右视图合并为单一组件（用户选择「保留两者、只做同源」，合并另起一期）。
- 右侧 DAG 把并行任务画成串行直线的问题（`computeLevels` / 后端 DAG 边建模）——
  独立缺陷，另开任务。
- `usePlanProgress` 是否在员工（非群）场景仍被其它卡片使用：实现前需 grep 确认，
  若仅群计划卡使用则可考虑后续清理；本期**不删除该 hook**，只解除计划卡对它的依赖。

## 数据流（修复后）

- 计划「是否已确认/取消」：来自 `useOrchestrationPlansQuery` 的 `remoteStatus`（权威）。
- 任务「执行中/已交付」辐度状态：仅右侧 `group-sop-panel` 经 `fetchGroupRoomDag`（权威）。
- SSE `task_*` 事件：继续触发 `use-group-room` 里对 DAG / orchestrationPlans / messages 的
  invalidate（领先回补），但**不再**作为任何 UI 的唯一真相。

## 测试

- `plan-generated-payload.test.ts` 既有用例须继续通过。
- 新增/调整：计划卡在 `showConfirmedMessage` 为真时渲染静态提示而非进度条（快照或断言文案）。
- 手动验证：群会话发并行需求 → 确认执行 → 左侧卡显示「已确认执行，进度见右侧」，
  右侧 DAG 正常推进至「已交付」，两边不再矛盾；人为制造 SSE 漏事件（断流）后，
  左侧不再卡死、右侧仍正确收敛。

## 风险

- 误删确认/取消逻辑 → 缓解：改动严格限定在 `showConfirmedMessage` 渲染分支，
  按钮与状态判定不动。
- 去重落点选错导致计划卡不显示 → 缓解：去重前先定位装配位置并加测。
