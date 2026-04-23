现在我已经收集了所有需要的信息。以下是完整的 LangGraph `agent.astream` stream_mode v2 格式文档说明。

---

## 一、项目文档中已有的说明

在 `resumable-stream-implementation.md` 文件中（第 51-119 行），已经有详细的 v1 vs v2 对比和 StreamPart 类型说明。其中记录的内容与官方文档一致。

---

## 二、v2 流格式中 `messages` 事件的 payload 结构

### StreamPart 外层结构

```python
{
    "type": "messages",              # Literal["messages"]
    "ns": tuple[str, ...],           # namespace tuple, () = 主 agent, ("tools:<id>",) = subagent
    "data": tuple[AnyMessage, dict[str, Any]],  # (message_chunk, metadata)
}
```

### `data` 字段完整结构

`data` 是一个 **2-tuple**：`(message_chunk, metadata)`

**`message_chunk`** (第 0 个元素) — 一个 `BaseMessage` 子类型（通常是 `AIMessageChunk`），结构如下：

```python
# AIMessageChunk 的关键字段
{
    "content": str | list[dict],        # 文本内容，可能是字符串或 content block 列表
    "type": "AIMessageChunk",           # 消息类型
    "id": str | None,                   # 消息 ID
    "tool_calls": list[dict] | None,    # 工具调用（如果有）
    "name": str | None,                 # 工具名称（tool message 时）
    "tool_call_id": str | None,         # 工具调用 ID（tool message 时）
    "response_metadata": dict,          # 模型返回元数据
    "usage_metadata": dict | None,      # token 使用信息
}
```

**`metadata`** (第 1 个元素) — 一个 `dict[str, Any]`，典型结构：

```python
{
    "langgraph_step": int,              # 当前步骤编号
    "langgraph_node": str,              # 当前节点名称，如 "model_request"、"tools"
    "langgraph_triggers": list[str],    # 触发条件
    "langgraph_path": str,              # 路径
    "langgraph_checkpoint_ns": str,     # checkpoint namespace
    "langgraph_checkpoint_id": str,     # checkpoint ID
    "tags": list[str],                  # 标签列表（可用于过滤特定 LLM 调用）
    "run_id": str,                      # 运行 ID
    "ls_provider": str,                 # LLM 提供商
    "ls_model_name": str,               # 模型名称
}
```

### 序列化后的 JSON 示例

```json
{
  "type": "messages",
  "ns": [],
  "data": [
    {
      "content": "你",
      "type": "AIMessageChunk",
      "id": "chatcmpl-abc123",
      "tool_calls": null,
      "response_metadata": {},
      "usage_metadata": null
    },
    {
      "langgraph_step": 3,
      "langgraph_node": "model_request",
      "langgraph_triggers": ["branch:to:tools"],
      "tags": [],
      "run_id": "uuid-xxx"
    }
  ]
}
```

---

## 三、v2 流格式中 `updates` 事件的 payload 结构

### StreamPart 外层结构

```python
{
    "type": "updates",               # Literal["updates"]
    "ns": tuple[str, ...],           # namespace tuple
    "data": dict[str, Any],          # node_name -> state_update 映射
}
```

### `data` 字段完整结构

`data` 是一个 `dict[str, Any]`，其中：

- **key** = 节点名称（如 `"tools"`、`"agent"`、`"generate_joke"` 等）
- **value** = 该节点返回的状态更新 dict

`data` 中可能还包含以下特殊 key（根据官方 UpdatesStreamPart 文档）：

- `__interrupt__`: `tuple[Interrupt, ...]` — 中断信息
- `__metadata__`: 元数据

### 典型结构

```python
# 简单节点输出
{
    "node_name": {
        "key1": "value1",
        "key2": "value2",
    }
}
```

```python
# tools 节点输出（包含文件操作）
{
    "tools": {
        "files": {
            "/artifacts/report.md": {
                "content": "# Report\n..."
            }
        }
    }
}
```

### 序列化后的 JSON 示例

```json
{
  "type": "updates",
  "ns": [],
  "data": {
    "tools": {
      "messages": [
        {
          "type": "tool",
          "content": "File written successfully",
          "name": "write_file",
          "tool_call_id": "call_abc123"
        }
      ]
    }
  }
}
```

---

