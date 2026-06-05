# 会话/聊天地基重构设计：事件溯源式单一时间线

- 日期：2026-06-05
- 状态：设计待评审
- 范围：`apps/web`（前端）+ `apps/server`（Python/FastAPI 后端，本次可一起改）
- 目标：用一套统一、健壮、可扩展的地基，同时承载单聊与群聊，消灭当前"多数据源缝合"导致的系统性脆弱。

---

## 1. 背景与问题诊断

### 1.1 现状

当前前端会话运行时核心是 `apps/web/src/hooks/use-conversation-session.ts`（约 548 行）。它的本质工作是**不停地把多个数据源对账（reconcile）**：

1. React Query 缓存（`GET /messages`，数据库权威版本）
2. AI SDK `useChat` 的 `composerMessages`（流式消息，第二事实来源）
3. `/stream/resume`（断流恢复）
4. workspace 事件总线（`room_message` / `room_message_stream` 等）

这四个来源时序与语义各异，前端只能靠**启发式 patch** 去缝合（`messagesNeedHydrateFromDb` / `decideHydration` / `patchComposerFromStoredWhenSameTurn` / `hydrateSignature`）。为对抗 React 渲染时序，代码中充斥绕开响应式的 ref（`machineRef` / `statusRef` / `composerMessagesRef`）。最近修复的 Bug1（status 变化误清 refetch 防抖）、Bug2（退避 resume 闭包快照竞态）都是这场"与 React 搏斗"的伤口，治的是症状。

昨日新增的群聊（`apps/web/src/hooks/use-group-room.ts`）是**完全独立的第三套机制**：自带本地 `streaming` map（`useState`）、自订 `room_message_stream`、切会话时 `setStreaming({})`，完全不走 session machine 与 resume/HITL 防线，再把临时态手工投影成 `UIMessage` 塞进**与单聊共用**的 `ConversationChatView`。

### 1.2 根因

**系统缺少一个统一、权威的会话消息状态模型。** 现状是"两个数据源互相 patch + 一堆 ref 压制 React"，群聊又旁路加了第三条。用户实际遇到的全部症状——群聊重复/丢字/串台、切走切回进度丢失、群主汇报/产物延迟、单聊偶发流结束不回拉/卡 streaming、以及"代码层面无法再往上加功能"——都是同一个问题类别的不同表现：**多源时序缝合**。

### 1.3 方向

后端可一起重构，因此采用**事件溯源（Event Sourcing）**：后端成为唯一权威，对每个会话/房间维护一条有序、只追加、带单调序号的事件日志；前端退化为对事件流的纯函数投影（reducer）。单聊与群聊是同一套基础设施在不同 scope 上的投影。

> 事件溯源（通俗）：不直接存"现在长什么样"，而是把"发生过的每件事"按顺序记成一本账；要显示画面时，从头把账过一遍算出来。账本即唯一真相，直播只是账本实时长出新行。

---

## 2. 关键决策记录（已与用户确认）

| # | 决策 | 取舍 |
|---|------|------|
| D1 | 后端 API 与事件契约一起重构 | 选最干净路径，从根上消灭前端对账 |
| D2 | 采用方案 A：事件溯源式单一时间线 | 而非"前端 store 收敛"(B) 或"CRDT 同步引擎"(C) |
| D3 | 落地节奏"先出设计再决定"，采用绞杀者(strangler-fig)迁移 | 全程可用、每步可回退；快慢由用户定 |
| D4 | **群时间线不实时显示成员逐字内容**，只显示进度数字（"已生成 N 字"） | 房间账永不重复存流式文本，串台/重复/丢字从设计上不可能发生 |
| D5 | 产物共享 = 下游成员自动读到上游产物**文件**（非引用/嵌入） | `artifact.produced` 只需记产出者/路径/所属会话；下游可读由后端派活顺序保证 |
| D6 | 前端自己拥有消息状态，**弃用 AI SDK `useChat` 当事实源** | 消灭第二事实来源 |
| D7 | **LangChain 解析整体搬到后端**，后端直接产出标准账本行 | 前端不再碰 LangChain 数据格式（方案 A 红利） |
| D8 | 算账器用**纯函数 reducer + Zustand 仓库**（按 scope） | 核心逻辑脱离 React，最易测、最易扩展 |

---

## 3. 核心模型：流水账

### 3.1 统一信封

账本中每一行（事件）都带固定信封，前端处理完全一致：

