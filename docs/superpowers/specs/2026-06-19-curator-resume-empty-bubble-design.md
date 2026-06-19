# 修复 curator 切回会话消息塌空（重放期间不丢已落内容）设计

日期：2026-06-19
状态：设计待评审

## 背景与问题

**总管（curator）会话**：切走到别的对话再切回后，**一条已答完的消息正文那一块变空了**（气泡外壳在、内容没了）；正在恢复的那条内容也不回来。**手动刷新后正文回来** → 后端/DB 里正文一直在，是前端切回时把已落库正文渲染成了空。

### 根因（已调查坐实，含 file:line）

根触发器：DB 末条 assistant 的 `streamState` 长期停在 `"streaming"`（后台其实答完了，但那次终态写回丢失——本仓库一直在打的「假结束」）。切回触发链：

1. 切会话 → `CuratorView` 按 `key={conversationId}` remount（`chat-view.tsx:126`）→ useChat 全新、live messages 空。
2. session effect 用 DB 快照灌入 composer（含完整正文），随即 `shouldAttemptResume` 因「末条 streamState==='streaming'」判定要续流（`use-conversation-session.ts:180-237`）。
3. 续流回调 `setMessages(resetLastAssistantPartsForResume)`（`use-conversation-session.ts:230`）把 **composer 末条 assistant 的 parts 清成空壳**（`session/reset-assistant-parts-for-resume.ts:23-35`，`parts: []`）——这是 ai@6 SDK resume 全量重放「不丢不重」的必要前置（注释已详述）。
4. start chunk 让 `status→"streaming"`。`pickMessageDisplaySource`（`pick-message-display-source.ts:176-177`）在 streaming/submitted 期 **直接 `return liveMessages`，不回退 DB** → 显示的是被清空那条。
5. **curator 放大点**：`mergeConsecutiveAssistantMessages`（`merge-consecutive-assistant-messages.ts:85`）把一轮里连续多条 assistant 合并成一条气泡（`parts: group.flatMap(m=>m.parts)`）。curator 一轮常产 ack/规划/工具/最终答多条；当被清空的空壳是这组里的成员时，合并结果丢失内容、气泡正文塌掉。单聊一轮多为单条 assistant，清空的就是当前流式那条（本就预期空），不显眼。

现有部分兜底（不够）：`use-conversation-session.ts:166` 注释提到「用 DB 快照把 resetLastAssistantPartsForResume 留下的空壳填回」，但它只在 resume 返回 **no_stream 完成时**（`:477` 一带）触发，**覆盖不到清空后、resume delta 到达前的 streaming 窗口**——正是这个窗口里气泡空着。

### 与 dev 并行重构的关系

不是群聊重构新引入。是既有 resume 机制的固有副作用，被 curator 合并气泡放大。真正把 curator 拉进「remount→续流→清空末条」这条路的最可能是 `a1d6261`（给 CuratorView 加 useStreamCleanupOnUnmount，切走主动 stop → 切回必走重新 resume）。**不回滚 a1d6261**（它修了「切回全空白」），本期补它暴露出的「重放期塌空」。

## 设计决策（已与用户确认）

核心保证：**重放期间（末条被清空、status=streaming），气泡永远显示 DB 已落内容，直到 resume 的真实 delta 追上覆盖。** 三层互锁，**不探测后端流是否真活跃**——真在跑→delta 覆盖；误判→DB 快照托底，两种都不丢。

## 范围

纯前端，三个纯函数 + 其测试（均有现成测试文件）。

### 改动 1（主修）：流式期 live 空壳回退 DB

文件：`apps/web/src/lib/chat/pick-message-display-source.ts`（`:176-178` 的 streaming/submitted 短路）

现状：streaming/submitted 期无条件 `return liveMessages`。
改为：streaming/submitted 期，对 live messages 里**空壳 assistant（parts 长度 0）**，回退取 DB（storedMessages）里**同 db id** 那条的 parts 填充后再返回；非空壳的 live 消息保持（保留 SSE 已累积的实时 parts，不被 DB 覆盖）。

具体：新增一个纯函数（同文件或相邻）`hydrateEmptyAssistantShellsFromDb(liveMessages, storedMessages)`：遍历 live，对 `role==="assistant"` 且 `parts.length===0` 的，按 `parseDbMessageId` 找 stored 同 id、用其 parts 填充（meta 保留 live 的 streamState 等）；无匹配则原样；无任何填充返回同引用。streaming/submitted 分支改为 `return hydrateEmptyAssistantShellsFromDb(liveMessages, storedMessages)`。

> 复用既有 `parseDbMessageId` + `storedMessageIndexByDbId` 风格（该文件已有同款）。真 delta 到达后 live 那条 parts 非空 → 不再回退 → delta 正常显示。

### 改动 2：合并不让空壳塌泡

文件：`apps/web/src/lib/chat/merge-consecutive-assistant-messages.ts`（`mergeAssistantGroup` `:54-88`，`parts: group.flatMap(m=>m.parts)` `:85`）

