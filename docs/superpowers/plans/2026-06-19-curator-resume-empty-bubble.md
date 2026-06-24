# 修 curator 切回会话消息塌空 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 切回 curator 会话、消息重放期间（末条被清空、status=streaming），气泡显示 DB 已落内容而非塌空——在 `pickMessageDisplaySource` 的 streaming 期对空壳 assistant 按 db id 从 DB 回退 parts 托底。

**Architecture:** 纯前端单一核心改动。`pickMessageDisplaySource` 在 streaming/submitted 分支不再无条件返回 live，而是把 live 里 `parts` 为空的 assistant 用 DB（stored）同 db id 那条的 parts 填回（非空 live 不动，delta 到达即停止回退）。合并气泡（mergeConsecutiveAssistantMessages）在数据源选择之后执行，拿到的已是填回后的消息，自然不塌——Task 2 仅加测确认、不改 merge 核心。

**Tech Stack:** React + Vitest（`pnpm --filter digital-employee test:unit`）。

**关联 spec:** `docs/superpowers/specs/2026-06-19-curator-resume-empty-bubble-design.md`

**前置已确认事实（代码核查，主仓库 dev 分支）：**
- `apps/web/src/lib/chat/pick-message-display-source.ts`：streaming 短路在 `:176-178`（`if (status === "streaming" || status === "submitted") { return liveMessages }`）。同文件已有 `parseDbMessageId`（import 自 `./hitl/message-id`）、`storedMessageIndexByDbId(stored): Map<string,UIMessage>`（:48-57，按 db id 索引）、`readMetadata`（:35-37）、`MessageWithMeta` 类型（:31-33）。
- 清空发生在 composer live 态：`use-conversation-session.ts:230` `setMessages(resetLastAssistantPartsForResume)`；`resetLastAssistantPartsForResume`（`session/reset-assistant-parts-for-resume.ts:23-35`）把末条 assistant `parts: []`，保留 id/role。DB（storedMessages/initialMessages）不受影响。
- `mergeConsecutiveAssistantMessages`（`merge-consecutive-assistant-messages.ts:94-118`）合并连续非群 assistant，`mergeAssistantGroup` 用 `parts: group.flatMap(m=>m.parts)`（:85）。群消息（有 senderName/senderId）单独成泡不合并。
- `prepareDisplayMessages` 调用 merge，在 `chat-conversation-view.tsx` displayMessages memo 里 **在 pickMessageDisplaySource 之后**执行（先选源，后 prepare/merge）。
- 测试文件 `pick-message-display-source.test.ts` 已存在（plain UIMessage 字面量：`{id, role, parts:[{type:"text",text}], metadata:{streamState}}`）；`merge-consecutive-assistant-messages.test.ts` 应存在（实现时确认）。

**测试命令：** `pnpm --filter digital-employee test:unit pick-message-display-source` / `... merge-consecutive-assistant-messages`

---

## File Structure

- Modify `apps/web/src/lib/chat/pick-message-display-source.ts` — streaming 期空壳回退 DB（核心）。
- Modify `apps/web/src/lib/chat/pick-message-display-source.test.ts` — 新行为测试。
- Modify `apps/web/src/lib/chat/merge-consecutive-assistant-messages.test.ts` — 确认空壳不塌泡的测试（不改 merge 实现，除非测试暴露需兜底）。

---

## Task 1: streaming 期空壳回退 DB（核心，先红后绿）

**Files:**
- Modify: `apps/web/src/lib/chat/pick-message-display-source.ts`
- Modify: `apps/web/src/lib/chat/pick-message-display-source.test.ts`

- [ ] **Step 1: 读现有文件与测试**

读 `pick-message-display-source.ts` 全文（确认 `:176-178` streaming 短路、`storedMessageIndexByDbId` :48-57、`parseDbMessageId` import、`readMetadata`/`MessageWithMeta`）与 `pick-message-display-source.test.ts` 的消息构造风格。

- [ ] **Step 2: 写失败测试（追加到 describe("pickMessageDisplaySource")）**

