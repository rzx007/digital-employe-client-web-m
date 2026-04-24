# DeepAgent 工具实时输出前端对接说明

本文档用于前端对接本次后端改造：`execute_skill` 在执行过程中会将 stdout 按行实时推送，不再只在结束时一次性返回整块结果。

## 变更目标

- 工具执行期间实时看到输出（例如脚本 `print` 三次，前端收到三次事件）。
- 支持断线重连场景下的顺序恢复与去重。
- 保持原有 `messages/updates/artifact` 事件兼容。

## 适用接口

- `POST /chat/conversations/{conversation_id}/stream`
- `GET /chat/conversations/{conversation_id}/stream/resume`

## 新增事件格式

后端在 SSE `data` 中新增事件：

```json
{
  "type": "tool_output",
  "data": {
    "tool_name": "execute_skill",
    "tool_call_id": "tool-xxxx",
    "chunk": "DEEPAGENT_PRINT_PROBE stdout-1: plain print line",
    "chunk_seq": 1,
    "stream": "stdout"
  }
}
```

字段说明：

- `type`: 固定 `tool_output`
- `data.tool_name`: 当前为 `execute_skill`
- `data.tool_call_id`: 工具调用 ID（可能为空，前端需兜底）
- `data.chunk`: 本次增量输出（按行拆分）
- `data.chunk_seq`: 同一 `tool_call_id` 下的增量序号（从 1 递增）
- `data.stream`: 当前固定 `stdout`

## 时序说明

一次完整流中，可能出现如下顺序（示例）：

1. `messages/updates`（模型思考、工具调用元信息等）
2. `tool_output`（多条，实时到达）
3. `messages/updates`（工具结果、模型总结）
4. `[DONE]`

注意：`tool_output` 与现有事件并行出现，不保证与 token 文本严格交错顺序一致，但同一工具调用内 `chunk_seq` 单调递增。

## 前端消费建议

### 1) 事件识别

在 SSE 解析层保留现有逻辑，额外分支识别：

- `payload.type === "tool_output"`

### 2) 聚合键

建议按以下优先级构建分组 key：

1. `tool_call_id`（优先）
2. 若为空，使用 `${tool_name}:fallback`

### 3) 去重策略（必须）

前端本地维护：

- `lastChunkSeqByToolCallId: Map<string, number>`

仅当 `chunk_seq > lastChunkSeqByToolCallId[key]` 时才追加渲染，防止重连重放时重复输出。

### 4) 渲染策略

- 将 `chunk` 作为增量日志逐条 append 到工具输出区域。
- 不要覆盖同一工具调用之前的输出内容。
- 建议保留换行，确保多次 `print` 的可读性。

## 重连行为说明

`/stream/resume` 会先回放历史 buffer，再订阅新事件。  
后端已做序号级顺序保障，前端仍应基于 `chunk_seq` 做幂等处理，避免极端网络抖动下重复显示。

## 验收清单（前端）

- 能在工具执行期间看到多条 `tool_output`（不是最后一次性出现）。
- `print` 三行时，UI 显示三条新增日志。
- 断线重连后，无重复行、顺序正确。
- 旧事件（`messages/updates/artifact`）展示不回归。

## 联调建议

使用 `deepagent-print-probe`（包含 sleep + 多次 print）进行联调：

- 观察 Network 面板 SSE 帧，确认连续 `tool_output` 到达。
- 校验 `chunk_seq` 是否按 1,2,3... 递增。
- 触发重连后确认不重复追加。