| 字段 | 含义 | 例 |
|------|------|----|
| `seq` | 编号（同一本账内单调递增，持久化于 DB） | 7 |
| `ts` | 发生时间 | 2026-06-05T10:00:00Z |
| `scope` | 记在哪本账 | `conversation:123` / `room:45` |
| `source` | 谁产生 | 用户 / AI成员"小销" / 系统 / 群主 |
| `type` | 事件类型 | `text.delta` |
| `payload` | 具体内容 | `{ text: "查询..." }` |

前端渲染只认 `type`；加功能 = 加一种 `type`，永不动信封与地基。

### 3.1.1 seq 连续性不变量（地基假设，不可违反）

取流器去重与缺号检测、算账器投影，全部建立在以下不变量之上，实现期必须严格遵守：

1. **同一本账内 `seq` 严格 +1 连续，无空洞、无跳号。** 这是"缺号即丢行"判定的唯一依据：前端持有到 #87，收到 #89 即可确定性判定缺 #88 → 触发"从 #87 之后补发"重订。若允许跳号，整套去重/补取逻辑失效，**故不允许任何形式的跳号**（包括被服务端过滤的事件——任何入账事件都必须占据连续编号）。
2. **未识别的事件类型仍占据 `seq`、仍参与连续性校验。** 前端按 `type` 路由渲染，遇未知 `type` 跳过渲染但**保留其 seq 占位**，不得因"跳过未知事件"在本地制造空洞而误判缺号（与 7.2"未知事件跳过不崩"协同）。
3. **心跳不占编号。** 心跳用 SSE 注释行（`:keepalive`）实现，不是带 `seq` 的事件行，不消耗编号空间、不入账。
4. **snapshot 携带其覆盖到的最高 `seq`**（如"截止 #500"）；前端应用 snapshot 后，后续增量从 #501 起严格续接，跨 snapshot 边界亦无空洞。

### 3.2 事件类型清单

**A 组 · 一轮对话（单聊即够用）**
- `message.appended` — 一条完整消息落账（用户消息 / 系统消息）。**所有内容先进账，再读账显示**，不存在"只在前端内存里的消息"。
- `turn.started` — AI 开始回复，新建助手消息占位
- `text.delta` — AI 增量打字（逐字直播是一串此事件）
- `tool.invoked` — AI 调用工具（显示工具块）
- `tool.result` — 工具返回结果
- `turn.completed` / `turn.failed` / `turn.cancelled` — 本轮终态（三选一）

**B 组 · 人工审批（HITL）**
- `hitl.requested` — AI 卡住等批准，带等待中的工具调用标识
- `hitl.resolved` — 用户批准/拒绝

**C 组 · 群协同**
- `room.created` — 群房间建立
- `plan.generated` — 群主拆解任务（生成 DAG/流程图）
- `member.dispatched` — 群主给某成员派活（成员开子会话）
- `member.state_changed` — 成员状态变更（排队 queued / 运行 running / 让出槽位等待 sleeping / 完成 done / 失败 failed），运行时携带进度字数 `char_count`。`sleeping` = 成员已就绪但主动让出并发槽位、等待上游产物或排程（对应现有后端语义，保留）

**D 组 · 产物共享**
- `artifact.produced` — 成员产出产物，记 `{ producer, path, conversation_id }`
- `artifact.updated`（可选）— 产物被覆盖时记一版，为日后版本追踪留口

**关键观察：群主"协调与汇报"无需任何新机制。** 协调 = 群主自己的一轮对话(A 组) + `member.dispatched`；汇报 = 群主读完产物后再做一轮普通对话(A 组)，只是记在房间账、`source` 标为群主。群主汇报对地基而言就是"群主在房间账里打了一段字"，与单聊打字同一套代码。

### 3.3 事件 payload 字段（契约草案）

迁移路径第 1 步"定契约"以此为准。下为 TypeScript 接口草案，前后端据此对齐字段（实现期可微调字段名，但形状须冻结）。所有事件外层均带 §3.1 信封字段，下方仅列 `payload`。

