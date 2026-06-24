# backgroundSessions 会话删除回收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `browser-store` 的 `backgroundSessions` Set 补一条「会话删除时回收对应 conversationId」的路径，堵住后台会话浏览器在无 tagged close 事件时关闭导致的 id 永久滞留泄漏。

**Architecture:** `backgroundSessions` 这套代码只在 `claude/sharp-kalam-9012c5`（commit `e6cff0e`）上，需先合进 `dev`。store 已有幂等的 `clearBackground(id)`，无需改 store 逻辑；只在三个会删除会话的 react-query mutation 的 `onSuccess` 里对受影响 id 调 `clearBackground`，并补一行「不接 task-end」的文档注释。

**Tech Stack:** TypeScript, React 19, Zustand, TanStack Query, Vitest。仓库根 `D:\doc\code\ai\digital-employee-client`（注意：`dev` 与 `kalam` 各自被独立 worktree checkout 占用）。

---

## 前置说明（执行者必读）

- 本仓库是 monorepo + 多 git worktree。`dev` 被主 worktree（`D:/doc/code/ai/digital-employee-client`）checkout，`claude/sharp-kalam-9012c5` 被 `…/.claude/worktrees/sharp-kalam-9012c5` checkout。**同一分支不能在两个 worktree 同时 checkout**，故对 `dev` 的合并/提交必须在主 worktree 里做。
- 本计划文档当前提交在 `claude/practical-mayer-51df64` 分支；实现工作在 `dev`。
- 命令用 Git Bash（POSIX）。typecheck/test 用 pnpm filter 到 `web` 包。
- 合并 kalam→dev 已用 `git merge-tree` 干跑验证**无冲突**。

---

## Task 1: 把 kalam 合进 dev（前置依赖）

**Files:** 无源码改动，纯分支操作。

- [ ] **Step 1: 切到主 worktree 并确认 dev 干净**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: 工作区 clean，当前分支 `dev`。若不是 `dev`，先 `git checkout dev`（确保没有其它 worktree 占用 dev）。

- [ ] **Step 2: 再次干跑确认无冲突**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && git merge-tree $(git merge-base dev claude/sharp-kalam-9012c5) dev claude/sharp-kalam-9012c5 | grep -iE "CONFLICT|<<<<<<<|changed in both" || echo "NO-CONFLICT"
```
Expected: 输出 `NO-CONFLICT`。若出现 CONFLICT，**停止**并人工介入——本计划假定干净合并。

- [ ] **Step 3: 执行合并**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && git merge --no-ff claude/sharp-kalam-9012c5 -m "Merge: 浏览器面板按发起会话归属摊开（backgroundSessions 基底）"
```
Expected: 合并成功，无冲突提示。

