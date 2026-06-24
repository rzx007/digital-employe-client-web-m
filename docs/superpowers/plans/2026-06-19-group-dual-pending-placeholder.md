# 堆死群聊双「正在生成回复」占位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让群聊任何时刻最多只渲染一条「正在生成回复…」占位——在 `mergeGroupStreamingMessages` 里，若组长已有真实可见内容（extras 的真实流式 或 prepared 的落库回复），剥掉 extras 里的 pendingReply 占位。

**Architecture:** 纯前端单文件。修改 `mergeGroupStreamingMessages`：合并前判断「组长是否已有真实可见内容」，若有则从 extras 滤除 `metadata.pendingReply === true` 的占位；保留现有「剥 prepared 空流式占位」逻辑。证明性堆死「占位 vs 真实内容」并存，不依赖会漂的 id。

**Tech Stack:** React + Vitest（`pnpm --filter digital-employee test:unit group-extra-messages`）。

**关联 spec:** `docs/superpowers/specs/2026-06-19-group-dual-pending-placeholder-design.md`

**前置已确认事实（代码核查，文件 `apps/web/src/lib/chat/group-extra-messages.ts`）：**
- `mergeGroupStreamingMessages(prepared, extras)` 现状（约 :117-124）：`if (!extras.length) return prepared; const deduped = prepared.filter(m => !isEmptyStreamingPlaceholder(m)); return [...deduped, ...extras]`。
- `isEmptyStreamingPlaceholder(message)`（约 :94-106）：assistant + `metadata.streamState==="streaming"` + 无可见文本 → true。
- 占位由 `computeGroupExtraMessages` push，带 `metadata.pendingReply: true`、`senderName: "组长"`、`streamState: "streaming"`、空 text part（约 :74-87）。真实流式消息**不带** pendingReply。
- `assistantMessageHasVisibleBody(message)` 在 `apps/web/src/lib/chat/group-composer-ghosts.ts` 已导出：有非空 text part 或 `tool-` 开头 part → true。
- 测试文件 `apps/web/src/lib/chat/group-extra-messages.test.ts` 已有 `describe("mergeGroupStreamingMessages")`（约 :82-135），helper：`emptyStreamingLeader(id)`（空流式组长消息）、`leader(state)`、`syntheticPlaceholder = computeGroupExtraMessages({members:[leader("running")], streaming:[], awaitingLeaderFirstResponse:true})`（产一条 pendingReply 占位）。其中既有用例「keeps a real leader bubble that already has visible text」（:117-127）只断言真实气泡保留、**未断言占位被剥**——本计划要补这个断言。

**测试命令：** `pnpm --filter digital-employee test:unit group-extra-messages`

---

## File Structure

- Modify `apps/web/src/lib/chat/group-extra-messages.ts` — `mergeGroupStreamingMessages` 加「有真实内容则剥 pendingReply 占位」+ import `assistantMessageHasVisibleBody`。
- Modify `apps/web/src/lib/chat/group-extra-messages.test.ts` — 补/强化 merge 测试。

---

## Task 1: merge 互斥剥占位 + 测试（先红后绿）

**Files:**
- Modify: `apps/web/src/lib/chat/group-extra-messages.ts`
- Modify: `apps/web/src/lib/chat/group-extra-messages.test.ts`

- [ ] **Step 1: 读现有 merge 与测试**

读 `group-extra-messages.ts` 的 `mergeGroupStreamingMessages`/`isEmptyStreamingPlaceholder` 与 `group-extra-messages.test.ts` 的 `describe("mergeGroupStreamingMessages")` 块，确认上面引用的 helper（emptyStreamingLeader/leader/syntheticPlaceholder）与签名一致。

- [ ] **Step 2: 写失败测试（追加 + 强化）**

在 `describe("mergeGroupStreamingMessages")` 块内追加两个新用例，并强化既有的「keeps a real leader bubble」用例。新增：

