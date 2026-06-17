# 执行卡片「工具足迹」（事后、可折叠）— 设计 spec

- 日期：2026-06-17
- 分支：feat/orchestrator-centric
- 关联：[2026-06-16-orchestrator-swarm-leader-experience-design.md](2026-06-16-orchestrator-swarm-leader-experience-design.md)（员工任务面板/执行卡片）

## 1. 背景与目标

总管中心化后，员工任务在卡片/面板上只显示状态 + 结果摘要 + 心跳「可能卡死」（最轻档进度）。用户想看见员工**到底干了什么**（调了哪些工具），像 Claude Code 在消息流里的 `used N tools ›` 折叠行。

**关键事实（探查确认）**：
- 工具调用渲染组件**已现成**：`ToolGroupBlock`（`apps/web/src/components/chat/message-blocks/tool-group-block.tsx`，吃 classifier 产出的 `tool-group` block）。
- 执行卡片 `execution-report-card` **本就内嵌在总管消息流里**。
- 员工每条消息的工具调用已**结构化存储**在 `ConversationMessage.message_parts`（JSON，前端可直接渲染的 parts，工具 part 形如 `{type: "tool-<name>", state, input, output}`）。
- 故"消息流内嵌的 Claude-Code 式工具展示"**渲染部分几乎免费**——贵的是"实时"，本期**不做实时**，只做**事后足迹**。

### 目标
- 执行卡片上一个**默认折叠**的「🔧 工具足迹」，点开懒加载该执行所属员工会话的工具调用列表，复用现成渲染组件展示。
- **零碰流式热循环**（纯只读、事后提取已存数据）。

### 非目标
- **不**做实时"当前在调什么工具/第几步"（要碰流式热循环，留作后续档）。
- **不**改员工流、不动 message_parts 的生成。
- **不**做精确到"单次执行"的足迹（同会话续聊返工时取会话级，见 §3.3）。

## 2. 架构

```
执行卡片(总管流内嵌) ──点开折叠条──▶ 懒加载 GET .../executions/{log_id}/tool-footprint
                                          │
后端：据 log.conversation_id 取该员工会话 assistant 消息的 message_parts
      → 过滤 type 以 "tool-" 开头的 part → 返回工具 parts 列表
                                          │
前端：parts → 现有 message-classifier → tool-group block → ToolGroupBlock 渲染
      （classifier/ToolGroupBlock 不便直接喂时，退用紧凑「工具名 + 状态」行列表）
```

## 3. 设计

### 3.1 后端：足迹端点
新增只读端点（task_api.py，仿现有 executions 端点风格）：
`GET /workspaces/{workspace_id}/tasks/executions/{task_execution_log_id}/tool-footprint`
→ `ResponseBase[ToolFootprintRead]`，其中 `ToolFootprintRead = { tool_count: int, parts: list[dict] }`：
1. 校验 workspace + 取 `TaskExecutionLog`（不存在/跨 workspace → 404）。
2. `conversation_id = log.conversation_id`；若为 None → 返回空足迹 `{tool_count: 0, parts: []}`。
3. 取该会话 `role == "assistant"` 的 `ConversationMessage`（按 id 升序），逐条 `json.loads(message_parts or "[]")`，收集 `part["type"]` 以 `"tool-"` 开头的 part。
4. 返回 `{tool_count: len(parts), parts: parts}`（parts 原样透传，前端复用 classifier 渲染）。
- 提取逻辑封装成 helper（如 `extract_tool_parts_for_conversation(db, conversation_id) -> list[dict]`），便于单测。

### 3.2 前端：卡片折叠足迹
`execution-report-card.tsx`：
- 加一个折叠条「🔧 工具足迹 (N) ›」/「🔧 工具足迹」（N 未知时不显数字，点开后显）。**默认折叠**。
- 展开时**懒加载**端点（`useToolFootprint(logId, { enabled: expanded })` —— TanStack Query，`enabled` 受展开态控制，只在首次展开取一次、缓存）。
- 加载中显示 spinner；加载完：
  - 优先：`parts` → 现有 `message-classifier`（`apps/web/src/lib/chat/message-classifier.ts`）分类出 `tool-group` block → `ToolGroupBlock` 渲染（Claude-Code 观感）。
  - 退路：若 classifier 输入形态不便直接喂，渲染紧凑列表：每个 part 一行「<toolName> · <success/error>」。
- 无工具（tool_count==0）→ 不显示足迹条（或显示「无工具调用」一行）。

### 3.3 取舍
- **懒加载**：点开才取，避免面板每 10s 轮询为每条执行解析整会话 message_parts；与"折叠默认"UX 契合。
- **会话级足迹**：同会话续聊返工时，message_parts 含多次尝试的工具——MVP 取会话级（展示该员工这条会话干的所有事）。无返工时与单次执行一致。精确到单次执行（按 log.started_at..ended_at 过滤消息时间）留作可选增强，本期不做。
- **复用优先**：先试复用 message-classifier + ToolGroupBlock；不便则紧凑列表退路（实现期二选一，spec 不强绑）。

## 4. 改动面（后端只读 + 前端展示）
- 后端：`schemas/task.py` 加 `ToolFootprintRead`；`api/task_api.py` 加端点；提取 helper（task_service 或 task_api 内）。
- 前端：`types/schedule-monitor.ts` 加足迹类型；`hooks/use-schedule-monitor-queries.ts` 加 `useToolFootprint`；`execution-report-card.tsx` 加折叠足迹区。
- 无新列、无迁移、不碰流式。

## 5. 测试策略
- **后端**：`extract_tool_parts_for_conversation` —— 多条 assistant 消息含混合 parts（text + tool-*）→ 只收集 tool-* part、顺序保留；conversation_id None / 无 assistant 消息 → 空；端点 404（log 不存在/跨 workspace）。
- **前端**：typecheck 90 基线、vitest 基线不破；card 折叠态切换 + 懒加载 enabled 逻辑（若有对应测试层）。
- **基线**：后端 5 failed/+本特性测试，零新增；前端 typecheck 90 / vitest 基线。

## 6. 风险
- **message_parts 形态依赖**：工具 part 的 `type` 前缀约定（`"tool-"`）来自 message_parts_extractor 的产出——实现期核对真实 part 形态（探查所见：`{type:"tool-<name>", state, input, output}`），helper 以 `type.startswith("tool-")` 提取，稳健。
- **classifier 复用边界**：message-classifier 可能期望"整条消息的 parts"而非"跨消息聚合的 tool parts"——若直接喂跨消息聚合的 tool parts 行为异常，用紧凑列表退路（§3.2），不阻塞。
- **长会话性能**：懒加载 + 只在展开时取一次，已规避轮询期反复解析；单次解析一条会话的 assistant 消息，量可控。

## 7. 验收对照
执行卡片点开「🔧 工具足迹」→ 看到该员工这条会话调用的工具列表（Claude-Code 式折叠行或紧凑列表）；无工具的任务不显示足迹条；面板轮询不因此变重（懒加载）。
