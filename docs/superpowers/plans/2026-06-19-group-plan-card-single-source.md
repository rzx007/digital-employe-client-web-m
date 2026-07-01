# 群计划卡单一事实源 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除左侧计划卡与右侧协作流程 DAG 的执行状态打架——让计划卡确认后不再用易丢的 SSE 聚合自画进度条，辐度状态统一交给右侧 DAG。

**Architecture:** `plan-generated-card.tsx` 的确认/取消流程本就走后端权威态（`useOrchestrationPlansQuery` 的 `remoteStatus`），唯一的独立数据源是确认后渲染的 `TaskProgressBar`——它的 `total/completed/statusByTaskId` 全来自 `usePlanProgress`（仅监听无重放 SSE、本地累加、不回补）。本计划把这段进度条替换为一句静态提示，并解除计划卡对 `usePlanProgress` 与 `TaskProgressBar` 的依赖。SSE 在 `use-group-room.ts` 里继续触发 DAG/plan/messages 的 invalidate（领先回补），不再作为任何 UI 的唯一真相。

**Tech Stack:** React 19, TanStack Query, Vitest 4 + @testing-library/react + happy-dom。

**关联 spec:** `docs/superpowers/specs/2026-06-19-group-plan-card-single-source-design.md`

**前置已确认事实（grep 验证）：**
- `usePlanProgress` 与 `TaskProgressBar` **仅被 `plan-generated-card.tsx` 引用**，解耦后两者成为死代码（本期按 spec 不删除，仅在末尾任务标注）。
- 计划卡经 `block-render-map.tsx:171` 的 `block.kind === "plan-generated"` 分支渲染。
- 「同一请求两张计划卡」属上游 message 分类/落库层，与本状态打架根因相互独立——列为 Task 3 的独立调查任务，不阻塞核心修复。

---

## File Structure

- `apps/web/src/components/chat/message-blocks/plan-generated-card.tsx` — 核心改动：移除进度条与 SSE 聚合依赖，确认后渲染静态提示。
- `apps/web/src/components/chat/message-blocks/plan-generated-card.test.tsx` — 新建：断言确认态下渲染静态提示而非进度条。
- （Task 3 调查后可能涉及）`apps/web/src/lib/chat/message-classifier.ts` 或消息落库/append 层——去重落点待 Task 3 定位。

---

## Task 1: 给计划卡补「确认态渲染静态提示」的测试（先红）

**Files:**
- Test: `apps/web/src/components/chat/message-blocks/plan-generated-card.test.tsx`（新建）

本任务先写一个会失败的组件测试，锁定目标行为：当计划处于已确认（`remoteStatus` 非 pending/cancelled）时，卡片渲染静态文案「进度见右侧」且**不**渲染进度条的「执行中 N/M」。

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/chat/message-blocks/plan-generated-card.test.tsx`：

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PlanGeneratedCard } from "./plan-generated-card"

// 计划卡依赖：远端计划状态 query + 总管反馈 context。两者都打桩成「计划已确认」。
vi.mock("@/hooks/use-chat-queries", () => ({
  useOrchestrationPlansQuery: () => ({
    data: [{ id: 99, status: "executing" }],
  }),
}))
vi.mock("@/components/chat/curator/curator-plan-feedback-context", () => ({
  useCuratorPlanFeedback: () => null,
}))

const RESULT = JSON.stringify({
  type: "plan_generated",
  plan_id: 99,
  summary: "并行查询",
  tasks: [
    { task_id: 1, task_name: "查微博热搜", employee_name: "微博助手" },
    { task_id: 2, task_name: "查小米价格", employee_name: "浏览器助手" },
  ],
})

describe("PlanGeneratedCard（已确认态）", () => {
  it("渲染静态提示、不渲染进度条的「执行中 N/M」", () => {
    render(
      <PlanGeneratedCard
        input={{ summary: "并行查询" }}
        state="output-available"
        resultText={RESULT}
        conversationId={1}
        isTurnEnded
      />
    )
    // 静态提示在场
    expect(screen.getByText(/进度见右侧/)).toBeTruthy()
    // 进度条特征文案「执行中 0/2」不应出现（旧 TaskProgressBar 的标志）
    expect(screen.queryByText(/0\/2/)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter web test:unit plan-generated-card`