```ts
  it("组长真实流式已在 extras → 剥掉 extras 里的 pendingReply 占位", () => {
    // extras 同时含：组长真实流式(有文本、无 pendingReply) + 一条 pendingReply 占位
    const realLeaderStream = {
      id: "group-stream-746",
      role: "assistant",
      parts: [{ type: "text", text: "安排：微博热搜助手查热搜…" }],
      metadata: { senderName: "组长", streamState: "streaming", streamCharCount: 12 },
    } as unknown as UIMessage
    const placeholder = {
      id: "group-stream-pending-leader",
      role: "assistant",
      parts: [{ type: "text", text: "" }],
      metadata: { senderName: "组长", streamState: "streaming", pendingReply: true },
    } as unknown as UIMessage
    const prepared = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "派活" }] },
    ] as unknown as UIMessage[]
    const out = mergeGroupStreamingMessages(prepared, [realLeaderStream, placeholder])
    // pendingReply 占位被剥，真实流式保留
    expect(out.some((m) => (m.metadata as Record<string, unknown> | undefined)?.pendingReply === true)).toBe(false)
    expect(out.some((m) => m.id === "group-stream-746")).toBe(true)
  })

  it("组长已落库回复在 prepared → 剥掉 extras 里的 pendingReply 占位", () => {
    // prepared 含组长落库回复(senderName=组长 + 正文 + 工具)，extras 只有 pendingReply 占位
    const landedLeaderReply = {
      id: "3875",
      role: "assistant",
      parts: [
        { type: "text", text: "安排：微博热搜助手查热搜，浏览器助手查小米17价格。" },
        { type: "tool-create_orchestration_plan" },
        { type: "text", text: "编排计划 #210 已生成，包含 2 个子任务。" },
      ],
      metadata: { senderName: "组长", streamState: "completed" },
    } as unknown as UIMessage
    const prepared = [landedLeaderReply] as unknown as UIMessage[]
    const out = mergeGroupStreamingMessages(prepared, syntheticPlaceholder)
    expect(out.some((m) => (m.metadata as Record<string, unknown> | undefined)?.pendingReply === true)).toBe(false)
    // 落库回复保留
    expect(out.some((m) => m.id === "3875")).toBe(true)
  })
```

并把既有 `it("keeps a real leader bubble that already has visible text", ...)`（:117-127）末尾**加一条断言**——它现在只验真实气泡保留，补验占位被剥：
```ts
    expect(out.some((m) => m.id === "real-leader-text")).toBe(true)
    // 既然组长真实气泡有可见文本，合成占位应被剥掉（不再两条「正在生成」）
    expect(
      out.some(
        (m) => (m.metadata as Record<string, unknown> | undefined)?.pendingReply === true
      )
    ).toBe(false)
```

- [ ] **Step 3: 运行,确认失败**

Run: `pnpm --filter digital-employee test:unit group-extra-messages`
Expected: 两个新用例 + 强化的既有用例 FAIL —— 当前 `mergeGroupStreamingMessages` 不剥 extras 里的 pendingReply（`[...deduped, ...extras]` 原样带出占位），故 `pendingReply === true` 仍存在。其余用例 PASS。

- [ ] **Step 4: 实现互斥剥占位**

在 `group-extra-messages.ts`：
1. 顶部加 import（与现有 import 风格一致）：
```ts
import { assistantMessageHasVisibleBody } from "./group-composer-ghosts"
```
2. 把 `mergeGroupStreamingMessages`（:117-124）改为：
```ts
export function mergeGroupStreamingMessages(
  prepared: UIMessage[],
  extras: UIMessage[]
): UIMessage[] {
  if (!extras.length) return prepared

  const isLeader = (m: UIMessage): boolean =>
    (m as { metadata?: Record<string, unknown> }).metadata?.senderName === "组长"
  const isPendingPlaceholder = (m: UIMessage): boolean =>
    (m as { metadata?: Record<string, unknown> }).metadata?.pendingReply === true

  // 组长是否已有真实可见内容：extras 里的非占位组长流式(有可见正文)，或 prepared 里
  // 组长的落库/流式回复(有可见正文/工具)。有则 pendingReply 占位多余——剥掉，避免与真实
  // 内容并存出现两条「正在生成回复」。
  const leaderHasRealContent =
    extras.some(
      (m) =>
        isLeader(m) &&
        !isPendingPlaceholder(m) &&
        assistantMessageHasVisibleBody(m)
    ) ||
    prepared.some(
      (m) => m.role === "assistant" && isLeader(m) && assistantMessageHasVisibleBody(m)
    )

  const nextExtras = leaderHasRealContent
    ? extras.filter((m) => !isPendingPlaceholder(m))
    : extras

  // 现有逻辑：剥 prepared 里的空流式占位（真实空流式残留与合成占位重复）。
  const deduped = prepared.filter((m) => !isEmptyStreamingPlaceholder(m))
  return [...deduped, ...nextExtras]
}
```
保留 `isEmptyStreamingPlaceholder` 不动。