```ts
// —— A 组：一轮对话 ——
interface MessageAppendedPayload {
  message_id: string          // 该消息的稳定 id（用户/系统消息）
  role: "user" | "system"
  parts: MessagePart[]        // 复用现有 UIMessage parts 结构
  client_token?: string       // 乐观回显匹配键：若由本端发出则回显，见 §5.2④
}
interface TurnStartedPayload {
  message_id: string          // 本轮助手消息的占位 id；后续 text.delta/tool.* 均归属它
  role: "assistant"
  member_id?: number          // 群房间账中标明是哪个成员/群主的轮（source 的细化）
}
interface TextDeltaPayload {
  message_id: string          // 归属哪条助手占位消息（多成员交错时据此归位）
  text: string                // 增量文本
  acc?: number                // 后端权威累计字数（进度用）
}
interface ToolInvokedPayload {
  message_id: string
  tool_call_id: string
  tool_name: string
  args: unknown
}
interface ToolResultPayload {
  message_id: string
  tool_call_id: string        // 关联对应 tool.invoked
  result: unknown
  status: "ok" | "error"
}
interface TurnTerminalPayload { // turn.completed | turn.failed | turn.cancelled
  message_id: string
  reason?: string              // failed 时填写，如 "timeout"
}

// —— B 组：HITL ——
interface HitlRequestedPayload {
  request_id: string           // POST /hitl/resolve 用此回传，见 §5.2③
  message_id: string           // 中断发生在哪条助手消息
  tool_call_id: string         // 等待批准的工具调用
  preview?: unknown            // 展示给用户的待批准内容
}
interface HitlResolvedPayload {
  request_id: string
  decision: "approve" | "reject"
}

// —— C 组：群协同 ——
interface RoomCreatedPayload { room_id: number; leader_member_id: number }
interface PlanGeneratedPayload { dag: DagSnapshot }   // 复用现有 GroupRoomDag 结构
interface MemberDispatchedPayload {
  room_id: number
  member_id: number
  conversation_id: number       // 该成员执行所用子会话
  available_artifacts: string[] // 派活时注入的上游可用产物路径（D5）
}
interface MemberStateChangedPayload {
  room_id: number
  member_id: number
  state: "queued" | "running" | "sleeping" | "done" | "failed"
  char_count?: number           // running 时的进度字数；后端按 0.5~1s 合并节流，见 §9.5
}

// —— D 组：产物 ——
interface ArtifactProducedPayload {
  producer_member_id: number
  conversation_id: number       // 产出所属子会话
  path: string                  // 房间共享目录内路径
  name: string
  mime?: string
}
interface ArtifactUpdatedPayload extends ArtifactProducedPayload {
  version: number               // 预留，本期不实现完整版本树
}
```

> 关键归位规则：A 组中除 `message.appended` 外，`turn.*` / `text.delta` / `tool.*` 全部携带 `message_id`，算账器据此把增量挂到正确的助手占位消息上——这是群房间内多成员/群主交错时不串台的字段级保证，与 D4 的"逐字只进成员会话账"双重兜底。

---

## 4. 单聊 / 群聊统一模型

### 4.1 两种账

- **会话账**：一对一对话一本账。群里每个成员干活也是开子会话，各有自己的会话账。
- **房间账**：群聊多出的"协调账"，只记协同层面：`plan.generated` / `member.dispatched` / `member.state_changed` / `artifact.produced` / 群主汇报（群主在房间账里的对话轮）。**房间账不重复抄成员的逐字过程**（D4）；逐字过程在成员各自的会话账里。

### 4.2 订阅（同一机制，不同 scope）

- 打开单聊 → 订一本会话账 → 从头读算出消息列表。
- 打开群聊 → 订房间账 → 算出群时间线（流程图 + 成员里程碑 + 群主汇报）。
- 在群里点开某成员看细节 → 再订该成员会话账，与单聊完全一致。

同一个"读账算画面"的 reducer，喂不同的账，即得单聊或群聊界面。无第二套机制。

> reducer（通俗）：纯函数，`(当前画面, 新的一行) → 新画面`；从头把账过一遍即得完整画面。

### 4.3 产物自动共享流程

1. 成员A 完成 → 后端将产物文件写入**房间共享目录**，并记一行 `artifact.produced{producer:A, path:report.html}`。
2. 群主派活给下游成员B（`member.dispatched`）时，后端把"现有可用产物路径清单"塞进B的上下文。
3. B 的 Agent 直接读文件。前端无需缝合，只把 `artifact.produced` 显示成可预览的产物卡片。

下游能否读到上游产物由**后端派活顺序（DAG 拓扑）保证**，前端不再猜"上游产物到位没"。

---

## 5. 传输与断线恢复

### 5.1 利用 SSE 原生能力

SSE 每条推送可带 `id`（填 `seq`）。连接断开时浏览器**自动重连**并**自动携带"最后收到的 id"**。因此"断线从上次编号续传"无需自写重连逻辑，今日 `/stream/resume` + 重试计数 + 退避 + `resumeScheduleRef` 全部移除。

