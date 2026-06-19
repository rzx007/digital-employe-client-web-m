# 流式渲染丢数据修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个独立的流式渲染丢数据现象——①点「终止」按钮取消对话时漏掉已生成内容；②切换总管/助手对话时偶发漏内容、来回切两次才正常。

**Architecture:** 问题项目把流式缓冲/打断/落定/切换全委托给 Vercel AI SDK 的 `useChat`，而 SDK `stop()` 是「硬 abort」、自定义 `LangChainChatTransport` 是模块级单例且跨会话共享可变状态。参照 hermes 的 `turnController`（打断时先封存缓冲再清空、切 session 整体 reset）的范式，给我们的实现补两件事：(A) 终止时 transport abort 走「优雅收尾」（flush rAF batcher 残留 + 补 text-end）而非裸 `reader.cancel()`，并在 stop 时把 live 累积内容定格进消息；(B) 单例 transport 在会话切换时整体 reset 其 in-flight resume 状态，杜绝跨会话串台。

**Tech Stack:** React + Vercel AI SDK `useChat`（@ai-sdk/react ^3）+ 自定义 `LangChainChatTransport`（SSE→UIMessageChunk）+ Zustand + react-query。前端测试用 vitest（`pnpm --filter digital-employee test:unit`，`apps/web/src/lib/chat/*.test.ts` 已有大量先例）。typecheck：`cd apps/web && pnpm typecheck`（包名 `digital-employee`，勿用 `--filter=web`）。

**关键事实（已查证 dev 最新代码）：**
- 流式接收：`useChat({ id: String(conversationId), transport: chatTransport })`（[chat-conversation-view.tsx:265](apps/web/src/components/chat/views/chat-conversation-view.tsx:265)）。delta 累积在 SDK 内部 `messages`，前端无自有 buffer。
- transport 是**模块级单例**：`export const chatTransport = new LangChainChatTransport<UIMessage>()`（[chat-view-shared.ts:8](apps/web/src/components/chat/shared/chat-view-shared.ts:8)）。
- 单例的跨会话可变字段：`_reconnectAbort` / `_reconnectChatId`（private）、`_resumeConversationId`（public）、`_resumeSealedToolCallIds`（private）（[langchain-chat-transport.ts:346-351](apps/web/src/lib/chat/langchain-chat-transport.ts:346)）。已有 `cancelReconnect()`（:374）。
- **现象1 确定根因**：abort 时 `onAbort = () => reader.cancel()`（[langchain-chat-transport.ts:503](apps/web/src/lib/chat/langchain-chat-transport.ts:503)）裸撕流，**跳过** `[DONE]` 路径里的 `flushSync()` + `closeTextPhaseIfNeeded(state)` + `enqueueFinish`（:553-557）——rAF batcher 里未 flush 的 chunk 丢失。`createChunkBatcherForMode` 返回 `{ schedule, flushSync }`（:520）。
- **现象1 第二环**：`onStreamStopped` 只 `patchLastAssistantStreamState(...,"cancelled")`（[use-conversation-session.ts:557](apps/web/src/hooks/use-conversation-session.ts:557)），不读取/定格 live `messages` 的累积 parts。
- `handleStop`（[chat-conversation-view.tsx:349](apps/web/src/components/chat/views/chat-conversation-view.tsx:349)）：`stop()` → `cancelReconnect()` → 后端 `cancelConversationStream` → `session.onStreamStopped()`。`messages`/`setMessages` 来自 useChat（:252,254）。
- **现象2 根因**：单例 transport 跨会话共享 resume 状态，切会话仅 `cancelReconnect()`（[chat-conversation-view.tsx:387](apps/web/src/components/chat/views/chat-conversation-view.tsx:387)）不整体 reset，旧会话 in-flight resume/归属可能污染下个会话。
- hermes 范式参照：`D:\doc\code\ai\hermes-agent\ui-tui\src\app\turnController.ts`——`interruptTurn`（:296，打断先 `partial=bufRef` 再折进消息）、`flushStreamingSegment`（:397）、`reset()/fullReset()`（:839，切 session 整体清缓冲 + clearNoticeState）。

