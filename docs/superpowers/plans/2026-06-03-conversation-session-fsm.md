# 会话生命周期显式状态机（P1-2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `use-conversation-session.ts` 中由 6 个 `useRef` + 4 个 `useEffect` 拼出的隐式状态机，重构为「纯函数 reducer + 纯决策函数 + 薄 hook 适配层」，让 hydrate / resume / HITL / 终态 的转换条件集中、可穷举、可单测，消除时序竞态导致的偶现 bug。

**Architecture:** 先把散落在 effect/callback 里的两个最难的决策（是否 hydrate、是否 resume）抽成纯函数并用特征化测试锁定当前行为；再把 6 个 ref 的簿记状态收敛进一个纯 `sessionReducer`；最后把 hook 改成「effect 只派发事件、reducer 决定下一状态、命令式副作用按状态差异执行」的薄适配层。**hook 的公共 API 逐字保持不变**（被 conversation/draft/curator 三视图消费）。

**Tech Stack:** React 19 + `useReducer`、AI SDK `useChat`、TanStack Query、Vitest。无新增依赖。

---

## 不可破坏的约束（Invariants）

1. **公共 API 不变**：`useConversationSession` 返回值字段必须保持
   `{ activeHitl, hitlMessageId, hitlInterrupted, onHitlApproved, onStreamFinish, onStreamStopped, prepareOutboundMessage }`，签名与语义不变。三个消费方：
   - `apps/web/src/components/chat/views/chat-conversation-view.tsx`
   - `apps/web/src/components/chat/views/chat-draft-view.tsx`
   - `apps/web/src/components/chat/curator/curator-view.tsx`
2. **行为保持**：所有现有 `vitest` + `tsc` 必须保持通过；新增测试只增不改既有断言。
3. **副作用边界**：`setMessages` / `queryClient.setQueryData` / `resumeStream` / `scheduleMessagesRefetch` / `touchRecentContactById` 仍由 hook 触发，reducer 保持纯（无 IO、无 ref、无 Date.now）。

---

## 当前隐式状态机（重构基线，来自 use-conversation-session.ts）

**状态载体（要被收敛的 6 个 ref + 1 个 useState）：**
| 载体 | 含义 |
|------|------|
| `activeHitl`（useState） | 当前待审批 HITL；驱动 UI 与 composer 锁 |
| `hitlActiveRef` | = `hitlInterrupted \|\| activeHitl!=null`；resume 闸门读取 |
| `activeSessionRef` | 本会话是否「进行中」（streaming/submitted 或刚发送/审批）；hydrate 覆盖闸门 |
| `hydratedConvIdRef` | 上次 hydrate 的 convKey |
| `lastHydratedSigRef` | 上次 hydrate 的签名（避免重复 setMessages） |
| `resumeAttemptedForRef` | 已尝试 resume 的 assistant id（去重） |
| `prevConversationIdRef` | 检测会话切换 |

**转换触发点（事件）：** 会话切换、hydrate+resume 大 effect、bus `onInterrupted`、bus `onTerminal`、`onStreamFinish`、`onStreamStopped`、`onHitlApproved`、`prepareOutboundMessage`。

**两个最难、最易出 bug 的纯决策（本计划优先抽取）：**
- **是否 hydrate**：`use-conversation-session.ts:217-246`（`needsHydrate` / `alreadySynced` / `blockedByActiveSession` / 用 patch 还是整表替换）。
- **是否 resume**：`use-conversation-session.ts:248-264`（`hitlActive` 闸门、`lastAssistant.streamState === "streaming"`、`resumeAttemptedFor` 去重、`status` 二次判断）。

---

## File Structure