### 5.2 协议

**① 订阅一本账**
```
GET /stream?scope=conversation:123&from=<本地最新编号>
```
后端：先补发缺失行（如本地到 #50 则从 #51 起），再保持连接实时推送；每条带 `id: <seq>`。

**② 断线**
浏览器自动重连并带"已收到 #87"。后端从 #88 续发。前端铁律：只认编号比当前大的行，重复行丢弃。断线/重连/重复三种情况一条规则全覆盖。

**③ 发消息 / 批准审批 = 普通 POST，不碰流**
```
POST /conversation/123/message       { text, idempotency_key }
POST /conversation/123/hitl/resolve  { decision, request_id, idempotency_key }
```
结果顺着已开着的流以新行回来。前端不自管"发完流怎么变"，继续读账即可。

**④ 乐观回显（全系统唯一一处"对号"）**
点发送时：
1. 前端生成 `client_token`（一次性唯一标记，复用为 POST 的 `idempotency_key`），本地先插入一条"临时用户消息"（带该 token、无正式 seq）。
2. POST 携带该 `client_token` 发往后端。
3. 后端落账时，把该 token 原样写入 `message.appended.payload.client_token` 回显（见 §3.3）。
4. 该 `message.appended` 顺流回来时，算账器**按 `client_token` 精确匹配**本地临时消息并替换为正式行（赋予正式 seq）。无匹配则当作新消息追加（如另一窗口发的）。

靠明确 token 匹配，非启发式；这是全系统唯一需要"对号"之处。

### 5.3 存档照片（snapshot）

长会话每次从 #1 重放过慢。后端提供 snapshot：「截止 #500 的完整画面 + 从 #501 起的新行」。

- **取代当前 `GET /messages`**——它不再是"另一个要对账的数据源"，而是"账本的一张照片 + 增量"，本质同一本账。
- 前端把最近一张照片连同编号缓存本地，下次打开瞬间显示旧画面再追新，切会话不白屏、不丢直播。

### 5.4 群聊同协议

`GET /stream?scope=room:45&from=...`，协议一致。点进成员再开 `scope=conversation:子会话`。无第二套传输代码。成员"已生成 N 字"由后端在房间账周期推送 `member.state_changed{char_count}`，仅一个数字，绝不串台。

---

## 6. 前端骨架

### 6.1 五个零件

```
        后端一条 SSE 流（带编号的行）
                  │
   ① event-stream（取流器）  订流 / 按编号补发 / 丢重复
                  │ 干净的事件
   ② session-reducer（算账器）纯函数：旧画面 + 新行 → 新画面
                  │ 派生画面(消息/流状态/HITL/DAG/产物)
   ③ session-store（按 scope 的账本仓库, Zustand）
                  │
   ④ useSession(scope)（Hook）组件唯一入口，返回画面去渲染

   ⑤ actions: sendMessage / resolveHitl —— 普通 POST，独立
```

- **① 取流器**：唯一管 SSE 处。订流、按编号续传、去重。
- **② 算账器**：系统最核心、最好测的纯函数 `(画面, 行) → 画面`。无副作用、不碰网络/React。
- **③ 账本仓库**：Zustand 按 `scope` 存每本账画面（`conversation:123`、`room:45` 各一份），精准订阅避免无关重渲染。
- **④ `useSession(scope)`**：组件唯一入口。单聊 `useSession("conversation:123")`，群聊 `useSession("room:45")`，返回 `{ messages, streamStatus, activeHitl, dag, members, artifacts }`。一人取代 `use-conversation-session` + `use-group-room`。
- **⑤ 动作函数**：发消息/批准审批，普通 POST，结果顺流回来。

### 6.2 文件去留