**设计原则：** 优先、独立地修现象1（高频、可单独验证）；现象2 改动触及单例 transport，做最小隔离（加 `resetForConversation` 方法 + 切会话调用），不重构成 per-conv Map（YAGNI，超出修复所需）。每步可单测的走 TDD，组件/hook 层改动靠 typecheck + 手动验收。

---

## File Structure

| 文件 | 改动职责 |
|------|---------|
| `apps/web/src/lib/chat/langchain-chat-transport.ts` | (A) abort 优雅收尾：onAbort 改为先 flushSync + closeTextPhaseIfNeeded + enqueueFinish 再 close，不裸 cancel；(B) 新增 `resetForConversation(id)` 整体清 in-flight resume 状态 |
| `apps/web/src/lib/chat/seal-live-assistant-parts.ts`（新建） | 纯函数：从 live messages 取最后一条 assistant、把其 parts「定格」并打 cancelled 标记，供 stop 时封存 partial。可单测 |
| `apps/web/src/lib/chat/seal-live-assistant-parts.test.ts`（新建） | 上述纯函数的 vitest 测试 |
| `apps/web/src/components/chat/views/chat-conversation-view.tsx` | `handleStop` 在 `stop()` 前调封存纯函数 + `setMessages` 定格；切会话 effect 调 `resetForConversation` |
| `apps/web/src/hooks/use-conversation-session.ts` | （按需）`onStreamStopped` 不变或仅补注释——封存职责放在 handleStop（持有 messages/setMessages 最直接处） |

---

## Task 0: 验证 SDK `stop()` 后 messages 是否保留已 append parts（事实先行，防错误假设）

**Files:** 无（调查 + 记录，不改代码）

诊断报告假设「SDK abort 丢弃 mid-stream 部分消息」，但这取决于 @ai-sdk/react 版本行为。**确定丢失的是 rAF batcher 未 flush 的 chunk**（transport 层）；「SDK 是否也丢已 append 的 parts」必须先验证，决定 Task 2 是否需要 `setMessages` 定格。

- [ ] **Step 1: 查 SDK 版本与 stop 语义**

Run: `cd apps/web && cat package.json | grep ai-sdk`
读 `node_modules/@ai-sdk/react` 里 `stop` 的实现（或其依赖 `ai` 包的 chat store），确认 `stop()` 是否保留 `messages` 中已 append 的 assistant parts，还是回滚。grep 关键词：`abort`、`stop`、`status`、在 `ai` 包 chat 状态机里找 abort 处理。

- [ ] **Step 2: 记录结论**

把结论写进本计划文件 Task 2 开头的注释（DONE_WITH_CONCERNS 报告里也写明）：
- 若 **SDK 保留 parts** → Task 2 只需修 transport abort 收尾（flush batcher），`setMessages` 定格作为冗余保险可选做。
- 若 **SDK 回滚 parts** → Task 2 必须做 `setMessages` 定格（用 Task 1 的纯函数）。

不写代码，只产出结论。这一步避免在不确定 SDK 行为时盲目加 setMessages 逻辑（可能与 SDK 内部状态打架）。

---

## Task 1: 封存 live assistant parts 的纯函数（TDD）

**Files:**
- Create: `apps/web/src/lib/chat/seal-live-assistant-parts.ts`
- Test: `apps/web/src/lib/chat/seal-live-assistant-parts.test.ts`

抽一个纯函数，把 useChat 的 live `messages` 数组里最后一条仍在流式的 assistant 消息「定格」——保留其当前已累积的 parts，并在 metadata 标记 `streamState: "cancelled"`。这样即便随后 abort，已生成内容也已固化在 messages 里。纯函数便于单测，对齐 hermes `interruptTurn` 的「先封存 partial」。

参考已有测试风格：`apps/web/src/lib/chat/assistant-stream-state.test.ts`。UIMessage 类型从 `ai` 包导入。

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/lib/chat/seal-live-assistant-parts.test.ts`：

```typescript
import { describe, it, expect } from "vitest"
import type { UIMessage } from "ai"

import { sealLiveAssistantParts } from "./seal-live-assistant-parts"