Expected: FAIL —— 当前确认态走 `TaskProgressBar`，页面没有「进度见右侧」文案（`getByText` 抛错）；且会出现「0/2」。

- [ ] **Step 3: 提交（红测试入库，便于审阅）**

```bash
git add apps/web/src/components/chat/message-blocks/plan-generated-card.test.tsx
git commit -m "test(chat): 计划卡确认态应渲染静态提示而非进度条(先红)"
```

---

## Task 2: 计划卡解除 SSE 进度依赖，确认后渲染静态提示（转绿）

**Files:**
- Modify: `apps/web/src/components/chat/message-blocks/plan-generated-card.tsx`

把确认态下的 `TaskProgressBar` 分支整体替换为静态提示，并删除 `usePlanProgress` / `TaskProgressBar` / `OrchestrationTaskProgress` 的 import 与相关派生变量。`handleConfirm` / `handleCancel` / `remoteStatus` / `showActionPanel` / `showConfirmedMessage` / `showCancelledMessage` 全部保留不动。

- [ ] **Step 1: 删除三处 import**

删除以下三行（当前位于文件第 26–28 行附近）：

```tsx
import { TaskProgressBar } from "./task-progress-bar"
import { usePlanProgress } from "@/hooks/use-plan-progress"
import type { OrchestrationTaskProgress } from "./orchestration-plan-card"
```

- [ ] **Step 2: 删除 SSE 聚合派生变量**

删除当前第 97–105 行的 `planTaskIds` memo 与 `usePlanProgress` 调用：

```tsx
  // 子任务实时进度：确认执行后，按 task_started/completed/failed 事件聚合。
  const planTaskIds = React.useMemo(
    () =>
      (data?.tasks ?? [])
        .map((t) => t.task_id)
        .filter((id): id is number => typeof id === "number"),
    [data?.tasks]
  )
  const { statusByTaskId, completed, total } = usePlanProgress(planTaskIds)
```

> 注意：`data` 在此之后仍被使用（任务列表渲染、summary），不要删 `data`。

- [ ] **Step 3: 替换确认态渲染分支为静态提示**

将当前第 351–375 行的 `showConfirmedMessage` 分支（含 `planTaskIds.length > 0 ? <TaskProgressBar .../> : <p>...`）整段替换为：

```tsx
      {showConfirmedMessage && (
        <p className="text-muted-foreground mt-2.5 text-[11px]">
          ✓ 已确认执行，进度见右侧「协作流程」。
        </p>
      )}
```

> `showCancelledMessage` 分支（紧随其后）保持不变。

- [ ] **Step 4: 运行 Task 1 的测试，确认转绿**

Run: `pnpm --filter web test:unit plan-generated-card`
Expected: PASS —— 「进度见右侧」在场，「0/2」不再出现。

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter web typecheck`
Expected: 通过，无未使用变量/缺失引用报错（`statusByTaskId`/`completed`/`total`/`planTaskIds` 均已删除，无悬空引用）。

- [ ] **Step 6: 跑既有 payload 测试确保未回归**

Run: `pnpm --filter web test:unit plan-generated-payload`
Expected: PASS（本任务未触碰 `plan-generated-payload.ts`，应保持绿）。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/chat/message-blocks/plan-generated-card.tsx
git commit -m "fix(chat): 计划卡确认后只提示进度见右侧DAG，移除易丢SSE自画进度条(消除左右状态打架)"
```

---

## Task 3: 调查并修复「同一请求两张编排计划卡」重复渲染

**Files:**
- 调查起点：`apps/web/src/lib/chat/message-classifier.ts`、`apps/web/src/hooks/use-group-room.ts:148`（`orchestration_plan_generated` 事件处理）、消息落库/append 路径。
- 实际修改文件：**调查后确定**（不在本任务预先假定）。

> 本任务与 Task 1/2 的状态打架根因相互独立。先做无副作用的定位，再决定去重落点与改法；若调查发现重复来自后端发了两条投影消息（前端无法单方面去重），则改为产出一份「根因在后端」的结论记录、不强行前端打补丁。

- [ ] **Step 1: 复现并定位重复来源**

