# Token 用量与上下文压缩改进方案

## 问题

对话过程中出现 400 错误：

```
InternalError.Algo.InvalidParameter: Range of input length should be [1, 131072]
```

## 根因分析

### 问题 1：DashScope 错误未被识别为 ContextOverflowError

`langchain_openai` 的 `_handle_openai_bad_request` 只匹配了 OpenAI 的错误文本：

```python
if "context_length_exceeded" in str(e) or "Input tokens exceed the configured limit" in e.message:
    raise OpenAIContextOverflowError(...)
raise  # 否则原样抛出
```

DashScope 返回 `"InternalError.Algo.InvalidParameter: Range of input length should be [1, 131072]"`，字符串不匹配，直接原样抛出。Summarization middleware 的 `except ContextOverflowError` 接不住，错误穿透到用户。

### 问题 2：本地 token 计数 ≠ API 计数

`self.token_counter()` 使用 tiktoken 本地估算，与 DashScope 服务端计数不一致。压缩触发于 85% local 时，但 DashScope 可能已经 95%+，导致撞到 131,072 上限后才触发。

### 问题 3：流式路径丢弃了 usage_metadata

每次模型调用的 `usage_metadata`（`input_tokens`, `output_tokens`）已存在于 LangGraph state 中的 `AIMessage` 上，但经过流式路径后被丢弃了：

- `_extract_text_from_chunk()` 只提取文本，丢弃 `usage_metadata`
- `_flush_to_db_sync()` 未将 token 用量写入 `ConversationMessage.extra_meta`
- `ConversationMessage` 没有 token 用量相关字段
- 下次请求加载历史时无法获得实际 API 报告用量

### 问题 4：chunk 输出不带 token 计量

流式 `AIMessageChunk` 中 `usage_metadata` 仅在最后一个含 `usage` 字段的 chunk 上出现，且 `BaseMessageChunk.__add__()` 合并 chunk 时不包含 `usage_metadata`。当前 `stream_registry` 也未从 buffer 中提取保存。

## 改进计划（三阶段）

### Phase 1：即时修复（高优先级）

#### 1a. 降低压缩触发阈值

**文件：** `apps/server/src/service/agent/employee.py:177-181`、`apps/server/src/service/agent/orchestrator/agent.py:134-138`

| 参数 | 当前值 | 改为 |
|------|--------|------|
| `trigger` | `("fraction", 0.85)` | `("fraction", 0.55)` |
| `keep` | `("fraction", 0.10)` | `("fraction", 0.20)` |

理由：45% 的余量吸收本地与服务端计数差异；keep 从 10% 提到 20%，保留更多近期上下文，减少过度压缩。

#### 1b. 打补丁使 DashScope 错误转为 ContextOverflowError

**新建文件：** `apps/server/src/service/model_patch.py`

```python
"""Monkey-patch langchain_openai error handling for DashScope compatibility."""

from __future__ import annotations

import logging

import langchain_openai.chat_models.base as lm_base

logger = logging.getLogger(__name__)

_original_handler = lm_base._handle_openai_bad_request


def _patched_handler(e: lm_base.openai.BadRequestError) -> None:
    """Convert DashScope context-length errors to OpenAIContextOverflowError."""
    error_str = str(e)
    errmsg = e.message if hasattr(e, "message") else ""

    if (
        "context_length_exceeded" in error_str
        or "Input tokens exceed the configured limit" in errmsg
        or "Range of input length" in error_str
        or "InternalError.Algo" in error_str
    ):
        logger.warning(
            "Detected context overflow error (%s), converting to ContextOverflowError "
            "for summarization fallback",
            error_str[:120],
        )
        raise lm_base.OpenAIContextOverflowError(
            message=e.message, response=e.response, body=e.body,
        ) from e

    return _original_handler(e)


def apply() -> None:
    """Apply the monkey-patch to langchain_openai."""
    lm_base._handle_openai_bad_request = _patched_handler
    logger.info("Monkey-patched langchain_openai._handle_openai_bad_request for DashScope")
```

**修改文件：** `apps/server/src/service/agent/employee.py` 和 `orchestrator/agent.py`