function userMsg(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] } as UIMessage
}
function assistantMsg(
  id: string,
  text: string,
  metadata?: Record<string, unknown>
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    ...(metadata ? { metadata } : {}),
  } as UIMessage
}

describe("sealLiveAssistantParts", () => {
  it("把最后一条 assistant 标记为 cancelled，保留其 parts", () => {
    const input = [userMsg("u1", "hi"), assistantMsg("a1", "已经生成了一半")]
    const out = sealLiveAssistantParts(input)
    const last = out[out.length - 1]
    expect(last.parts).toEqual(input[1].parts)
    expect(
      (last.metadata as Record<string, unknown> | undefined)?.streamState
    ).toBe("cancelled")
  })

  it("保留已有 metadata 其他字段，仅补 streamState", () => {
    const input = [assistantMsg("a1", "x", { elapsed_ms: 1200 })]
    const out = sealLiveAssistantParts(input)
    const meta = out[0].metadata as Record<string, unknown>
    expect(meta.elapsed_ms).toBe(1200)
    expect(meta.streamState).toBe("cancelled")
  })

  it("最后一条不是 assistant（如用户刚发出）→ 原样返回", () => {
    const input = [assistantMsg("a1", "done"), userMsg("u2", "再问")]
    const out = sealLiveAssistantParts(input)
    expect(out).toBe(input)
  })

  it("空数组 → 原样返回", () => {
    const input: UIMessage[] = []
    expect(sealLiveAssistantParts(input)).toBe(input)
  })

  it("不修改入参（返回新数组与新消息对象）", () => {
    const input = [assistantMsg("a1", "partial")]
    const out = sealLiveAssistantParts(input)
    expect(out).not.toBe(input)
    expect(out[0]).not.toBe(input[0])
    expect(
      (input[0].metadata as Record<string, unknown> | undefined)?.streamState
    ).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/web && pnpm test:unit -- seal-live-assistant-parts`
Expected: FAIL — `sealLiveAssistantParts is not exported` / 模块不存在。

- [ ] **Step 3: 实现**

创建 `apps/web/src/lib/chat/seal-live-assistant-parts.ts`：

```typescript
import type { UIMessage } from "ai"

/**
 * 终止流式时「定格」最后一条仍在流式的 assistant 消息：保留其当前已累积 parts，
 * 并在 metadata 标记 streamState="cancelled"。对齐 hermes turnController.interruptTurn
 * 的「先封存 partial 再清空」——即便随后 abort 撕流，已生成内容也已固化在 messages 里，
 * 不必等 DB 重拉。
 *
 * 不修改入参：返回新数组 + 新消息对象（React 状态不可变更新）。最后一条非 assistant
 * （如用户刚发出、尚无 assistant 回复）或空数组 → 原样返回。
 */
export function sealLiveAssistantParts(messages: UIMessage[]): UIMessage[] {
  if (messages.length === 0) return messages
  const lastIndex = messages.length - 1
  const last = messages[lastIndex]
  if (last.role !== "assistant") return messages

  const prevMeta =
    last.metadata && typeof last.metadata === "object"
      ? (last.metadata as Record<string, unknown>)
      : {}

  const sealed: UIMessage = {
    ...last,
    metadata: { ...prevMeta, streamState: "cancelled" },
  } as UIMessage

  const next = messages.slice()
  next[lastIndex] = sealed
  return next
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/web && pnpm test:unit -- seal-live-assistant-parts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/chat/seal-live-assistant-parts.ts \
        apps/web/src/lib/chat/seal-live-assistant-parts.test.ts
git commit -m "feat(chat): 加 sealLiveAssistantParts——终止时定格 live assistant 已生成内容

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: transport abort 优雅收尾 + handleStop 封存 partial（现象1）

**Files:**
- Modify: `apps/web/src/lib/chat/langchain-chat-transport.ts:491-560`（processResponseStream 的 onAbort）
- Modify: `apps/web/src/components/chat/views/chat-conversation-view.tsx:349-381`（handleStop）

> **Task 0 结论（已查证 ai@6.0.188 / @ai-sdk/react@3.0.190）：** `stop()` 只调 `abortController.abort()`，abort 时 catch 块 `if (isAbort) { setStatus("ready"); return null }` **不回滚已写进 `state.messages` 的 parts**——SDK **保留**已渲染内容。真正丢的只有 transport 层 rAF batcher 里**还没 enqueue 给 SDK** 的 chunk（裸 `reader.cancel()`）。
> 因此：**transport abort 收尾（flush batcher）是核心必需修复**；**handleStop 的 setMessages 定格是正向加固**（用户决定保留）——它让停止瞬间 UI 立即把 streamState 标 cancelled、显示「已停止」终态，而非短暂空白等收尾。两者都做。

abort 时不再裸 `reader.cancel()`，而是先把 rAF batcher 残留 flush 出去、补全 text 阶段收尾、enqueueFinish，再关闭——复刻 `[DONE]` 正常路径的收尾动作（langchain-chat-transport.ts:553-557）。这样停止时已收到的 chunk 不丢。

- [ ] **Step 1: 改 transport abort 收尾**

在 `processResponseStream`（[langchain-chat-transport.ts:491](apps/web/src/lib/chat/langchain-chat-transport.ts:491)）里，`onAbort` 现在是 `() => reader.cancel()`（:503）。问题：`flushSync`/`closeTextPhaseIfNeeded`/`enqueueFinish`/`controller`/`state` 都定义在内层 `new ReadableStream({ start: async (controller) => {...} })`（:511-524）的闭包里，而 onAbort 在外层。需要把收尾能力暴露给 onAbort。

最小改法：在 `start` 闭包内创建 batcher 后，把「优雅收尾函数」挂到一个外层可见的 ref 变量，onAbort 优先调它，没有才回退 `reader.cancel()`。

具体修改——把 abort 监听段（:501-509）改为：

```typescript
    // signal 触发时：优雅收尾（flush 已收 chunk + 补 text-end + finish）再取消 reader，
    // 避免裸 cancel 丢掉 rAF batcher 里尚未 flush 的 chunk（现象1 根因）。
    let gracefulAbort: (() => void) | null = null
    if (abortSignal) {
      const onAbort = () => {
        if (gracefulAbort) {
          gracefulAbort()
        } else {
          void reader.cancel()
        }
      }
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener("abort", onAbort, { once: true })
      }
    }
```

然后在内层 `start: async (controller) => {` 体内、`createChunkBatcherForMode` 拿到 `{ schedule, flushSync }` 之后（约 :520-524 后），登记 gracefulAbort。在 `controller.enqueue({ type: "start" })`（:526）之前插入：

```typescript
        // 供外层 onAbort 调用：与 [DONE] 同样的收尾，确保停止时 batcher 残留不丢。
        // 用 closed 标志防重复 close。
        let streamClosed = false
        gracefulAbort = () => {
          if (streamClosed) return
          streamClosed = true
          try {
            flushSync()
            closeTextPhaseIfNeeded(state).forEach((chunk) =>
              controller.enqueue(chunk)
            )
            enqueueFinish(controller, state)
            controller.close()
          } catch {
            /* controller 已被 SDK 关闭/锁定则忽略 */
          }
          void reader.cancel()
        }
```

注意：`[DONE]` 分支（:552-559）现在直接 close。为避免与 gracefulAbort 双重 close，把 `[DONE]` 分支也纳入 `streamClosed` 守卫——在 `if (data === "[DONE]") {` 体首加 `if (streamClosed) return true`，并在它 `controller.close()` 前置 `streamClosed = true`。改后 `[DONE]` 分支：

```typescript
          if (data === "[DONE]") {
            if (streamClosed) return true
            streamClosed = true
            flushSync()
            closeTextPhaseIfNeeded(state).forEach((chunk) =>
              controller.enqueue(chunk)
            )
            enqueueFinish(controller, state)
            controller.close()
            return true
          }
```

> 若 `streamClosed` 的作用域使 `[DONE]` 分支访问不到（它在 `flushEvent` 内，与 gracefulAbort 同在 `start` 闭包，应可见），确认两者在同一 `start` 作用域。`flushEvent` 是 `start` 内定义的（:538），可访问 `start` 顶部声明的 `streamClosed`。

- [ ] **Step 2: typecheck transport**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: handleStop 封存 partial（按 Task 0 结论）**

在 [chat-conversation-view.tsx:349](apps/web/src/components/chat/views/chat-conversation-view.tsx:349) 的 `handleStop`，在 `stop()`（:350）**之前**插入封存：

```typescript
  const handleStop = useCallback(async () => {
    // 终止前先定格 live 已生成内容，避免 abort 撕流后这部分只能等 DB 重拉
    // （现象1）。对齐 hermes interruptTurn 的「先封存 partial」。
    setMessages((prev) => sealLiveAssistantParts(prev))

    stop()

    chatTransport.cancelReconnect()
    // …以下不变
```

文件顶部 import：

```typescript
import { sealLiveAssistantParts } from "@/lib/chat/seal-live-assistant-parts"
```

确认 `setMessages` 已从 useChat 解构（:254，已有）。`setMessages` 接受 updater 函数形式 `(prev) => UIMessage[]`（AI SDK 支持）；若该版本 setMessages 只接受数组，改为 `setMessages(sealLiveAssistantParts(messages))`（用闭包 messages，:252 已解构）。Task 0 调查时一并确认 setMessages 签名。

> 若 Task 0 结论是「SDK 保留 parts」，此步仍建议保留——它把 streamState 标成 cancelled，让 UI 立即显示「已停止」终态而非空等 DB；属低成本正向加固。

- [ ] **Step 4: typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/chat/langchain-chat-transport.ts \
        apps/web/src/components/chat/views/chat-conversation-view.tsx
git commit -m "fix(chat): 终止流式时优雅收尾+定格已生成内容，不再漏数据(现象1)

abort 不再裸 reader.cancel()——先 flush rAF batcher 残留 chunk + 补 text-end +
enqueueFinish 再 close，复刻 [DONE] 正常收尾；handleStop 在 stop() 前 sealLiveAssistantParts
定格 live assistant，避免已生成内容要等 DB 重拉才显示。对齐 hermes turnController.interruptTurn。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 单例 transport 会话切换整体 reset（现象2）

**Files:**
- Modify: `apps/web/src/lib/chat/langchain-chat-transport.ts`（加 `resetForConversation`）
- Modify: `apps/web/src/components/chat/views/chat-conversation-view.tsx:385-390`（切会话 effect 调用它）

单例 transport 跨会话共享 `_reconnectAbort`/`_reconnectChatId`/`_resumeConversationId`/`_resumeSealedToolCallIds`，切会话只 `cancelReconnect()` 不整体清，旧会话 in-flight 状态污染下个会话（现象2）。加一个整体 reset 方法，切会话时调用——对齐 hermes `turnController.reset()`（切 session 整体清缓冲）。

- [ ] **Step 1: transport 加 resetForConversation**

在 [langchain-chat-transport.ts](apps/web/src/lib/chat/langchain-chat-transport.ts) 的 `cancelReconnect`（:374）附近加：

```typescript
  /**
   * 会话切换时整体重置 in-flight resume 归属状态，杜绝上个会话的 reconnect/resume
   * 状态污染下个会话（现象2：切总管/助手偶发漏内容、来回切两次才正常）。
   * 对齐 hermes turnController.reset() 的「切 session 整体清缓冲」。
   * cancelReconnect 已 abort 在飞连接并清 _reconnectAbort/_reconnectChatId；
   * 这里再清两个 resume 归属字段。
   */
  resetForConversation = () => {
    this.cancelReconnect()
    this._resumeConversationId = null
    this._resumeSealedToolCallIds = []
  }
```

- [ ] **Step 2: 切会话 effect 调用**

把 [chat-conversation-view.tsx:385-390](apps/web/src/components/chat/views/chat-conversation-view.tsx:385) 的切会话 effect：

```typescript
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      chatTransport.cancelReconnect()
      prevConversationIdRef.current = conversationId
    }
  }, [conversationId])
```

改为：

```typescript
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      // 整体 reset，而非仅 cancelReconnect——清掉上个会话的 resume 归属，防串台（现象2）
      chatTransport.resetForConversation()
      prevConversationIdRef.current = conversationId
    }
  }, [conversationId])
```

- [ ] **Step 3: typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/chat/langchain-chat-transport.ts \
        apps/web/src/components/chat/views/chat-conversation-view.tsx
git commit -m "fix(chat): 切会话时整体 reset 单例 transport 的 resume 归属，防串台(现象2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 端到端手动验收

**Files:** 无（验收）

前端流式无法纯自动化端到端测，本 Task 是人工验收清单。

- [ ] **Step 1: 重启桌面端**

完全退出 Electron（含托盘），`pnpm --filter web dev:app`（或 dev:client）。

- [ ] **Step 2: 现象1 验收（核心）**

找一个会生成较长回复的对话，流式进行到一半时点「终止」按钮。
Expected: **已生成的内容保留在气泡里**（不再漏/截断），消息显示「已停止」终态；不需要切走再切回。重复 3 次稳定。

- [ ] **Step 3: 现象1 回归——正常完成**

让一个对话自然流式完成（不点终止）。
Expected: 内容完整、正常落定，无重复、无截断（验证 streamClosed 守卫没破坏 [DONE] 正常路径）。

- [ ] **Step 4: 现象2 验收**

总管对话流式进行中 → 切到某员工对话 → 再切回 → 再切到另一个员工。快速来回切几次。
Expected: 每个会话显示自己的内容，不串台、不需要「来回切两次才正常」。正在流式的会话切回后能继续看到实时输出（resume 续流不被 reset 误伤——确认 resetForConversation 只在「会话真的变了」时触发，切回正在跑的会话时它会重新 resume）。

- [ ] **Step 5: 现象2 回归——群深链/总管 remount**

进群成员执行会话（深链 remount 路径）、进总管会话，确认流式实时输出正常（验证 reset 没破坏既有 resume 续流机制）。

- [ ] **Step 6: 记录结果**

把验收结果如实反馈。若现象2 仍偶发，可能需要进一步做事件层 conversationId 守卫（见下方可选 Task 5）。

---

## Task 5（可选，仅当 Task 4 现象2 仍复现）: 事件层 conversationId 归属守卫

**背景：** 若 `resetForConversation` 仍不足以根除串台，参照 hermes `createGatewayEventHandler.ts:402` 的 `ev.session_id !== sid` 守卫，在 transport 解析事件 enqueue 前校验事件归属会话与当前流匹配。

**判断：** 仅当 Task 4 Step 4 实测仍偶发串台再做——否则 YAGNI。这需要后端 SSE 事件带 conversationId（确认协议是否已带），改动面更大。

---

## Self-Review

**1. Spec coverage：**
- 现象1（终止漏数据）→ Task 1（封存纯函数）+ Task 2（transport abort 收尾 + handleStop 定格）✓
- 现象2（切会话漏/来回切两次）→ Task 3（resetForConversation）✓，Task 5 兜底（可选）
- 「先验证 SDK 行为再定方案」→ Task 0 ✓（避免基于假设盲改）

**2. Placeholder scan：** 每个改码步骤给了完整代码块。Task 2 的 transport 改动依赖 `streamClosed`/`gracefulAbort` 作用域——已说明二者同在 `start` 闭包、`flushEvent` 可访问。无 TBD/「类似上文」。

**3. Type consistency：**
- `sealLiveAssistantParts(messages: UIMessage[]): UIMessage[]` 在 Task 1 定义、Task 2 import 使用，签名一致 ✓
- `resetForConversation`（Task 3 定义）/ `cancelReconnect`（已有，Task 3 内部调用）命名区分清楚 ✓
- `gracefulAbort` / `streamClosed` 在 Task 2 同一处定义与使用 ✓
- `streamState: "cancelled"` 与现有 `patchLastAssistantStreamState(...,"cancelled")` 用的同一字面量 ✓

**4. 已知风险与缓解：**
- Task 2 改 transport 收尾有破坏 [DONE] 正常路径的风险 → 用 `streamClosed` 守卫 + Task 4 Step 3 专门回归正常完成。
- Task 3 reset 有误伤「切回正在跑的会话」resume 的风险 → effect 仅在 conversationId 真变时触发，切回会重新 resume；Task 4 Step 4/5 专门验证。
- Task 0 前置降低「SDK stop 行为假设错误」风险。