| 处理 | 文件 | 原因 |
|------|------|------|
| 🆕 | `lib/session/event-stream.ts` | 取流器 |
| 🆕 | `lib/session/session-reducer.ts` | 算账器（纯函数核心） |
| 🆕 | `lib/session/session-store.ts` | 按 scope 的账本仓库 |
| 🆕 | `lib/session/snapshot-cache.ts` | 存档照片本地缓存 |
| 🆕 | `hooks/use-session.ts` | 统一会话 Hook |
| 🆕 | `types/session-event.ts` | 事件清单类型定义 |
| ❌ | `hooks/use-conversation-session.ts` | 对账地狱，被 useSession 取代 |
| ❌ | `hooks/use-group-room.ts` | 群聊旁路，并入 useSession |
| ❌ | `lib/chat/session/*`（machine/hydrate/resume/terminal/seed） | 状态机+对账不再需要 |
| ❌ | `lib/chat/pick-message-display-source.ts` | 启发式对账消失 |
| ❌ | `lib/chat/conversation-runtime-bus.ts` | 事件总线被 SSE 流取代 |
| ❌ | `lib/chat/message-query-cache.ts` | 不再把 RQ 缓存当事实源 |
| ❌ | `api/langchain-chat-transport.ts` | LangChain 解析搬到后端 |
| 🔧 | 消息渲染 / 群流程图 / 产物弹窗等组件 | 改为读 `useSession` 画面，纯展示 |
| 🔧 | `stores/chat-store.ts` | 瘦身，只留"选了哪个会话/导航"等 UI 选择状态 |
| ✅ | 消息气泡、message-blocks、`group-sop-panel`、产物弹窗、`group-avatar-utils` | 展示组件保留，喂新数据即可 |
| ✅ | React Query | 继续管联系人/会话列表、房间元信息等非流式数据 |

> 删掉的全是"缝合层"，保留的全是"展示层"，中间换上纯函数算账器 + 一条流。

---

## 7. 异常与边界

### 7.1 三条贯穿全局的铁律

1. **编号只认大的**：来的行编号 ≤ 已有的直接丢（去重）。
2. **缺号就重取**：有到 #87 却来 #90（缺 #88/#89）→ 立刻按"从 #87 之后补发"重订，绝不带窟窿渲染。
3. **动作带幂等键**：发消息、批准审批的 POST 带客户端生成的唯一标记，后端识别已处理则忽略。

### 7.2 情况处理表

| 情况 | 处理 |
|------|------|
| 临时断网/切后台 | 浏览器自动重连续传；UI 顶部"重连中"小条，连上自动消失；铁律1+2 保证不重不漏 |
| 后端重启 | 编号持久化于 DB，重启后接续；前端续传照常 |
| 发消息时断网 | POST 失败自动重试（带幂等键）；"成功但回包丢"由后端幂等去重；彻底失败提示重试 |
| 批准审批时断网 | 审批 POST 幂等，重复请求只认一次 |
| 任务跑太久/卡死 | 后端超时追加 `turn.failed{reason:timeout}` 行，前端正常显示；流上心跳让前端感知后端存活 |
| 同一会话多窗口/多设备 | 各自订同一本账，收到同样行自然一致；无本地独占真相 |
| 群内成员失败/崩溃 | 成员账 `turn.failed` + 房间账 `member.state_changed{failed}`，时间线显示失败，前端不卡 |
| 未知新事件类型 | 算账器跳过不崩，向后兼容，利于后端先上、前端后更 |
| 快照与本地缓存不一致 | 一切按编号对齐，编号大者为准，无歧义 |
| 登录过期(401) | 走现有"清登录、跳登录窗"流程，不动 |

### 7.3 深挖场景 A：离线很久回来

太旧就别补行：订流时前端报"我有到 #450"，后端发现"最新照片已在 #2950，你比照片旧" → **直接甩 #2950 全景照片 + 从 #2951 续推**，前端整体替换本地画面。补量恒有上限（最近一张照片到现在），与离线时长无关。离开时还在直播的回复，回来时照片已是终态，不会卡转圈。会话列表照常由 RQ 重拉。

### 7.4 深挖场景 B：群里十几个成员同时跑

- **房间流压力不随人数涨**（D4 红利）：房间流只搬里程碑 + 进度数字，逐字内容在各成员自己账里，不点进去不传。
- **进度数字合并节流**：后端把 `member.state_changed{char_count}` 每 0.5～1 秒合并发一次，十几个成员也每秒几十条封顶。
- **并发上限由后端槽位阀门管**（现有机制保留）：真正在跑的就那几个，其余 `member.state_changed{queued}` 排队；流程图如实画"几个绿灯转、其余灰灯排队"，全是普通行。
- **界面只重画变化节点**：Zustand 精准订阅，成员7 变了只重画成员7 节点。
- **盯单个成员看逐字**才开那一路流，退出即关；客户端任意时刻最多 1～2 路逐字流。

人数涨，涨的是各成员自己账里的内容，房间协调流基本不变——这是可扩展性的体现。

---

## 8. 测试策略

最该测的恰好最好测：