在每个 agent 函数前调用 `model_patch.apply()`（幂等，可多次调用）：

```python
from src.service import model_patch

model_patch.apply()
```

### Phase 2：捕获实际 token 用量（中优先级）

#### 数据流目标

```
ChatOpenAI 返回 AIMessage(usage_metadata={input_tokens, output_tokens})
  → LangGraph state["messages"] ✅ 已存在
  → 流式 buffer 事件 ✅ 已序列化（convert_to_serializable）
  → _flush_terminal_sync → ❌ 未提取
  → ConversationMessage.extra_meta → ❌ 未写入
```

#### 2a. 从 buffer 提取 usage_metadata

**文件：** `apps/server/src/service/stream_registry.py` → `_flush_terminal_sync()`

在 `_flush_terminal_sync` 中扫描 `buffer_events_snapshot`：

```python
def _extract_last_usage_from_buffer(events: list[dict]) -> dict | None:
    """Scan stream buffer events for the last AIMessageChunk with usage_metadata."""
    for event in reversed(events):
        if not isinstance(event, dict) or event.get("type") != "messages":
            continue
        data = event.get("data")
        if not isinstance(data, list) or not data:
            continue
        msg = data[0]
        if isinstance(msg, dict) and msg.get("usage_metadata"):
            return msg["usage_metadata"]
    return None
```

#### 2b. 持久化到 extra_meta

**文件：** `apps/server/src/service/stream_registry.py` → `_flush_to_db_sync()`

```python
if usage_meta := _extract_last_usage_from_buffer(buffer_events_snapshot):
    meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
    meta["usage"] = usage_meta
    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
```

#### 2c. 加载历史时累计实际用量

**文件：** `apps/server/src/service/chat_service.py` → `_load_history_for_agent()`

```python
@staticmethod
def _load_history_for_agent(db, conversation_id, limit):
    ...
    usage_total = 0
    for message in reversed(messages):
        if message.extra_meta:
            meta = json.loads(message.extra_meta)
            if usage := meta.get("usage"):
                usage_total += usage.get("input_tokens", 0)
    ...
    return payload, usage_total
```

返回的 `usage_total` 可在上层传给 agent 或用于预判。

### Phase 3：用实际用量改进压缩（低优先级）

#### 3a. 将实际累计用量注入 agent config

**文件：** `apps/server/src/service/chat_service.py` → `stream_conversation_answer()`

```python
accumulated_usage = ChatService._load_history_for_agent(...)  # 返回两个值
config["configurable"]["actual_input_tokens"] = accumulated_usage
```

#### 3b. Middleware 读取 config 中的实际用量

**文件：** `.venv/Lib/site-packages/deepagents/middleware/summarization.py` → `wrap_model_call()`

在 `_should_summarize` 前后增加读取逻辑。此步需要改动 `.venv` 中的库代码，或通过 PR 提交到 deepagents。

备选（不修改 .venv）：在 `ChatService` 层预判实际用量，若接近阈值则主动截断历史消息再传给 agent。

## 影响范围

| 步骤 | 文件 | 新增/修改 | 风险 |
|------|------|-----------|------|
| 1a | `employee.py`, `orchestrator/agent.py` | 修改 4 行 | 低 |
| 1b | 新建 `model_patch.py`, 修改 2 个 import | ~20 行新增 | 低 |
| 2a | `stream_registry.py` | ~15 行新增 | 中 |
| 2b | `stream_registry.py` | ~5 行新增 | 低 |
| 2c | `chat_service.py` | ~8 行修改 | 低 |
| 3 | 多个文件 | ~30 行 | 高（或走备选方案） |

## 验证

1. 本地启动服务，构造长对话使 token 接近 55% 阈值
2. 触发自动压缩，观察日志中的 `_should_summarize` 决策
3. 超长输入触发 DashScope 400 错误时，确认转为 `ContextOverflowError` 并被 middleware 捕获
4. 查看 `ConversationMessage.extra_meta` 中是否出现 `usage` 字段
5. `pnpm lint` + `pnpm typecheck` 通过