- [ ] **Step 4: 验证 backgroundSessions 已在 dev 上**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && git grep -n "backgroundSessions" -- apps/web/src/stores/browser-store.ts | head -3
```
Expected: 能 grep 到 `backgroundSessions: Set<string>` / `noteBackgroundOpen` / `clearBackground`。

- [ ] **Step 5: 后续 Task 在哪做**

合并后，`dev` 已含目标代码。后续 Task 2–4 的源码改动在主 worktree 的 `dev` 上进行（或由执行框架按需切换；关键是分支为 `dev`）。本 Task 无需 commit（merge 已是一个 commit）。

---

## Task 2: 给 `clearBackground` 补回收语义的单元测试

**Files:**
- Test: `apps/web/src/stores/browser-store.test.ts`（在 `dev` 上，含 backgroundSessions 的版本）

说明：`clearBackground`/`noteBackgroundOpen` 已实现且幂等，但当前测试文件未覆盖。先补测试锁定「删除回收」依赖的核心契约（幂等 + 精确删除）。这是 TDD 里「为已存在但未测的契约补网」，测试应直接通过。

> **合并后实测注意（重要）**：合进 dev 后 `backgroundSessions` 是 **`Map<string, string>`**（conversationId → 最后导航 url），不是 spec 早前假设的 `Set<string>`；`noteBackgroundOpen(conversationId, url)` **需要第二个 `url` 参数**。`.has(id)` 在 Map 上同样可用，回收逻辑 `clearBackground(id)` 不变。下面测试代码已按 Map API 写。

- [ ] **Step 1: 追加测试块**

在 `apps/web/src/stores/browser-store.test.ts` 末尾追加（保持文件已有的 import/mock 不动；现有 mock 已覆盖 artifact/chat/monitor store，`clearBackground`/`noteBackgroundOpen` 不触达 electron，无需新增 mock）：

```ts
describe("browser-store backgroundSessions 回收契约", () => {
  beforeEach(() => {
    useBrowserStore.getState().reset()
  })

  it("noteBackgroundOpen 记录后台会话，clearBackground 精确删除单个 id", () => {
    const store = useBrowserStore.getState()
    store.noteBackgroundOpen("a", "https://a.example")
    store.noteBackgroundOpen("b", "https://b.example")
    expect(useBrowserStore.getState().backgroundSessions.has("a")).toBe(true)
    expect(useBrowserStore.getState().backgroundSessions.has("b")).toBe(true)

    store.clearBackground("a")
    const after = useBrowserStore.getState().backgroundSessions
    expect(after.has("a")).toBe(false)
    expect(after.has("b")).toBe(true)
  })

  it("clearBackground 对不存在的 id 幂等、不抛错、不误删", () => {
    const store = useBrowserStore.getState()
    store.noteBackgroundOpen("b", "https://b.example")
    expect(() => store.clearBackground("nope")).not.toThrow()
    expect(useBrowserStore.getState().backgroundSessions.has("b")).toBe(true)
  })

  it("reset 故意保留 backgroundSessions（跨前台留存）", () => {
    const store = useBrowserStore.getState()
    store.noteBackgroundOpen("b", "https://b.example")
    store.reset()
    expect(useBrowserStore.getState().backgroundSessions.has("b")).toBe(true)
  })
})
```

- [ ] **Step 2: 运行该测试文件，确认全绿**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && pnpm --filter web exec vitest run src/stores/browser-store.test.ts
```
Expected: PASS，含上面 3 个新用例 + 原有 2 个 openHtmlPreview 用例。
（若 `reset 保留 backgroundSessions` 用例失败，说明合并后的 store `reset()` 与 spec 不符——停止核对，不要改测试迁就。）

- [ ] **Step 3: Commit**