- **算账器（reducer）= 纯函数**：喂一串行、断言画面。把历史踩坑全变测试用例：
  - 流结束显示完成态：`turn.started → text.delta → turn.completed` ⇒ 完整且非 streaming
  - 重复去重：两遍 #88 ⇒ 只出现一次
  - 缺号拒绝：#87 后直接 #90 ⇒ 触发重取、不带窟窿渲染
  - 群聊不串台：两 source 交错行 ⇒ 各归各
  - 未知事件：未知 type ⇒ 安全忽略
- **取流器**：假流喂数据，测断线重连、续传、去重。
- **动作函数**：测幂等键、失败重试。
- **端到端少量**：覆盖"发消息→看到回复→断网→恢复"。

对比今日：ref + effect + 对账逻辑强依赖 React 渲染时序、几乎无法单测；新架构把核心逻辑抽成纯函数，测试成本与信心皆质变。

---

## 9. 后端要求（因后端可改）

1. **`seq` 持久化**（存 DB），保证重启、补发连续单调。
2. **提供 `from=` 续发能力** + **snapshot 端点**（截止某编号的全景 + 增量）。
3. **认幂等键**：同一 `message` / `hitl.resolve` 重复请求只处理一次。去重下界以**会话生命周期**为准（长群任务可能超 24h，不能因清理过早导致乐观消息对不上号）；过期清理仅针对已落账消息的"键→结果"映射，默认保留 ≥7 天，实现期可调。`message.appended` 须回显该键为 `client_token`（§3.3 / §5.2④）。
4. **流上心跳用 SSE 注释行**（`:keepalive`，每 ~15 秒），**不带 `seq`、不入账、不占编号**（§3.1.1 第 3 条），仅供前端区分"活着 vs 真断"。
5. **进度合并节流**：`member.state_changed{char_count}` 服务端按 0.5～1 秒合并。
6. **seq 严格 +1 连续**（§3.1.1）：任何入账事件占连续编号，被过滤/未知事件亦不得制造空洞；snapshot 须携带其覆盖到的最高 seq。
7. **LangChain → 标准账本行的翻译在后端完成**（D7）。
8. （预防）SSE 响应加关缓冲头（`X-Accel-Buffering: no` 等），将来上反向代理不踩坑。

---

## 10. 迁移路径（绞杀者模式，每步可独立验证 / 回退）

1. **定契约**：第 3 节事件清单 + 第 5 节协议，前后端一起敲定。
2. **后端先长出账本**：先让单聊按新协议产出账本行 + 订流/快照端点；老接口并存。
3. **前端搭新骨架**：建五个零件，先只接单聊；用 feature flag 让新旧并存，内部先跑新的，验证流恢复/HITL/长任务。
4. **单聊切换 + 删老代码**：稳后删 `use-conversation-session` 对账地狱。
5. **群聊接上**：后端补房间账，前端群聊改 `useSession("room:...")`，删 `use-group-room` 旁路。
6. **收尾**：删 LangChain 前端解析、瘦身 chat-store、补全测试。

落地快慢由用户定：求稳逐步发版；求快在分支一口气推到第 5 步。

---

## 11. 范围之外 / 待定

- **产物版本控制**：`artifact.updated` 预留，本期不实现完整版本树。
- **成员间直接对话 / 产物审批 / 群主中途叫停成员**：地基已支持（皆为新增行类型），本期不做，留作后续扩展验证点。
- **多端实时协同的乐观锁**：当前模型天然容忍多端（无本地独占真相），暂不引入额外冲突解决。
- **SSE vs WebSocket**：本设计选 SSE（契合现有栈 + 原生续传）；若未来需双向低延迟可再评估，不影响账本模型。

---

## 附：与现状的对应关系（便于实现期对照）

| 现状 | 新架构 |
|------|--------|
| `GET /messages`（数据库权威） | snapshot 端点（账本照片+增量），不再是独立对账源 |
| `/text2sql/stream` SSE | `GET /stream?scope=...&from=...` 统一订流 |
| `/stream/resume` + 重试/退避 | 浏览器原生 Last-Event-ID 续传，移除 |
| workspace 事件总线（`room_message` 等） | 并入统一订流，作为账本行 |
| AI SDK `useChat` 的 `composerMessages` | 自有账本仓库，弃用 useChat 当事实源 |
| `use-conversation-session` 对账 + ref | `session-reducer` 纯函数投影 |
| `use-group-room` 旁路 streaming map | `useSession("room:...")` 同一套 |