- **Create** `apps/web/src/lib/chat/session/resume-decision.ts` — 纯函数 `shouldAttemptResume(...)`。
- **Create** `apps/web/src/lib/chat/session/resume-decision.test.ts`
- **Create** `apps/web/src/lib/chat/session/hydrate-decision.ts` — 纯函数 `decideHydration(...)`，复用现有 `messagesNeedHydrateFromDb`/`hydrateSignature`/`patchComposerFromStoredWhenSameTurn`（来自 `pick-message-display-source.ts`）。
- **Create** `apps/web/src/lib/chat/session/hydrate-decision.test.ts`
- **Create** `apps/web/src/lib/chat/session/session-machine.ts` — `SessionMachine` 状态、`SessionEvent` 事件、纯 `sessionReducer`、`initialSessionMachine`。
- **Create** `apps/web/src/lib/chat/session/session-machine.test.ts` — 4 个特征化场景。
- **Modify** `apps/web/src/hooks/use-conversation-session.ts` — 改为薄适配层（`useReducer` + 决策函数 + 副作用）。
- **Move/keep** `seedActiveHitlFromStoredMessages` 与 `terminalToStreamState`：抽到 `session/` 下并加测试（当前内联于 hook）。

> 注：`session/` 子目录是新建；遵循现有 `lib/chat/hitl/` 的按职责分目录惯例。

---

## Task 1：抽取并测试 `terminalToStreamState`（最小热身）

**Files:**
- Create: `apps/web/src/lib/chat/session/terminal-state.ts`
- Test: `apps/web/src/lib/chat/session/terminal-state.test.ts`
- Modify: `apps/web/src/hooks/use-conversation-session.ts`（删除内联函数，改 import）

- [ ] **Step 1: 写失败测试**
```ts
// terminal-state.test.ts
import { describe, expect, it } from "vitest"
import { terminalToStreamState } from "./terminal-state"

describe("terminalToStreamState", () => {
  it("maps no_stream to error", () => {
    expect(terminalToStreamState("no_stream")).toBe("error")
  })
  it("passes through other terminal statuses verbatim", () => {
    for (const s of ["completed", "cancelled", "error", "interrupted"]) {
      expect(terminalToStreamState(s)).toBe(s)
    }
  })
})
```

- [ ] **Step 2: 运行确认失败**
Run: `pnpm --filter digital-employee exec vitest run src/lib/chat/session/terminal-state.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（逐字搬运现有逻辑 use-conversation-session.ts:55-59）**
```ts
// terminal-state.ts
export function terminalToStreamState(status: string): string {
  if (status === "no_stream") return "error"
  return status
}
```

- [ ] **Step 4: 改 hook 引用，删内联**
在 `use-conversation-session.ts` 删除本地 `terminalToStreamState`，新增 `import { terminalToStreamState } from "@/lib/chat/session/terminal-state"`。

- [ ] **Step 5: 验证**
Run: `pnpm --filter digital-employee exec vitest run src/lib/chat/session` 然后 `pnpm --filter digital-employee typecheck`
Expected: PASS / 无类型错误

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/lib/chat/session/terminal-state.ts apps/web/src/lib/chat/session/terminal-state.test.ts apps/web/src/hooks/use-conversation-session.ts
git commit -m "refactor(chat): extract terminalToStreamState as pure tested fn"
```

---

## Task 2：抽取并测试 `seedActiveHitlFromStoredMessages`

**Files:**
- Create: `apps/web/src/lib/chat/session/seed-active-hitl.ts`
- Test: `apps/web/src/lib/chat/session/seed-active-hitl.test.ts`
- Modify: `apps/web/src/hooks/use-conversation-session.ts`

- [ ] **Step 1: 写失败测试**（覆盖：跳过已审批 `approved_at`、跳过非 interrupted、命中 interrupted 行返回 seeded）
```ts
import { describe, expect, it } from "vitest"
import { seedActiveHitlFromStoredMessages } from "./seed-active-hitl"
import type { Message } from "@/types/chat"

const base = { content: "", role: "assistant" as const, timestamp: new Date() }

it("skips approved interrupted rows", () => {
  const rows = [{
    ...base, id: "10", streamState: "interrupted",
    metadata: { approved_at: "2026-01-01T00:00:00Z" },
    messageParts: [{ type: "tool-submit_clarifying_questions", toolCallId: "c1", state: "input-available" }],
  }] as unknown as Message[]
  expect(seedActiveHitlFromStoredMessages(rows)).toBeNull()
})

it("seeds from the latest unapproved interrupted row", () => {
  const rows = [{
    ...base, id: "11", streamState: "interrupted", metadata: {},
    messageParts: [{ type: "tool-submit_clarifying_questions", toolCallId: "c2", state: "input-available" }],
  }] as unknown as Message[]
  expect(seedActiveHitlFromStoredMessages(rows)?.toolCallId).toBe("c2")
})
```