```ts
  it("streaming 期：live 末条 assistant 是空壳 → 用 DB 同 id 的 parts 回退", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "派活" }] },
      { id: "99", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "派活" }] },
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "已答完的正文" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    const assistant = out.find((m) => m.id === "99")
    expect(assistant?.parts?.length).toBe(1)
    expect(assistant?.parts?.[0]).toMatchObject({ text: "已答完的正文" })
  })

  it("streaming 期：live assistant 已有内容(非空壳) → 不被 DB 覆盖(保留 live)", () => {
    const live: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "live 正在写的新内容" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "DB 旧内容" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    expect(out.find((m) => m.id === "99")?.parts?.[0]).toMatchObject({
      text: "live 正在写的新内容",
    })
  })

  it("streaming 期：空壳但 DB 无同 id → 原样(仍空壳, 不崩)", () => {
    const live: UIMessage[] = [
      { id: "99", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "x" }] },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    expect(out.find((m) => m.id === "99")?.parts?.length).toBe(0)
  })
```

- [ ] **Step 3: 运行,确认失败**

Run: `pnpm --filter digital-employee test:unit pick-message-display-source`
Expected: 第一个用例 FAIL —— 当前 streaming 期 `return liveMessages` 原样返回空壳，`parts.length` 为 0 而非 1。第二、三用例可能已 PASS（巧合），但第一个必 FAIL。

- [ ] **Step 4: 实现回退**

在 `pick-message-display-source.ts` 加纯函数（放在 `pickMessageDisplaySource` 之前、与 `applyStoredPartsToInterruptedAssistants` 同区）：

```ts
/**
 * 流式重放期，composer 末条 assistant 常被清成空壳（resetLastAssistantPartsForResume，
 * 为 SDK 全量重放不丢不重）。此时若 DB 已有同 id 的已落 parts，用 DB 填回空壳，避免
 * 气泡塌空——delta 到达后 live 那条 parts 非空即不再回退。仅对 parts 为空的 assistant
 * 回退，非空 live 不动；无任何填充返回同引用。
 */
export function hydrateEmptyAssistantShellsFromDb(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): UIMessage[] {
  if (liveMessages.length === 0 || storedMessages.length === 0) {
    return liveMessages
  }
  const storedById = storedMessageIndexByDbId(storedMessages)
  let changed = false
  const next = liveMessages.map((liveMsg) => {
    if (liveMsg.role !== "assistant") return liveMsg
    if (liveMsg.parts && liveMsg.parts.length > 0) return liveMsg
    const dbId = parseDbMessageId(liveMsg.id)
    if (dbId == null) return liveMsg
    const stored = storedById.get(String(dbId))
    if (!stored?.parts?.length) return liveMsg
    changed = true
    return {
      ...liveMsg,
      parts: stored.parts,
      metadata: {
        ...(readMetadata(liveMsg) ?? {}),
      },
    } as UIMessage
  })
  return changed ? next : liveMessages
}
```

把 streaming 短路（:176-178）改为：
```ts
  if (status === "streaming" || status === "submitted") {
    return hydrateEmptyAssistantShellsFromDb(liveMessages, storedMessages)
  }
```

> `storedMessageIndexByDbId`/`parseDbMessageId`/`readMetadata` 均已在文件内，无需新增 import。保留 live 的 metadata（含 streamState），只借 DB 的 parts。

- [ ] **Step 5: 运行,确认转绿**

Run: `pnpm --filter digital-employee test:unit pick-message-display-source`
Expected: 全部 PASS（3 新用例 + 既有 applyStored/pickMessageDisplaySource 用例不回归——既有用例都是 non-streaming 或 interrupted 路径，不走新分支）。

- [ ] **Step 6: 类型检查**

Run: `pnpm --filter digital-employee typecheck`
Expected: PASS。

- [ ] **Step 7: 提交（dev）**

```bash
git add apps/web/src/lib/chat/pick-message-display-source.ts apps/web/src/lib/chat/pick-message-display-source.test.ts
git commit -m "fix(chat): 流式重放期空壳assistant按db id从DB回退parts,修curator切回会话消息塌空"
```

---

## Task 2: 确认合并气泡不塌（加测，不改 merge 核心）

