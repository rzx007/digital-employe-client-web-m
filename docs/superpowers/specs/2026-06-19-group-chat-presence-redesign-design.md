# 群聊体验重构：成员即群参与者（借鉴 HiClaw 模型）

> 日期：2026-06-19
> 状态：设计待评审
> 关联记忆：[[group-plan-card-vs-dag-mismatch]]、[[group-dag-anchors-wrong-plan]]、[[group-chat-first-response-blank-window]]、[[group-streaming-polish-and-autoconfirm]]

## 1. 背景与问题

当前群协作视图是「聊天 pane（左）+ 状态仪表盘（右）」结构：左侧复用 1:1 会话时间线，右侧是常驻 320px 的 DAG 流程图（`GroupSopPanel`）或扁平成员列表（`GroupMemberSidebar`）。

体验问题（用户原话「没什么质感」）的根因**不是配色/圆角，而是结构本身**：

- 成员只是右栏一行状态（待命/进行中），没有「存在感」；
- 协作被劈成两半——左聊天、右仪表盘，割裂；
- 组长发言和 1:1 助手用同一种气泡，没有「协调者」的身份；
- 员工干活过程只在私聊里，群里只在终态出现一条结论。

对照 HiClaw（`D:/doc/code/ai/hermes-agent/HiClaw`）的 Agent Teams 模型：每个 agent 是 Matrix 房间里**真实的群成员**，有自己的身份/头像/名字；Leader 和 Worker 在**同一条时间线**里 @ 来 @ 去、汇报进展；架构文档原话：*assignments, progress, and interventions share the same timeline*。HiClaw 没有华丽前端可抄（其前端就是标准 Matrix 客户端 Element Web）——它的「质感」来自**心智模型**，不是像素。

**本设计采用该心智模型**：把群重构成「一个真实的协作群聊」，成员是会发言的群参与者，协作发生在对话里。

## 2. 目标与非目标

### 目标
- 时间线成为协作主视图；组长、员工都是时间线里有身份的发言者。
- 组长 = 有辨识度的「群主/协调者」气泡；员工发言朴素（头像 + 名字）。
- 员工**里程碑级**汇报进群：接活 / 开工 / 关键进展 / 交付 / 失败。
- 里程碑信号来自**现有硬信号**：派发成功、流终态、deepagents `write_todos` 状态跃迁。不要求模型额外表演。
- 右栏 DAG 默认收起，顶部换成轻量「队员在场」条 + 按需展开鸟瞰抽屉。

### 非目标（YAGNI）
- **不**改群协作的后端机制：一会话=一线程=一流=一隔离上下文（I1–I4）不动；投影仍是「隔离会话之上的编排+投影」（路线 A）。
- **不**做逐 token 的员工过程流进群（已评估为刷屏风险，明确排除）。
- **不**新增「员工主动报告」工具（明确选用硬信号路径，不依赖提示调教）。
- **不**并入澄清卡片机制：员工提问/澄清仍走现有独立卡片（`clarifying-questions-dock`）+ 群澄清投影，**不**变成一种 milestone kind。
- **不**改右栏 DAG 自身的取数/聚合逻辑（已在近期修复，见关联记忆）；只改它的容器（常驻栏 → 抽屉）。

## 3. 架构：两条腿

切成两条可并行开发的腿，接口清晰。

### 3.1 后端：里程碑投影（新增）

**职责单一**：在员工私有流的事件管道里，把硬信号翻译成「群里程碑消息」，经现有投影通道（`_project_*` + `WorkspaceEventBus` 的 `room_message` / `room_message_stream`）投出。

文件：`apps/server/src/service/group_room_service.py`（及员工流事件管道挂载点，写实现时定位）。

四个里程碑来源：

1. **接活（accepted）**：`dispatch_to_member` 派发成功后，投一条 milestone（"收到，开始处理 X"）。来源：现有派发路径，硬信号。
2. **关键进展（progress）**：在员工流事件管道挂一个**轻量拦截器**，监听 `write_todos` 工具调用，diff 前后 todo 列表；检测到某 todo `in_progress→completed`，投一条 milestone（"已完成 X，开始 Y"）。
   - 这是全 spec **唯一的新拦截点**，也是唯一有定位不确定性的地方：deepagents 的 `write_todos` 状态变化经通用 tool-call 事件流透传（后端 `src/service` 现无现成 todo 钩子，仅 prompts/AGENTS.md 提及）。实现时需定位员工流事件管道中能观察到 tool-call 的最干净挂载点（候选：`stream_registry` 的 relay/finalize 路径，或 agent 流的事件回调）。若定位成本过高，progress 里程碑可降级为「仅接活+交付」并在 spec 评审后另议——但 accepted/delivered/failed 必出。
3. **交付 / 失败 / 取消（delivered/failed/cancelled）**：复用现有 `_project_member_conclusion`（`group_room_service.py:681`），泛化为 `_project_member_milestone`，输出统一带 `kind`。
4. **去抖/防刷屏**：新增小工具——同一员工同一会话的里程碑投影，最小间隔（如 3s）+ 文本去重，避免 todo 抖动刷屏。

**不变量**：投影只读员工流、单向写群时间线；不改员工流本身。

### 3.2 前端：时间线身份感 + 右栏降级

文件：`apps/web/src/components/chat/`（group/、message-blocks/、messages/）。