- [ ] **Step 2: 运行确认失败**
Run: `pnpm --filter digital-employee exec vitest run src/lib/chat/session/seed-active-hitl.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现（逐字搬运 use-conversation-session.ts:61-86）**
```ts
import type { Message } from "@/types/chat"
import {
  parseDbMessageId,
  seedActiveHitlFromMessageParts,
  type ActiveHitl,
} from "@/lib/chat/hitl"

export function seedActiveHitlFromStoredMessages(
  storedMessages: Message[]
): ActiveHitl | null {
  for (let i = storedMessages.length - 1; i >= 0; i--) {
    const row = storedMessages[i]
    if (row.role !== "assistant" || row.streamState !== "interrupted") continue
    if (typeof row.metadata?.approved_at === "string" && row.metadata.approved_at.length > 0) continue
    const dbId = parseDbMessageId(row.id)
    if (!dbId || !row.messageParts?.length) continue
    const seeded = seedActiveHitlFromMessageParts(dbId, row.messageParts)
    if (seeded) return seeded
  }
  return null
}
```

- [ ] **Step 4: 改 hook 引用，删内联**

- [ ] **Step 5: 验证** `vitest run src/lib/chat/session` + `typecheck`

- [ ] **Step 6: Commit**
```bash
git commit -am "refactor(chat): extract seedActiveHitlFromStoredMessages with tests"
```

---

## Task 3：抽取并测试 `shouldAttemptResume`（核心决策 1）

**Files:**
- Create: `apps/web/src/lib/chat/session/resume-decision.ts`
- Test: `apps/web/src/lib/chat/session/resume-decision.test.ts`

被替代的现有逻辑：`use-conversation-session.ts:248-264`。

- [ ] **Step 1: 写失败测试（特征化当前闸门）**
```ts
import { describe, expect, it } from "vitest"
import { shouldAttemptResume } from "./resume-decision"

const ok = {
  hitlActive: false,
  lastAssistantStreamState: "streaming",
  lastAssistantId: "42",
  resumeAttemptedFor: null as string | null,
}

it("attempts resume when last assistant is streaming and not yet attempted", () => {
  expect(shouldAttemptResume(ok)).toBe(true)
})
it("does not resume while HITL is active", () => {
  expect(shouldAttemptResume({ ...ok, hitlActive: true })).toBe(false)
})
it("does not resume when last assistant is not streaming", () => {
  expect(shouldAttemptResume({ ...ok, lastAssistantStreamState: "completed" })).toBe(false)
})
it("does not resume twice for the same assistant id", () => {
  expect(shouldAttemptResume({ ...ok, resumeAttemptedFor: "42" })).toBe(false)
})
it("resumes again for a different assistant id", () => {
  expect(shouldAttemptResume({ ...ok, resumeAttemptedFor: "41" })).toBe(true)
})
```

- [ ] **Step 2: 运行确认失败**
Run: `pnpm --filter digital-employee exec vitest run src/lib/chat/session/resume-decision.test.ts` → FAIL

- [ ] **Step 3: 实现**
```ts
export type ResumeDecisionInput = {
  hitlActive: boolean
  lastAssistantStreamState: string | undefined
  lastAssistantId: string | undefined
  resumeAttemptedFor: string | null
}