```bash
cd "D:/doc/code/ai/digital-employee-client" && git add apps/web/src/stores/browser-store.test.ts
git commit -m "test(browser): backgroundSessions clearBackground 幂等/精确删除/reset 留存契约

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 删除路径接入 `clearBackground`

**Files:**
- Modify: `apps/web/src/hooks/use-chat-queries.ts`
  - 顶部新增 `import { useBrowserStore } from "@/stores/browser-store"`
  - `useDeleteAllConversationsForContactMutation` 的 `onSuccess`（约 330–361 行）
  - `useDeleteConversationMutation` 的 `onSuccess`（约 460–462 行，签名需补 `variables`）
  - `useResetCuratorConversation` 的 `onSuccess`（约 489 行）

说明：不复用 `resetChatRightPanels`（它是无 id 的整体右栏 reset，`destroyBrowser()` 只动前台浏览器，无法按被删 id 清后台标记）。直接调 store 的 `clearBackground`。`browser-store` 不反向依赖 `use-chat-queries`，新增 import 无环。

- [ ] **Step 1: 新增 import**

在 `apps/web/src/hooks/use-chat-queries.ts` 顶部 import 区（与其它 `@/stores/*` import 同组）加一行：

```ts
import { useBrowserStore } from "@/stores/browser-store"
```

- [ ] **Step 2: 单删 mutation 接入（`useDeleteConversationMutation`）**

把约 460–462 行的：

```ts
    onSuccess: () => {
      resetChatRightPanels()
    },
```

改为（补 `variables` 参数并清对应 id）：

```ts
    onSuccess: (_data, variables) => {
      // 被删会话若有后台浏览器标记 → 回收，避免 id 永久滞留 backgroundSessions
      useBrowserStore.getState().clearBackground(String(variables.conversationId))
      resetChatRightPanels()
    },
```

- [ ] **Step 3: 按联系人全删 mutation 接入（`useDeleteAllConversationsForContactMutation`）**

在约 330 行 `onSuccess: (deletedIds, { contactId, contact }) => {` 的函数体内，紧挨已有的 `for (const id of deletedIds) { … }` 循环之后（或并入该循环），加上对每个被删 id 的回收。最小改动：在该 `onSuccess` 体内、`resetChatRightPanels()`（约 360 行）之前插入：

```ts
      for (const id of deletedIds) {
        useBrowserStore.getState().clearBackground(String(id))
      }
```

（保持已有 `for (const id of deletedIds) { removeQueries… }` 循环不动，新增独立一段即可；不必合并，可读性优先。）

- [ ] **Step 4: 删总管会话 mutation 接入（`useResetCuratorConversation`）**

在约 489 行 `onSuccess: (_data, variables) => {` 函数体**最前面**插入：

```ts
      useBrowserStore.getState().clearBackground(String(variables.conversationId))
```

- [ ] **Step 5: typecheck**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && pnpm --filter web typecheck
```
Expected: 通过，无类型报错（重点确认 `useDeleteConversationMutation` 改了 `onSuccess` 签名后 `variables.conversationId` 类型为 `string`，`String(...)` 合法）。

- [ ] **Step 6: Commit**

```bash
cd "D:/doc/code/ai/digital-employee-client" && git add apps/web/src/hooks/use-chat-queries.ts
git commit -m "fix(browser): 会话删除时回收 backgroundSessions 对应 id

单删/按联系人全删/删总管会话三处 onSuccess 调 clearBackground，堵住后台
会话浏览器在无 tagged close 事件时关闭导致 conversation-id 永久滞留。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 文档化「不接 task-end」

**Files:**
- Modify: `apps/web/src/stores/browser-store.ts`（`reset()` 既有注释附近 / `clearBackground` 上方）

说明：防止后人「顺手补一个 task-end 清理」反而误删仍有效的后台标记（任务结束不必然关浏览器，面板可留存供查看）。

- [ ] **Step 1: 在 `clearBackground` 实现上方补注释**

在 `apps/web/src/stores/browser-store.ts` 的 `clearBackground:` 定义上方加：

```ts
  // 回收路径有两条：①browserctl close 事件带匹配 conversationId（见 browser-confirmation-host）
  // ②会话删除（见 use-chat-queries 三个删除 mutation 的 onSuccess）。
  // 故意不接 task-end：任务结束不必然关浏览器（面板/内嵌浏览器可在 run 结束后留存供查看），
  // 在 task-end 清标记会误删仍有效的后台标记。
```

- [ ] **Step 2: typecheck（确认注释未破坏文件）**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && pnpm --filter web typecheck
```
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd "D:/doc/code/ai/digital-employee-client" && git add apps/web/src/stores/browser-store.ts
git commit -m "docs(browser): 注明 backgroundSessions 回收路径，显式排除 task-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 全量验证

**Files:** 无改动，仅运行。

- [ ] **Step 1: 跑 store 测试**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && pnpm --filter web exec vitest run src/stores/browser-store.test.ts
```
Expected: 全绿。

- [ ] **Step 2: typecheck 全包**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && pnpm --filter web typecheck
```
Expected: 通过。

- [ ] **Step 3: lint 改动文件**

Run:
```bash
cd "D:/doc/code/ai/digital-employee-client" && pnpm lint --filter=web
```
Expected: 无新增报错（如 lint 范围太大耗时，可接受跳过，以 typecheck + test 为准）。

- [ ] **Step 4: 人工验收清单（对照 spec 验收）**

逐条确认（代码审查级别，非必须跑起整个 app）：
1. 删除某曾 `noteBackgroundOpen` 的会话后，三个删除 mutation 路径都会 `clearBackground(String(id))` → id 不再滞留。✅ 由 Task 3 三处接入保证。
2. `clearBackground` 幂等、删错 id 不影响其它。✅ 由 Task 2 测试保证。
3. task-end 不触发清理。✅ 代码中无 task-end 接入；Task 4 注释固化此决策。
4. `reset()` 仍保留 backgroundSessions。✅ 由 Task 2 测试保证，且本计划未改 `reset()`。

---

## Self-Review 记录

- **Spec coverage:** spec「实现」表三行 mutation → Task 3 三个 Step 一一对应；「store 侧无需改动」→ Task 2/4 仅加测试与注释，未改 store 逻辑；「文档化不接 task-end」→ Task 4；「测试」→ Task 2 + Task 5。前置「先合 kalam 进 dev」→ Task 1。无遗漏。
- **Placeholder scan:** 无 TBD/TODO；每个改码 Step 均给出完整代码块与精确行号区间。
- **Type consistency:** 全程方法名 `clearBackground` / `noteBackgroundOpen` 一致；`String(...)` 统一转换；`useDeleteConversationMutation` 的 `variables.conversationId` 在 mutationFn 类型里已声明为 `string`，`useResetCuratorConversation` 为 `number | string`，两者 `String()` 均合法。
- **行号假定:** Task 3 行号取自 kalam 分支当前内容，合并干净（merge-tree 验证），dev-after-merge 行号一致；执行时以函数名锚定为准，行号仅作导航。