## 四、v2 相比 v1 的关键差异

### 总览对比表

| 场景 | v1（默认） | v2 (`version="v2"`) |
|------|-----------|---------------------|
| **单一 stream_mode** | 返回原始数据（dict） | 返回 `StreamPart` dict（`type` + `ns` + `data`） |
| **多个 stream_mode** | 返回 `(mode, data)` 二元组 | 统一 `StreamPart` dict，通过 `chunk["type"]` 区分 |
| **Subgraph 流式** | 返回 `(namespace, data)` 二元组 | 统一 `StreamPart` dict，通过 `chunk["ns"]` 区分 |
| **多模式 + Subgraph** | 返回 `(namespace, mode, data)` 三元组 | 统一 `StreamPart` dict |
| **`invoke()` 返回类型** | 普通 dict（state） | `GraphOutput` 对象（`.value` + `.interrupts`） |
| **中断信息（stream）** | state dict 中的 `__interrupt__` key | `values` stream part 的 `interrupts` 字段 |
| **中断信息（invoke）** | result dict 的 `__interrupt__` key | `GraphOutput.interrupts` 属性 |
| **Pydantic/dataclass 输出** | 返回普通 dict | 自动强制转换为 model/dataclass 实例 |

### 具体代码差异

**v1 代码（当前使用）：**

```python
async for chunk in agent.astream(
    {"messages": request_messages},
    stream_mode=["messages", "updates"],
    config={"configurable": {"thread_id": conversation_id}},
):
    # chunk 是 ("messages", payload) 或 ("updates", payload) 的 tuple
    stream_mode, payload = chunk[0], chunk[1]
    if stream_mode == "messages":
        message, metadata = payload[0], payload[1]
    elif stream_mode == "updates":
        # payload 是 dict
        ...
```

**v2 代码：**

```python
async for chunk in agent.astream(
    {"messages": request_messages},
    stream_mode=["messages", "updates"],
    config={"configurable": {"thread_id": conversation_id}},
    version="v2",  # 关键变化
):
    # chunk 始终是 {"type": ..., "ns": ..., "data": ...} 的 dict
    if chunk["type"] == "messages":
        token, metadata = chunk["data"]       # data 是 tuple
    elif chunk["type"] == "updates":
        for node_name, state in chunk["data"].items():  # data 是 dict
            ...
```

### v2 核心优势

1. **统一结构**：所有事件都是 `{type, ns, data}`，不再需要根据 stream_mode 数量和是否启用 subgraphs 来猜测 chunk 的结构
2. **类型安全**：通过 `chunk["type"]` 可以窄化类型，支持编辑器自动补全和类型检查
3. **Subgraph 支持**：`chunk["ns"]` 标识事件来源（`()` = 主 agent，`("tools:<id>",)` = subagent），无需额外解包
4. **`invoke()` 返回分离**：`GraphOutput` 将 `.value`（状态）和 `.interrupts`（中断）分离，不再混在同一个 dict 中
5. **Pydantic/dataclass 强制转换**：`values` 模式下自动将输出转为正确的类型实例

### 所有 StreamPart 类型汇总

| type | TypedDict | data 类型 | 额外字段 | 说明 |
|------|-----------|----------|---------|------|
| `"values"` | `ValuesStreamPart[OutputT]` | `OutputT`（完整 state） | `interrupts: tuple[Interrupt, ...]` | 每步后的完整状态快照 |
| `"updates"` | `UpdatesStreamPart` | `dict[str, Any]`（节点名 -> 输出） | 无 | 节点执行后的状态更新 |
| `"messages"` | `MessagesStreamPart` | `tuple[AnyMessage, dict[str, Any]]` | 无 | LLM token 流 |
| `"custom"` | `CustomStreamPart` | `Any` | 无 | `get_stream_writer()` 发送的自定义数据 |
| `"checkpoints"` | `CheckpointStreamPart[StateT]` | Checkpoint 元数据 | 无 | checkpoint 事件（需要 checkpointer） |
| `"tasks"` | `TasksStreamPart` | Task 事件 | 无 | 任务开始/完成事件（需要 checkpointer） |
| `"debug"` | `DebugStreamPart[StateT]` | Debug 信息 | 无 | 综合调试信息（checkpoints + tasks + 额外元数据） |