**Files:**
- Modify: `apps/web/src/lib/chat/merge-consecutive-assistant-messages.test.ts`

验证：一组连续 assistant 含一条空壳 + 非空成员时，合并后 parts = 非空成员之和（不丢）。这是为防 Task 1 万一漏覆盖某路径时的回归网；现状 `flatMap` 本就保留非空段，故预期**测试直接 PASS、无需改 merge 实现**。

- [ ] **Step 1: 读现有 merge 测试**

读 `apps/web/src/lib/chat/merge-consecutive-assistant-messages.test.ts`（确认存在与构造风格；若不存在则新建，import `mergeConsecutiveAssistantMessages` from `./merge-consecutive-assistant-messages`）。

- [ ] **Step 2: 加确认测试**

```ts
  it("一组连续 assistant 含空壳 + 非空 → 合并保留非空 parts(不塌)", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "派活" }] },
      { id: "10", role: "assistant", parts: [{ type: "text", text: "规划段" }] },
      { id: "11", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
    ] as unknown as UIMessage[]
    const out = mergeConsecutiveAssistantMessages(messages)
    // 两条连续 assistant 合并成一条，parts = 非空段(空壳 flatMap 贡献 0)
    const merged = out.find((m) => m.role === "assistant")
    expect(merged?.parts?.some((p) => p.type === "text" && "text" in p && p.text === "规划段")).toBe(true)
  })
```

- [ ] **Step 3: 运行**

Run: `pnpm --filter digital-employee test:unit merge-consecutive-assistant-messages`
Expected: PASS（现状 flatMap 已保留「规划段」；空壳贡献空 parts）。

> 若此测试**意外 FAIL**（合并后丢了「规划段」），说明 merge 层确有塌缩，需在 `mergeAssistantGroup` 加兜底：`flatMap` 前过滤掉 parts 为空的成员（`group.filter(m => m.parts?.length).flatMap(...)`，但保留至少一条以维持 id/meta）。仅在 FAIL 时做此兜底改动并补提交说明；预期不需要。

- [ ] **Step 4: 提交（dev）**

```bash
git add apps/web/src/lib/chat/merge-consecutive-assistant-messages.test.ts
git commit -m "test(chat): 确认连续assistant合并含空壳时保留非空段(不塌泡)"
```

---

## Self-Review

**Spec coverage:**
- 改动1（pickMessageDisplaySource streaming 期空壳回退 DB）→ Task 1。✓ 核心机制。
- 改动2（合并不让空壳塌泡——确认 flatMap 已保留、必要时兜底）→ Task 2。✓ 以「加测确认、FAIL 才兜底」落地，符合 spec「不过度动 merge」。
- 改动3（清空时不丢 DB parts，归一到改动1）→ spec 已说明三层归一为「DB 快照在重放期托底空壳」一个机制，无独立改动；Task 1 即实现该机制，清空仍由 resetLastAssistantPartsForResume 原样（不改其语义）。✓ 计划无需单独任务。
- 不探测后端活跃性 → Task 1 只按「live 空壳 + DB 有内容」回退，不查活跃流。✓
- 仅作用前端、不回滚 a1d6261、不治后端假结束 → 计划未涉及。✓
- 测试节（streaming 空壳回退/非空不覆盖/无 db id 原样/merge 不塌/non-streaming 不回归）→ Task 1 Step 2 + Task 2 Step 2。✓

**Placeholder scan:** 无 TBD/TODO。Task 2 的「FAIL 才兜底」是明确的条件分支（给了兜底代码方向），非占位——预期路径是 PASS+不改实现。Task 2 Step 1「若不存在则新建」是对文件存在性的合理兜底（已注明实现时确认）。

**Type consistency:** `hydrateEmptyAssistantShellsFromDb(liveMessages, storedMessages): UIMessage[]` 签名与 `applyStoredPartsToInterruptedAssistants` 同款；复用 `storedMessageIndexByDbId`/`parseDbMessageId`/`readMetadata`（文件内既有，签名一致）；streaming 分支改为调它，返回类型 UIMessage[] 不变。测试里 UIMessage 字面量构造与既有测试一致。