- [ ] **Step 5: 运行,确认转绿**

Run: `pnpm --filter digital-employee test:unit group-extra-messages`
Expected: 全部 PASS（两个新用例 + 强化用例 + 既有 computeGroupExtraMessages/leaderHasVisibleStream/no-extras 用例）。

- [ ] **Step 6: 类型检查**

Run: `pnpm --filter digital-employee typecheck`
Expected: PASS（`assistantMessageHasVisibleBody` 从 group-composer-ghosts 正确导入；metadata 取值用与文件一致的 `as` 风格）。

- [ ] **Step 7: 提交（到 dev）**

```bash
git add apps/web/src/lib/chat/group-extra-messages.ts apps/web/src/lib/chat/group-extra-messages.test.ts
git commit -m "fix(chat): merge时组长已有真实内容则剥pendingReply占位,堆死群聊双「正在生成回复」"
```

---

## Self-Review

**Spec coverage:**
- 改动（mergeGroupStreamingMessages 加「有真实内容则剥 pendingReply 占位」：extras 非占位组长流式有正文 或 prepared 组长可见回复 → 滤除 extras 的 pendingReply；保留剥 prepared 空流式）→ Task 1 Step 4。✓
- import assistantMessageHasVisibleBody → Step 4.1。✓
- 不改 computeGroupExtraMessages → 计划未触碰。✓
- 测试（extras 真实流式剥占位 / prepared 落库回复剥占位 / 只有占位则保留 / 既有不回归）→ Step 2：两新用例覆盖前两种；「no extras 同引用」「computeGroupExtraMessages」等既有用例覆盖回归；「只有占位则保留」由既有 `syntheticPlaceholder`-only 路径隐含（prepared 无组长内容、extras 无真实流式 → leaderHasRealContent=false → 不剥）——既有 :97-115「drops a real empty-streaming leader placeholder」用例的 prepared 是空流式占位(无 senderName? emptyStreamingLeader 带 senderName=组长但无可见正文→assistantMessageHasVisibleBody=false→不触发剥占位)，故 syntheticPlaceholder 占位保留、断言 streamingPlaceholders 长度 1 仍成立，不回归。✓
- 仅作用 merge、纯前端单文件 → Task 1。✓

**Placeholder scan:** 无 TBD/TODO。所有代码步含完整代码与命令。Step 1 是「读现有 helper 对齐」核查步。

**Type consistency:** `isLeader`/`isPendingPlaceholder`/`leaderHasRealContent`/`nextExtras` 均在 Step 4 内定义自洽；`assistantMessageHasVisibleBody` 签名 `(UIMessage)=>boolean` 与 group-composer-ghosts 导出一致；测试里 `metadata.pendingReply === true`、`id` 断言与实现产出字段一致（computeGroupExtraMessages 占位带 pendingReply:true）。

**回归校验要点（实现者注意）:** 既有用例 :97-115 用 `emptyStreamingLeader`（senderName=组长、空 text、streamState=streaming）作 prepared。它**有 senderName=组长但无可见正文** → `assistantMessageHasVisibleBody` 为 false → 不触发 leaderHasRealContent → syntheticPlaceholder 的 pendingReply 不被剥 → 该用例断言「剥 prepared 空流式后剩 1 条占位」仍成立。务必确认这条不被新逻辑破坏（Step 5 全绿即验证）。
