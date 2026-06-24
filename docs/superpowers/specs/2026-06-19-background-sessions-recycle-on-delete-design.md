# backgroundSessions 会话删除回收 — 设计

日期：2026-06-19
分支策略：先把 `claude/sharp-kalam-9012c5`（含 `backgroundSessions`，commit `e6cff0e`）合进 `dev`，再在 `dev` 基底上实现本设计。

## 背景

`apps/web/src/stores/browser-store.ts` 的 `backgroundSessions: Set<string>` 记录「非前台会话有内嵌浏览器命令在跑」。当前（kalam 分支上）它只在两处被清除：

1. `browser-confirmation-host.tsx` 的 `onRequestClose` 收到带匹配 `conversationId` 的 close 事件 → `clearBackground(owner)`。
2. 后台会话变成前台、`onRequestOpen` 命中 `owner === fg` → `clearBackground(owner)`。

`reset()` 故意不清它（注释已写明：跨前台 reset 留存，回收靠按 conversationId 的 close 事件）。

### 泄漏

若某后台会话的浏览器关闭时**没有**发出带 `conversationId` 的 close 事件——会话被删除、或 close 事件 `conversationId` 为 null——它的 id 永久滞留在 Set 里。长生命周期 renderer 下缓慢泄漏 conversation-id 字符串。

目前无害（暂无 UI 消费 `backgroundSessions`），是 commit `e6cff0e` code review 标为 Important、同意不阻塞当时 commit 的 latent 收尾项。在给它加 UI 消费（非前台浮标/角标）之前补回收路径。

## 范围

**只接「会话删除」一条回收路径。** 经评估排除另外两条：

- **task-end（任务结束）不作为触发点。** 任务结束并不必然关闭浏览器——面板/内嵌浏览器可在 run 结束后留存供查看。在 task-end 清标记会误删仍有效的后台标记。浏览器**真正**关闭时本就会发 `onRequestClose`；那条路径真正的缺口只是「close 事件 `conversationId` 为 null」，而 task-end 也修不了它。
- **列表 sweep（兑底）不做。** 属推测性兜底：会引入一个每次列表刷新都重算全集的订阅，且有边界案例——刚 `noteBackgroundOpen` 但尚未进入缓存列表的会话 id 会被误扫。在出现 UI 消费方、且证明确有残留泄漏之前不值得加。

会话被删 = 该会话永不复返，清掉它的后台标记无歧义正确，因此「删除」是唯一既高价值又零误判的回收点。

## 实现

### 1. store 侧（无需改动）

`browser-store.ts` 已有 `clearBackground(conversationId: string)`，幂等（`if (!has) return {}`）。直接复用。

### 2. 删除路径接入 — `apps/web/src/hooks/use-chat-queries.ts`

共三个会删除会话的 mutation，均在其成功回调里对受影响的 id 调 `clearBackground`：

| Mutation | 位置 | 拿到的 id | 接入点 |
|---|---|---|---|
| `useDeleteConversationMutation`（单删） | `onSuccess: () => { resetChatRightPanels() }`（约 460 行） | `variables.conversationId` | 在 `onSuccess(_d, variables)` 里 `clearBackground(String(variables.conversationId))` |
| `useDeleteAllConversationsForContactMutation`（按联系人全删） | `onSuccess(deletedIds, …)`（约 330 行） | `deletedIds: number[]` | 遍历 `deletedIds`，逐个 `clearBackground(String(id))` |
| `useResetCuratorConversation`（删单条总管会话） | `onSuccess(_data, variables)`（约 489 行） | `variables.conversationId` | `clearBackground(String(variables.conversationId))` |

接入方式：复用已有的 `resetChatRightPanels`（`@/lib/chat/reset-chat-right-panels`）不合适——它是**无 id 的整体右栏 reset**（`destroyBrowser()` 只动前台浏览器），无法按具体被删 id 清后台标记。因此直接在三处 `onSuccess` 里调 store 的 `clearBackground`。

调用方式（避免在模块顶层 import 造成的循环依赖风险，与现有 `resetChatRightPanels` 内部一致）：
```ts
import { useBrowserStore } from "@/stores/browser-store"
// onSuccess 内：
useBrowserStore.getState().clearBackground(String(conversationId))
```
`use-chat-queries.ts` 当前未直接 import `browser-store`，新增该 import；`browser-store` 不反向依赖 `use-chat-queries`，无环。

### 3. 文档化「不接 task-end」

在 `browser-store.ts` 的 `reset()` 既有注释附近、或 `clearBackground` 上方补一行注释，写明回收路径＝按 conversationId 的 close 事件 + **会话删除**；task-end 故意不作为触发点（理由见上），以免后人「顺手补一个 task-end 清理」反而引入误删。

## 测试

`browser-store` 已有测试文件的话，加用例覆盖 `clearBackground` 幂等与「删除某 id 后 Set 不再含该 id」。若回调接入难以单测（mutation 依赖 react-query），最小化为：
- 单元测 `clearBackground`：noteBackgroundOpen(a,b) → clearBackground(a) → Set 仅剩 b；clearBackground(不存在的 id) 不抛、不改引用语义。
- 三个 mutation 的接入以类型 + 手动验证为主（删除一个有后台浏览器在跑的会话后，`useBrowserStore.getState().backgroundSessions` 不再含该 id）。

## 验收

1. `pnpm typecheck` 通过。
2. 删除某后台会话（其曾 `noteBackgroundOpen`）后，`backgroundSessions` 不再含该 id。
3. 按联系人全删 / 删总管会话同样回收对应 id。
4. 前台会话删除、无关会话删除不误清其他 id。
5. task-end 不触发清理（保持后台标记，符合「浏览器可留存」语义）。