在群会话发一条会触发并行编排的需求，观察是否出现两张「编排计划已生成」卡。用以下方式判断重复层级：
- 在 `block-render-map.tsx` 的 `plan-generated` 分支临时 `console.log(block.key, block.resultText)`，看是否两张卡的 `plan_id` 相同。
- 检查 `message-classifier.ts` 是否把同一条消息里的工具调用拆成了两个 `plan-generated` block，或 `use-group-room.ts:148` 的 invalidate 是否导致同一 `plan_id` 的投影消息被拉出两条。

记录结论：重复发生在 (a) 同一消息分类成两个 block / (b) 两条不同消息各含一个相同 plan_id / (c) 后端推了两条事件。

- [ ] **Step 2: 按结论选择去重落点**

- 若为 (a)：在 `message-classifier.ts` 对 `plan-generated` block 按 `plan_id` 去重（同一 plan_id 只保留一个 block）。
- 若为 (b)：在计划卡渲染的上游（消息列表组装处）按 `plan_id` 折叠重复投影消息。
- 若为 (c)：记录为后端缺陷，产出结论文档 `docs/notes/2026-06-19-duplicate-plan-card.md`，本任务到此为止（不前端硬补）。

- [ ] **Step 3: 若 (a)/(b)，补去重测试**

针对选定落点的纯函数（如 classifier 的输出）写测试：输入含两个相同 `plan_id` 的来源 → 输出只含一个 plan-generated 结果。测试文件与被测模块同目录、`.test.ts` 后缀。

（具体断言代码在 Step 1 定位出确切函数签名后填入；若为 (c) 则跳过本步。）

- [ ] **Step 4: 实现去重并验证**

Run: `pnpm --filter web test:unit <对应测试文件名>`
Expected: PASS；并手动复现确认群会话只剩一张计划卡。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix(chat): 同一plan_id的编排计划卡去重(消除重复渲染)"
```

---

## Task 4: 标注解耦后的死代码（收尾，不删除）

**Files:**
- Modify: `apps/web/src/hooks/use-plan-progress.ts`
- Modify: `apps/web/src/components/chat/message-blocks/task-progress-bar.tsx`

Task 2 后这两者已无引用方。按 spec 本期不删除，仅加注释说明现状，避免后人误以为仍在用。

- [ ] **Step 1: 在两文件顶部各加一行注释**

`use-plan-progress.ts` 文件顶部加：

```tsx
// NOTE(2026-06-19): 计划卡已改为后端权威态驱动，本 hook 暂无引用方（保留以备未来「领先提示」复用）。
```

`task-progress-bar.tsx` 文件顶部加：

```tsx
// NOTE(2026-06-19): 计划卡确认态已改为静态提示，本组件暂无引用方（进度统一由右侧协作流程 DAG 展示）。
```

- [ ] **Step 2: 确认确无引用**

Run: `pnpm --filter web typecheck`
Expected: 通过（注释不影响类型）。并用 grep 复核：`usePlanProgress`/`TaskProgressBar` 在 `.tsx/.ts` 中除自身定义与注释外无其它引用。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/hooks/use-plan-progress.ts apps/web/src/components/chat/message-blocks/task-progress-bar.tsx
git commit -m "chore(chat): 标注计划卡解耦后暂无引用的进度hook/组件"
```

---

## Self-Review

**Spec coverage:**
- 改动点1（计划卡化简、移除 usePlanProgress/TaskProgressBar、确认后静态提示）→ Task 1+2。✓
- 改动点2（重复计划卡按 plan_id 去重，先定位再改）→ Task 3。✓
- 不删除 usePlanProgress、不在本期合并左右视图、不动 computeLevels → 计划未越界；死代码处理为「标注不删」= Task 4，符合 spec「本期不删除该 hook」。✓
- SSE 保留作领先回补 → 计划未触碰 `use-group-room.ts` 的 invalidate 逻辑（除 Task 3 调查可能读它），符合「SSE 保留只做领先提示」。✓

**Placeholder scan:** Task 3 Step 3 的断言代码标注「定位出函数签名后填入」——这是 TDD 调查型任务的合理留白（去重落点本就需先定位），且已给出 (a)/(b)/(c) 三分支的明确决策树与各自落点，非模糊 TODO。其余步骤均含完整代码/命令/预期。

**Type consistency:** Task 2 删除的 `statusByTaskId/completed/total/planTaskIds` 均为同一组、删除后无残留引用；保留的 `data`/`remoteStatus`/`showConfirmedMessage` 命名与现有代码一致。✓