合并一组连续 assistant 时，若组内末条（或任一条）是空壳（parts 为空）且组内有其它非空成员，`flatMap` 自然只剩非空成员的 parts——这已能保留前面已完成段。但需确认：当**整组只有一条且它是空壳**时，改动 1 已在上游把它从 DB 填回（pickMessageDisplaySource 先于 prepareDisplayMessages/merge 执行），故 merge 拿到的已是填充后的 parts。

本改动作为防御：`mergeAssistantGroup` 不做额外处理即可（flatMap 已天然保留非空段）；**仅加一处保障**——若 flatMap 后 parts 为空但组内某成员在 DB 有内容，不在此层处理（交给改动 1 的上游回退）。即本层主要靠改动 1 上游保证非空，merge 维持现状不塌；**若实现时发现 merge 仍能拿到全空组**（改动 1 未覆盖某路径），再在 merge 层按「保留组内最后一个非空成员的 parts」兜底。

> 说明：改动 1 在 pickMessageDisplaySource（数据源选择）层、改动 2 在 prepareDisplayMessages→merge 层，前者先执行。只要改动 1 把空壳填回，merge 自然不塌。改动 2 列为「确认 + 必要时兜底」，避免过度改动。

### 改动 3（收敛源头，简化版）：清空时不丢 DB 已落 parts

文件：`apps/web/src/hooks/use-conversation-session.ts`（`:230` 调 `resetLastAssistantPartsForResume` 处）

不改 `resetLastAssistantPartsForResume` 的「清空 parts」语义（SDK 重放必需）。但保证清空发生后，DB 快照仍可作为该 id 的内容来源——这已由改动 1（streaming 期按 id 回退 DB）达成：清空只发生在 composer live 态，DB（storedMessages/initialMessages）不受影响，改动 1 在 streaming 期就用 DB 填回空壳。**故改动 3 不需要额外保存「清空前快照」**——DB 本身就是权威快照，改动 1 已让它在重放期可用。

> 即：三层最终归一为「改动 1 让 DB 快照在 streaming 重放期托底空壳」这一个机制，改动 2/3 是确认其覆盖到合并气泡与清空路径、不需独立新增状态。这与「不探测活跃性、靠 DB 快照贯穿」的决策一致。

### 不在本期范围

- 后端「终态写回丢失、末条长期 streaming」的假结束（更深的后端问题，本期前端兜表现）。
- 回滚 a1d6261（不回滚）。
- worktree 上未合的两轮（占位/权威卡），仍待议。
- 单聊/群聊的显示（改动 1 对它们安全：空壳回退 DB 是通用且保守的，非空 live 不受影响；群消息有 senderName 不进 merge 合并，单聊单条本就预期空时 DB 也无更早内容可填）。

## 数据流（修复后）

切回 curator → remount → DB 灌入 → 误判 streaming → 清空末条 live parts → status=streaming → `pickMessageDisplaySource` 在 streaming 期对空壳 assistant **按 db id 从 DB 回退 parts** → prepareDisplayMessages/merge 拿到的是已填回内容的消息 → 气泡显示 DB 已落正文（不塌空）→ resume 真 delta 到达 → live 那条 parts 非空 → 不再回退 → delta 实时覆盖显示。误判（无 delta）→ 持续显示 DB 快照。

## 测试

前端 Vitest（`pnpm --filter digital-employee test:unit`）：
- `pick-message-display-source.test.ts`（若无则新建）：streaming 状态 + live 末条 assistant 为空壳（parts []）、DB 有同 id 带 parts → 返回的该条 parts 来自 DB；live 该条非空 → 不被 DB 覆盖（保留 live）；无同 id → 原样；非 streaming 状态走原有逻辑不变（既有用例不回归）。
- `merge-consecutive-assistant-messages.test.ts`：一组连续 assistant 含一条空壳 + 若干非空 → 合并后 parts = 非空成员之和（不丢）；既有合并用例不回归。
- `reset-assistant-parts-for-resume.test.ts`：保持既有（清空语义不变）。
- 手动验证：**curator 会话 + 一轮多条连续 assistant + DB 末条 streamState=streaming**，切走再切回 → 已答完正文不塌空；切回正在恢复的消息显示 DB 已落内容、delta 到达后正常续写。单聊验证无回归。

## 风险

- 改动 1 误覆盖 live 实时 parts：只对 `parts.length===0` 的空壳回退，非空 live 不动 → SSE 累积内容不被 DB 覆盖。
- DB 与 live id 对不上导致填不回：用 `parseDbMessageId` 同口径匹配（与文件既有 storedMessageIndexByDbId 一致）；对不上则原样（退化为现状，不更糟）。
- 改动 1 在 streaming 期引入 DB 依赖可能闪烁：回退仅在「live 空壳」时发生，delta 一到即停止回退，过渡平滑；无 delta 时本就该显 DB（正是修复目标）。
- 过度改动 merge：改动 2 以「确认现状 flatMap 已保留非空段、必要时才加兜底」为度，避免动 merge 核心。