export function shouldAttemptResume(input: ResumeDecisionInput): boolean {
  if (input.hitlActive) return false
  if (input.lastAssistantStreamState !== "streaming") return false
  if (!input.lastAssistantId) return false
  if (input.resumeAttemptedFor === input.lastAssistantId) return false
  return true
}
```

- [ ] **Step 4: 验证** `vitest run src/lib/chat/session/resume-decision.test.ts` → PASS

- [ ] **Step 5: Commit**
```bash
git commit -am "refactor(chat): extract shouldAttemptResume pure decision + tests"
```

> 本任务只抽函数、暂不接线进 hook（接线在 Task 6 统一做，降低单步风险）。

---

## Task 4：抽取并测试 `decideHydration`（核心决策 2）

**Files:**
- Create: `apps/web/src/lib/chat/session/hydrate-decision.ts`
- Test: `apps/web/src/lib/chat/session/hydrate-decision.test.ts`

被替代的现有逻辑：`use-conversation-session.ts:217-246`。决策输出一个动作对象，副作用留给 hook。

- [ ] **Step 1: 写失败测试**
```ts
import { describe, expect, it } from "vitest"
import { decideHydration } from "./hydrate-decision"

const inSync = {
  convKey: "5", sig: "3:42", needsHydrate: false,
  active: false, hydratedConvId: "5", lastHydratedSig: "3:42",
}

