---
name: Simplify Conversation Session Flow
overview: 优化前端会话消息的数据流转时序与同步机制，将 React Query（冷存储快照）与 useChat（活跃状态主控）进行严格解耦，彻底消除页面闪烁和历史数据覆盖的问题。
todos:
  - id: session-session-lock
    content: 在 use-conversation-session.ts 中引入 hydratedConvIdRef 状态锁
    status: pending
  - id: session-effect-refactor
    content: 重构冷启动同步 Effect，只允许在会话加载时执行一次 setMessages
    status: pending
  - id: session-typecheck
    content: 通过 pnpm exec tsc --noEmit 运行 TypeScript 类型检查，确保类型安全
    status: pending
isProject: false
---

# 优化 useConversationSession 数据同步时序

当前的前端数据流存在“双向反应式覆盖”的冗余设计：每次流结束或后台 refetch 时，React Query 会触发全表覆盖 `setMessages(initialMessages)`，破坏了 `useChat` 正在累积的最新状态，导致了“页面闪烁”及“审批后恢复丢段”等竞态 Bug。

为使数据流更高效、简单、稳定，我们制定以下优化方案：

## 1. 核心设计原则：单向门禁机制（Gated Hydration）
* **useChat 运行时 (`messages`) 是绝对的活跃主控（Active Master）**：流式传输、手动补丁（乐观更新、append 新行、SSE interrupt 合并）均实时、显式地改写它，作为屏上真相。
* **React Query (`storedMessages`) 是静默的备份快照（Cold Storage）**：仅用于进入会话时的初始化（Hydrate）。
* **门禁锁死**：一旦会话完成首次初始化，背景的 React Query `refetch` **绝不**被动覆盖活跃的 `composer`。以此彻底消灭竞态。

---

## 2. 改造方案

### 2.1 引入 `hydratedConvIdRef` 状态锁
在 `[apps/web/src/hooks/use-conversation-session.ts](apps/web/src/hooks/use-conversation-session.ts)` 中，使用 `useRef` 记录当前已初始化（Hydrate）的会话 ID。
* 当切换会话时，重置此锁。
* 在初始化 `useEffect` 中，仅当 `hydratedConvIdRef.current !== convKey` 且 DB 数据加载完成时，执行一次 `setMessages(initialMessages)`，并立即闭锁。

### 2.2 剥离反应式依赖
将同步 `useEffect` 的触发条件收窄，确保它在会话生命周期内只在“冷启动”时起作用：
* 屏蔽 `initialMessages` 变化引起的自动全量覆盖。
* 允许背景的 `/messages` 刷新（Query Cache）静默进行，不干扰屏幕上的活跃流。

---

## 3. 具体修改点

### `use-conversation-session.ts` 逻辑重构

修改 `[apps/web/src/hooks/use-conversation-session.ts](apps/web/src/hooks/use-conversation-session.ts)` 中的核心同步 Effect。伪代码如下：

```typescript
// 记录已经完成 Hydrate 历史记录的会话 ID
const hydratedConvIdRef = useRef<string | null>(null)

// 切换会话时重置锁
useEffect(() => {
  if (prevConversationIdRef.current !== conversationId) {
    resumeAttemptedForRef.current = null
    prevConversationIdRef.current = conversationId
    hydratedConvIdRef.current = null // 重置锁
  }
}, [conversationId])

// 仅在冷启动或切换会话时进行一次性 Hydrate
useEffect(() => {
  if (!convKey) return
  
  // 核心门禁：如果当前会话已经初始化过，绝不让后台 refetch 的旧 cache 覆盖活跃的 composer
  if (hydratedConvIdRef.current === convKey) return
  
  // 尚无 DB 数据时等待首次加载完成
  if (initialMessages.length === 0 && storedMessages.length === 0) return

  // 1. 执行一次性冷启动同步
  setMessages(initialMessages)
  hydratedConvIdRef.current = convKey

  // 2. 首次进入时，检查是否需要自动恢复流（Resume）
  if (hitlActiveRef.current) return

  const lastAssistant = getLastAssistantMessage(storedMessages)
  if (lastAssistant?.streamState !== "streaming") return
  if (resumeAttemptedForRef.current === lastAssistant.id) return

  resumeAttemptedForRef.current = lastAssistant.id
  chatTransport.setResumeConversationId(convKey)
  const rafId = requestAnimationFrame(() => {
    if (status !== "ready" && status !== "error") return
    resumeStream()
  })
  return () => cancelAnimationFrame(rafId)
}, [
  convKey,
  initialMessages,
  storedMessages,
  setMessages,
  resumeStream,
  status
])
```

---

## 4. 优化效果与自测指标
* **无闪烁**：流结束后触发的 800ms refetch 不会重新全表覆盖 `setMessages`，气泡列表无任何感知，完美平滑。
* **无回退**：approve 后 resume 的新行即便因 DB 落库延迟导致 cache 短暂偏旧，由于门禁已锁，绝对不会把 composer 中正在流式的 parts 冲掉。
* **极简心智**：开发者只需要记住：*进入会话时拉一次 DB 初始化，之后 composer 负责到底，事件直接 patch 变更，结束各走各路不冲突*。
