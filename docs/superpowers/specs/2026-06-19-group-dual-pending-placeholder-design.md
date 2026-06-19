# 堆死群聊双「正在生成回复」占位 设计

日期：2026-06-19
状态：设计待评审

## 背景与问题

群聊用户发出消息后，时间线偶尔**瞬态出现两条「正在生成回复…」占位气泡**（截图实测）。抓单帧运行时数据时只剩一条且正确，确认是**瞬态**、非稳态——最终收敛为一条，不影响功能，但视觉上「以为出了两条」。

### 根因（运行时数据 + 代码坐实）

占位与真实流式消息用**不同来源的 id**：
- 真实流式消息 id = `group-stream-${s.sourceConversationId}`（来自 `streaming` 数组，`computeGroupExtraMessages` 约 :56-59）。
- 占位 id = `group-stream-${leaderConvId}`（`leaderConvId` 来自 `members` 里 leader 的 `conversation_id`；为 null 时退化为 `"group-stream-pending-leader"`，约 :74-78）。

`streaming`（SSE 逐字流）与 `members`（房间状态 query）刷新节奏不同。在组长流刚到、`streaming` 已更新但 `members` 尚未刷新的帧，`leaderConvId` 可能仍为 null/旧值 → 占位 id 与真实流式 id 不一致 → React 视作两个不同 key 的消息 → **同一帧并存两条**（一条真实流式 + 一条 pendingReply 占位）。

现有去重 `mergeGroupStreamingMessages`（`group-extra-messages.ts` 约 :117，dev 上 e1613f2 引入）的 `isEmptyStreamingPlaceholder` 只剥 **prepared** 里的空流式占位，**管不到 extras 内部、也不保证「占位 vs 真实内容」互斥**——所以这条裂缝没被堵住。

> 注：`computeGroupExtraMessages` 单帧本就最多产一条占位；双条 = 占位与真实流式（或落库回复）并存，不是 extras 产了两条。

## 设计决策（已与用户确认）

- 互斥保证放在 **merge 处按 pendingReply 堆死**：合并时若时间线已有组长真实可见内容，剥掉 extras 里的 pendingReply 占位。不依赖 id 是否一致。
- 直接在 **dev 上修**（这是 dev 上 e1613f2/mergeGroupStreamingMessages 的残留瞬态 bug，用户在 dev 复现）。
- 不改 `computeGroupExtraMessages` 的产出逻辑（单帧最多一条占位，无需动）。

## 范围

纯前端，单文件 `apps/web/src/lib/chat/group-extra-messages.ts`（+ 其测试）。

### 改动：mergeGroupStreamingMessages 加「有真实内容则剥占位」

修改 `mergeGroupStreamingMessages(prepared, extras)`：

1. 判断「组长是否已有真实可见内容」`leaderHasRealContent`：
   - extras 里存在**非占位的组长流式消息**：`metadata.senderName === "组长"` 且**无** `metadata.pendingReply` 且有可见文本（某 text part `text.trim().length > 0`）；
   - 或 prepared 里存在**组长的可见回复**：`metadata.senderName === "组长"` 且有可见正文/工具 part（复用 `assistantMessageHasVisibleBody` 的判据：有非空 text 或 `tool-` 开头的 part）。
2. 若 `leaderHasRealContent` 为真 → 从 extras 里**滤掉所有 pendingReply 占位**（`metadata.pendingReply === true`）。组长已开口，占位多余。
3. 沿用现有逻辑：从 prepared 剥掉空流式占位（`isEmptyStreamingPlaceholder`）。
4. 拼接 `[...剥过的 prepared, ...剥过的 extras]`。

判据用 `metadata.pendingReply === true` 标识占位（`computeGroupExtraMessages` 已给占位打此标）；用 `senderName === "组长"` 标识组长来源（与现有代码一致）。「有可见正文/工具 part」复用 `assistantMessageHasVisibleBody`（`group-composer-ghosts.ts` 已导出，同包可 import）。

> 互斥被堆死的证明：两条「正在生成回复」必有≥1 条是 pendingReply 占位。单帧 extras 最多一条占位；prepared 占位已被 isEmptyStreamingPlaceholder 剥。剩下唯一的并存可能=「占位 + 组长真实内容」。本改动在「有组长真实内容」时剥掉占位 → 该并存不可能 → 任何帧不超过一条「正在生成回复」。

### 不在本期范围

- `computeGroupExtraMessages` 的 id 稳定化（次选方案，本期采用 merge 互斥，不动产出）。
- worktree 分支上未合的「权威计划卡 / 首响应占位」几轮（与 dev 并行线重叠，待议，本期不碰）。
- 后端 / DAG / 计划卡逻辑（不相关）。

## 数据流（修复后）

群 displayMessages：prepared = prepareDisplayMessages(去重后 source)；extras = computeGroupExtraMessages（最多一条组长占位 + 各成员/组长真实流式）→ `mergeGroupStreamingMessages`：若组长已有真实内容（extras 或 prepared 任一）则剥 extras 的 pendingReply 占位，再剥 prepared 空流式占位，拼接。结果：占位仅在组长无任何可见内容时存在，与真实内容互斥。

## 测试

前端 Vitest（`pnpm --filter digital-employee test:unit group-extra-messages`）：
- extras 同时含「组长真实流式（有文本、无 pendingReply）」+「一条 pendingReply 占位」→ 输出剥掉 pendingReply，保留真实流式。
- prepared 含「组长落库回复（senderName=组长 + 正文）」、extras 含一条 pendingReply 占位 → 输出剥掉 pendingReply。
- 只有 pendingReply 占位（组长无任何可见内容、extras 无真实流式、prepared 无组长回复）→ 占位保留。
- 现有「剥 prepared 空流式占位」用例不回归（若该测试已存在则确认仍过；mergeGroupStreamingMessages 既有行为保留）。
- 手动验证：群发并行需求，连续观察发送→组长流式全过程，任何时刻只出现一条「正在生成回复」，组长开始打字后占位被真实流式取代。

## 风险

- 误剥真实流式：滤除条件严格限定 `metadata.pendingReply === true`，真实流式消息无此标记，不会被误剥。
- `leaderHasRealContent` 判据与 `computeGroupExtraMessages` 的 senderName/pendingReply 约定一致（同文件，约定稳定）；若未来占位标记字段改名，两处需同步（同文件内，低风险）。
- prepared 里组长回复的识别用 `assistantMessageHasVisibleBody`（已有、已测）——避免重写判据。
- 仅作用 merge，`computeGroupExtraMessages` 产出不变，无新副作用。