it("no-ops when already synced", () => {
  expect(decideHydration(inSync).action).toBe("none")
})
it("replaces wholesale when not active", () => {
  expect(decideHydration({ ...inSync, sig: "4:43", lastHydratedSig: "3:42", needsHydrate: true }).action).toBe("replace")
})
it("patches in place when active + same turn needs hydrate", () => {
  expect(decideHydration({ ...inSync, active: true, needsHydrate: true }).action).toBe("patch")
})
it("blocked when active + already hydrated + no needsHydrate", () => {
  expect(decideHydration({ ...inSync, active: true, sig: "9:99" }).action).toBe("none")
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现（语义对齐 hook:222-246）**
```ts
export type HydrateDecisionInput = {
  convKey: string
  sig: string
  needsHydrate: boolean
  active: boolean
  hydratedConvId: string | null
  lastHydratedSig: string
}

export type HydrateDecision = {
  /** none=不动；replace=整表 setMessages(initial)；patch=同轮补丁 */
  action: "none" | "replace" | "patch"
}

export function decideHydration(input: HydrateDecisionInput): HydrateDecision {
  const alreadySynced =
    input.hydratedConvId === input.convKey &&
    input.lastHydratedSig === input.sig &&
    !input.needsHydrate
  if (alreadySynced) return { action: "none" }

  const blockedByActiveSession =
    input.active && input.hydratedConvId === input.convKey && !input.needsHydrate
  if (blockedByActiveSession) return { action: "none" }

  if (input.active && input.needsHydrate) return { action: "patch" }
  return { action: "replace" }
}
```

- [ ] **Step 4: 验证** → PASS

- [ ] **Step 5: Commit**
```bash
git commit -am "refactor(chat): extract decideHydration pure decision + tests"
```

---

## Task 5：`sessionReducer` 收敛簿记状态 + 4 个特征化场景

**Files:**
- Create: `apps/web/src/lib/chat/session/session-machine.ts`
- Test: `apps/web/src/lib/chat/session/session-machine.test.ts`

- [ ] **Step 1: 写失败测试（4 个时序场景）**
```ts
import { describe, expect, it } from "vitest"
import { initialSessionMachine, sessionReducer } from "./session-machine"
import type { ActiveHitl } from "@/lib/chat/hitl"

const hitl = { dbMessageId: "9", toolCallId: "c1", kind: "clarify" } as ActiveHitl

it("conversation switch resets bookkeeping and clears hitl", () => {
  let s = sessionReducer(initialSessionMachine, { type: "HYDRATED", convKey: "1", sig: "2:5" })
  s = sessionReducer(s, { type: "INTERRUPTED", hitl })
  s = sessionReducer(s, { type: "CONVERSATION_SWITCHED" })
  expect(s).toEqual(initialSessionMachine)
})

it("HITL approved clears activeHitl + activates, but does NOT clear resume dedupe (only RESUME_RESET does)", () => {
  let s = sessionReducer({ ...initialSessionMachine, resumeAttemptedFor: "7" }, { type: "INTERRUPTED", hitl })
  s = sessionReducer(s, { type: "HITL_APPROVED" })
  expect(s.activeHitl).toBeNull()
  expect(s.active).toBe(true)
  // 关键：HITL_APPROVED 不动 resumeAttemptedFor（对齐 resumed===false 早返回前的现状）
  expect(s.resumeAttemptedFor).toBe("7")
  // hook 仅在 resumed!==false 的位置才派发 RESUME_RESET
  s = sessionReducer(s, { type: "RESUME_RESET" })
  expect(s.resumeAttemptedFor).toBeNull()
})

it("terminal cancelled deactivates and forgets hydration", () => {
  let s = sessionReducer({ ...initialSessionMachine, active: true, hydratedConvId: "1" }, { type: "TERMINAL", status: "cancelled" })
  expect(s.active).toBe(false)
  expect(s.hydratedConvId).toBeNull()
})

it("non-cancelled terminal keeps active/hydration", () => {
  const start = { ...initialSessionMachine, active: true, hydratedConvId: "1" }
  expect(sessionReducer(start, { type: "TERMINAL", status: "completed" })).toEqual(start)
})

it("resume attempt records assistant id; outbound prepare clears it but keeps hydration", () => {
  let s = sessionReducer(
    { ...initialSessionMachine, hydratedConvId: "1", lastHydratedSig: "3:42" },
    { type: "RESUME_ATTEMPTED", assistantId: "42" }
  )
  expect(s.resumeAttemptedFor).toBe("42")
  s = sessionReducer(s, { type: "OUTBOUND_PREPARED" })
  expect(s.resumeAttemptedFor).toBeNull()
  expect(s.active).toBe(true)
  expect(s.activeHitl).toBeNull()
  // 发送新消息不得抹掉 hydrate 簿记（否则会触发不必要的整表替换/闪屏）
  expect(s.hydratedConvId).toBe("1")
  expect(s.lastHydratedSig).toBe("3:42")
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 reducer**
```ts
import type { ActiveHitl } from "@/lib/chat/hitl"

export type SessionMachine = {
  active: boolean
  activeHitl: ActiveHitl | null
  hydratedConvId: string | null
  lastHydratedSig: string
  resumeAttemptedFor: string | null
}

export const initialSessionMachine: SessionMachine = {
  active: false,
  activeHitl: null,
  hydratedConvId: null,
  lastHydratedSig: "",
  resumeAttemptedFor: null,
}

export type SessionEvent =
  | { type: "CONVERSATION_SWITCHED" }
  | { type: "OUTBOUND_PREPARED" }
  | { type: "HYDRATED"; convKey: string; sig: string }
  | { type: "INTERRUPTED"; hitl: ActiveHitl | null }
  | { type: "TERMINAL"; status: string }
  | { type: "STREAM_STOPPED" }
  | { type: "HITL_APPROVED" }
  | { type: "RESUME_RESET" }
  | { type: "RESUME_ATTEMPTED"; assistantId: string }
  | { type: "ACTIVATED" }
  | { type: "SEED_HITL"; hitl: ActiveHitl | null }

export function sessionReducer(
  state: SessionMachine,
  event: SessionEvent
): SessionMachine {
  switch (event.type) {
    case "CONVERSATION_SWITCHED":
      return initialSessionMachine
    case "OUTBOUND_PREPARED":
      return { ...state, active: true, activeHitl: null, resumeAttemptedFor: null }
    case "ACTIVATED":
      return state.active ? state : { ...state, active: true }
    case "HYDRATED":
      return { ...state, hydratedConvId: event.convKey, lastHydratedSig: event.sig }
    case "SEED_HITL":
      return { ...state, activeHitl: event.hitl }
    case "INTERRUPTED":
      return event.hitl ? { ...state, activeHitl: event.hitl } : state
    case "RESUME_ATTEMPTED":
      return { ...state, resumeAttemptedFor: event.assistantId }
    case "HITL_APPROVED":
      // 对齐现有 onHitlApproved 早段（lines 373/409）：置 active、清 activeHitl，
      // 但 *不* 清 resumeAttemptedFor —— 现有代码仅在 resumed!==false 早返回之后才清，
      // 故由独立的 RESUME_RESET 事件在 hook 中那个位置派发，避免 resumed===false 路径误清。
      return { ...state, active: true, activeHitl: null }
    case "RESUME_RESET":
      return { ...state, resumeAttemptedFor: null }
    case "STREAM_STOPPED":
      return { ...state, active: false, hydratedConvId: null }
    case "TERMINAL":
      return event.status === "cancelled"
        ? { ...state, active: false, hydratedConvId: null }
        : state
    default:
      return state
  }
}
```

- [ ] **Step 4: 验证** → PASS

- [ ] **Step 5: Commit**
```bash
git commit -am "feat(chat): add pure sessionReducer with characterization tests"
```

---

## Task 6：把 hook 改成薄适配层（接线，最高风险步）

**Files:**
- Modify: `apps/web/src/hooks/use-conversation-session.ts`

**做法：** 用 `useReducer(sessionReducer, initialSessionMachine)` 取代 6 个 ref；effect 内只 `dispatch` 事件并按需读 `shouldAttemptResume`/`decideHydration` 触发副作用。`activeHitl` 从 `machine.activeHitl` 暴露。`composerMessagesRef` 因 reducer 不需要它读最新 composer 可保留（副作用闭包仍可能需要），其余 5 个 ref 删除。

**注意点（务必逐条核对——含 plan review 标记的 3 处行为漂移）：**
- `hitlInterrupted` = `machine.activeHitl !== null`，`hitlMessageId` = `machine.activeHitl?.dbMessageId ?? null`，`pendingHitl` 计算保持不变。
- resume 的 `requestAnimationFrame` + `status==="ready"||"error"` 二次判断保持（这是真实时序保护，不要删）。
- **【漂移1·load-bearing】`onHitlApproved` 副作用与派发顺序必须逐字对齐现有 lines 369-441：**
  patch cache → patch composer →（早段）`dispatch(HITL_APPROVED)`〔置 active、清 activeHitl，*不*清 resumeAttemptedFor〕→ `scheduleMessagesRefetch()`
  → **`if (options?.resumed === false) return`**（提前返回，此路径**不得**派发 `RESUME_RESET`）
  → 占位 assistant（按需）→ **`dispatch(RESUME_RESET)`**〔此处才清 resumeAttemptedFor，对应现有 line 435〕→ `setResumeConversationId` → rAF `resumeStream()`。
  错误地把 resumeAttemptedFor 的清除并进 HITL_APPROVED，会让 `resumed===false` 路径误清 resume 去重 → 下一次 hydrate effect 误触发 resume。
- **【漂移2】hydrate+resume 大 effect 的早返回分支必须保留**：现有 lines 209-213 —— 当 `status === "streaming" || "submitted"` 时 `dispatch({type:"ACTIVATED"})` 后**直接 return**，不得让 `decideHydration`/`shouldAttemptResume` 在流式进行中运行（否则 hydrate 会覆盖 live stream）。
- **【漂移3】`INTERRUPTED` 事件携带的 hitl 必须用 *patched 后* 的消息解析**：对齐现有 lines 291-301，在 `setMessages` updater 内先 `patchAssistantWithInterruptParts` 得到 `next`，再 `resolveActiveHitl(payload, next)`；将其结果作为 `dispatch({type:"INTERRUPTED", hitl})` 的载荷（reducer 对 null 不改 activeHitl）。不要用 `prev` 或裸 payload 解析。
- `seedActiveHitl` effect 改为 `dispatch({type:"SEED_HITL", hitl: seedActiveHitlFromStoredMessages(stored)})`，闸门 `!machine.active`。
- `onStreamStopped` → `dispatch({type:"STREAM_STOPPED"})`，并把 `patchLastAssistantStreamState(..., "cancelled")` + 清 refetch timer + `scheduleMessagesRefetch()` 等副作用保留在 hook 内（reducer 只改 `active:false, hydratedConvId:null`）。
- `prepareOutboundMessage` → `dispatch({type:"OUTBOUND_PREPARED"})`；确认它**不**改 `hydratedConvId`/`lastHydratedSig`（reducer 已保证，见 Task 5 新增的 OUTBOUND_PREPARED 断言）。
- 会话切换 effect：`dispatch({type:"CONVERSATION_SWITCHED"})` + invalidate query。

- [ ] **Step 1: 改写 hook**（按上述映射逐一替换 ref → machine/dispatch）。

- [ ] **Step 2: 类型检查** Run: `pnpm --filter digital-employee typecheck` → 无错误

- [ ] **Step 3: 全量单测** Run: `pnpm --filter digital-employee test:unit`
Expected: 仅既有的 `resolve-workbench-curator-panel.test.ts` 预存在失败，其余全绿。

- [ ] **Step 4: Lint** Run: `cd apps/web && pnpm exec eslint src/hooks/use-conversation-session.ts src/lib/chat/session` → exit 0

- [ ] **Step 5: 手动冒烟（关键）** 用 `pnpm --filter digital-employee dev` 跑起来，按下表逐项验证：

| 场景 | 期望 |
|------|------|
| 正常发送 → 流式 → 结束 | 文本/工具卡正常，结束后耗时/复制按钮出现 |
| 发送 → HITL 中断 → 审批通过 | 审批卡出现一次（不重复），通过后自动续流 |
| HITL 中断 → 切走会话 → 切回 | 审批卡恢复且仍可审批（不重复弹、不卡死） |
| 流式中切走 → 切回 | 不被 hydrate 覆盖，内容连续 |
| 流式中点停止 | 立即停，streamState=cancelled，不残留 resume |
| 进入一个 DB 里 streaming 状态的会话 | 自动 GET /resume 续流一次（不重复） |

- [ ] **Step 6: Commit**
```bash
git commit -am "refactor(chat): rewire useConversationSession onto sessionReducer + pure decisions"
```

---

## Task 7：清理与文档

- [ ] **Step 1:** 确认 `dedupeDuplicatePendingHitlParts` 现状：在 Task 6 完成后，于手动冒烟「HITL 中断→审批」场景打断点/日志，确认是否仍有重复 pending part 进入展示层。若**确认无重复**，新建后续工单评估降级该补偿逻辑（不在本计划内删除，避免扩大风险）。
- [ ] **Step 2:** 更新 `apps/web/src/lib/chat/chat-improvement-suggestions.md`：标记 P1-2 完成，附 reducer/决策函数文件索引。
- [ ] **Step 3:** 更新 `apps/web/src/lib/chat/conversation-message-flow.md` 的 hydrate/resume 段落，指向新的 `session/` 纯函数。
- [ ] **Step 4: Commit**
```bash
git commit -am "docs(chat): record session FSM refactor (P1-2)"
```

---

## 回滚策略

每个 Task 独立 commit；Task 1-5 为纯新增（零运行时风险），Task 6 是唯一改运行时行为的步骤。若 Task 6 冒烟发现回归，`git revert` 单个 commit 即可回到「纯函数已抽取但 hook 未接线」的安全态，决策函数与 reducer 测试仍保留价值。

---

## 风险与未覆盖项（No silent caps）

- **特征化测试覆盖的是纯决策与 reducer，不覆盖 hook 内 effect 的真实时序**（rAF、React 批处理、bus 回调顺序）。这部分只能靠 Task 6 Step 5 的手动冒烟兜底——已在表中显式列出 6 个场景，未做自动化集成测试。
- `composerMessagesRef` 是否能完全移除取决于副作用闭包是否需要最新 composer；若需要则保留该 ref（不属于状态机簿记，不违背重构目标）。
- 本计划**不**触碰 P1-1（单一 streamState 真相源）与 transport 层；二者独立排期。