- **消息身份渲染**：在消息渲染层按 `metadata.role` + `metadata.milestone` 分派三种身份样式：你（用户）/ 组长（特殊气泡）/ 员工（朴素带头像）。员工配色复用现有 `colorOf` 名字哈希。
- **里程碑消息块**（新 `MemberMilestoneBlock`）：头像 + 名字 + kind 图标 + 里程碑文案 + 可点产物 chip。它是「汇报」，不是长文气泡。
- **组长气泡**（新/改 `LeaderBubble`）：组长专属样式（头像 + 「组长」标识 + 现有流式光标/「正在生成 N 字」）。
- **右栏降级**：`GroupRoomView` 去掉常驻 320px 右栏；时间线上方放一条 `GroupPresenceBar`（头像叠加 + N 进行中计数），点击展开 DAG 鸟瞰抽屉（现有 `GroupSopPanel` 原样移入抽屉/Sheet，逻辑不动）。

**数据流**：`useGroupRoom`（`apps/web/src/hooks/use-group-room.ts`）已把 `room_message_stream` 转成带 `senderId/senderLabel/sourceConversationId` 的临时消息——前端拿到的数据基本够用，主要改渲染层 + 对接后端新增的 `role`/`milestone` 字段。

## 4. 数据契约（前后端共识）

群消息（`room_message` / `room_message_stream`）的 metadata：

```
{
  senderId:    number | null      // 员工 employee_id；组长/系统为 null
  senderLabel: string             // "组长" | 员工名 | "用户"
  role:        "user" | "leader" | "worker"   // 新增：前端据此选身份样式
  milestone?: {                   // 新增：有则渲染里程碑块，无则普通气泡
    kind: "accepted" | "progress" | "delivered" | "failed" | "cancelled"
    text: string                  // "收到，开始处理X" / "已完成资料检索，开始起草"
    artifacts?: string[]          // 可点开的产物路径（复用 openResource）
  }
}
```

**判定规则**：
- `role` 决定气泡身份样式（组长特殊 / 员工朴素 / 用户）。
- `milestone` 存在 → 渲染 `MemberMilestoneBlock`；不存在 → 普通发言气泡。
- 组长的统筹发言是普通气泡（无 milestone）；员工的接活/进展/交付是里程碑块。
- 澄清仍走独立卡片，**不**经此契约。

## 5. 组件边界（各自单一职责）

### 前端
| 组件 | 职责 | 依赖 |
|---|---|---|
| `MemberMilestoneBlock`（新） | 渲染一条里程碑：头像+名字+kind 图标+文案+产物 chip | `colorOf`, `openResource` |
| `LeaderBubble`（新/改） | 组长专属气泡样式（头像+「组长」标识+流式光标） | 现有流式逻辑 |
| `block-render-map`（改） | 按 `role`+`milestone` 分派到上述渲染器 | — |
| `GroupPresenceBar`（新） | 头像叠加 + N 进行中，点击开 DAG 抽屉 | `members` |
| `GroupRoomView`（改） | 去常驻右栏，挂 `GroupPresenceBar` + DAG 抽屉 | 上述 + `GroupSopPanel` |

### 后端
| 单元 | 职责 |
|---|---|
| `_project_member_milestone`（新，泛化自 `_project_member_conclusion`） | 统一投影入口，输出带 `kind` |
| todo 拦截器（新） | 员工流管道 diff `write_todos`，`in_progress→completed` 跃迁 → 投 `progress` 里程碑 |
| 里程碑去抖器（新，小工具） | 同员工同会话最小间隔 + 文本去重 |

## 6. 错误处理与边界

- **进展信号缺失**：员工 agent 没用 `write_todos`（直接干活）时，progress 里程碑自然不出现——群里只见 accepted + delivered，可接受（不报错、不补假进展）。
- **投影竞态**：里程碑投影沿用现有 `WorkspaceEventBus` 推送 + 落库路径，断流重连补拉 DB 已有机制（见 [[orchestrator-silent-stall-diagnosis]]），里程碑作为普通 room_message 落库即可被补拉。
- **去抖丢信号**：去抖只合并「同一员工短时间多条同类 progress」，accepted/delivered/failed 不参与去抖（保证必出）。
- **DAG 抽屉与时间线状态一致性**：抽屉里的 DAG 仍是后端权威态（单一事实源原则，见 [[group-plan-card-vs-dag-mismatch]]）；时间线里程碑是「领先回补」的对话投影，二者不互相计算进度，避免再现左右打架。

## 7. 测试策略

### 后端
- `dispatch_to_member` 成功 → 群时间线出现 accepted 里程碑（带 sender_id/label）。
- 员工流中 `write_todos` 某项 `in_progress→completed` → 出现 progress 里程碑。
- 短时间多次 todo 跃迁 → 去抖后只投有限条。
- 员工流 done/failed/cancelled → delivered/failed/cancelled 里程碑（复用现有 `_project_member_conclusion` 测试，改断言带 kind）。
- accepted/delivered 不被去抖吞掉。

### 前端
- `role==="leader"` 无 milestone → 渲染组长气泡；`role==="worker"` 带 milestone → 渲染 `MemberMilestoneBlock`。
- `GroupRoomView` 默认不渲染常驻右栏；渲染 `GroupPresenceBar`；点击展开 DAG 抽屉。
- 里程碑块产物 chip 点击 → 调 `openResource`。

## 8. 分阶段（建议实现顺序）

两条腿可并行，但建议：
1. **后端先出 accepted + delivered（复用现有，泛化 kind）+ 数据契约**——前端有真实数据可对接。
2. **前端身份渲染 + 里程碑块 + 右栏降级**——可先用 accepted/delivered 真实数据验证。
3. **后端 progress（todo 拦截器 + 去抖）**——最不确定的一块，独立验证。
4. 联调 + 测试。
