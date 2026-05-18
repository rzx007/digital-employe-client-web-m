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

DashScope 返回 `"InternalError.Algo.InvalidParameter: Range of input length should be [1, 131072]"`，字符串不匹配，直接原样抛出。deepagents `SummarizationMiddleware.wrap_model_call` 中的 `except ContextOverflowError` 接不住（`OpenAIContextOverflowError` 是其子类），错误穿透到用户。

### 问题 2：本地 token 计数 ≠ API 计数

`token_counter` 默认使用 `count_tokens_approximately`（tiktoken 近似），与 DashScope 服务端计数不一致。`wrap_model_call` 会计入 `system_message`、消息列表与 `tools`，但仍是估算值。

压缩在本地达到 `max_input_tokens` 的 85% 时触发，服务端可能已接近 100%，仍会撞到 131,072 上限。

**已有配置项：** `MODEL_MAX_INPUT_TOKENS`（`model_context.py` → `model.profile["max_input_tokens"]`）是第一道预算闸；设置页建议 128K 模型填 120000（已预留输出与安全余量）。调 fraction 前应先确认用户是否已正确配置该项。

### 问题 3：流式路径丢弃了 usage_metadata

每次模型调用的 `usage_metadata`（`input_tokens`, `output_tokens`）在 LangGraph state 的 `AIMessage` 上存在，但流式落库路径未保留：

- `_extract_text_from_chunk()` 只提取文本
- `_flush_to_db_sync()` 未写入 `ConversationMessage.extra_meta`
- `_load_history_for_agent()` 只加载 `role` / `content`

### 问题 4：chunk 输出中 usage 稀疏且未落库

流式 `AIMessageChunk` 的 `usage_metadata` 通常只在**最后一个**含 usage 的 chunk 上出现；`BaseMessageChunk.__add__()` 合并时不携带 `usage_metadata`。`stream_registry` 的 buffer 也未提取保存。

一次用户消息可能触发**多轮**模型调用（工具循环），应取 buffer 中**最后一次**出现的 usage。

### 问题 5（补充）：参数截断未启用

`ConversationSummarizationMiddleware` 当前只设置 `trigger` / `keep`，`truncate_args_settings=None` 表示**关闭**大 tool 参数截断。对 `write_file` / `execute` 等大参数场景，仅靠调 fraction 帮助有限。

## 改进计划（三阶段）

推荐实施顺序：**1b → 1a（可配置）→ 确认 MODEL_MAX_INPUT_TOKENS → 2a/2b → 2c/3（修正语义）**。

```
Phase 1b（必做）     DashScope → ContextOverflowError，启用兜底摘要
Phase 1a（建议）     降低 trigger + 提高 keep（宜可配置）
Phase 2a/2b         持久化 usage 到 extra_meta（观测与校准）
Phase 2c/3          用「最近一轮 API 用量」校准，勿累加 input_tokens
```

---

### Phase 1：即时修复（高优先级）

#### 1a. 降低压缩触发阈值（可配置）

**文件：** `apps/server/src/service/agent/employee.py`、`apps/server/src/service/agent/orchestrator/agent.py`

| 参数 | 当前值 | 建议默认 | 说明 |
|------|--------|----------|------|
| `trigger` | `("fraction", 0.85)` | `("fraction", 0.70)` | 为本地/API 计数差预留约 30% 余量；**不宜固定 0.55**（过于激进，摘要更频繁、延迟与成本上升） |
| `keep` | `("fraction", 0.10)` | `("fraction", 0.20)` | 保留更多近期上下文，减轻过度压缩 |

**建议：** 通过环境变量或 `Settings` 暴露 `SUMMARIZATION_TRIGGER_FRACTION` / `SUMMARIZATION_KEEP_FRACTION`，便于按模型与流量调参。也可用绝对值：`("tokens", int(max_input_tokens * 0.70))`，比纯 fraction 更直观。

**同步：** 前端 `models-settings.tsx` 中「约在 85% 时自动摘要」文案需与实际上线阈值一致。

**注意：** 若用户已将 `MODEL_MAX_INPUT_TOKENS` 设为保守值（如 120000），再乘 0.70 会叠加两道余量，可能过早触发摘要——上线后应用真实长对话日志校准。

#### 1b. 打补丁使 DashScope 错误转为 ContextOverflowError（必做）

**性价比最高。** 使 deepagents 在「未预判到压缩、首次模型调用超长」时仍能走 `except ContextOverflowError` 的摘要兜底路径。

**新建文件：** `apps/server/src/service/model_patch.py`

```python
"""Monkey-patch langchain_openai error handling for DashScope compatibility."""

from __future__ import annotations

import logging

import langchain_openai.chat_models.base as lm_base

logger = logging.getLogger(__name__)

_original_handler = lm_base._handle_openai_bad_request
_applied = False


def _is_context_overflow_error(error_str: str, errmsg: str) -> bool:
    """仅匹配上下文超长相关文案，避免误判其它 InternalError.Algo。"""
    if "context_length_exceeded" in error_str:
        return True
    if "Input tokens exceed the configured limit" in errmsg:
        return True
    if "Range of input length" in error_str:
        return True
    # 可选：DashScope 其它明确超长表述，按需追加
    return False


def _patched_handler(e: lm_base.openai.BadRequestError) -> None:
    error_str = str(e)
    errmsg = e.message if hasattr(e, "message") else ""

    if _is_context_overflow_error(error_str, errmsg):
        logger.warning(
            "Context overflow from provider (%s), converting for summarization fallback",
            error_str[:120],
        )
        raise lm_base.OpenAIContextOverflowError(
            message=e.message, response=e.response, body=e.body,
        ) from e

    return _original_handler(e)


def apply() -> None:
    global _applied
    if _applied:
        return
    lm_base._handle_openai_bad_request = _patched_handler
    _applied = True
    logger.info("Patched langchain_openai._handle_openai_bad_request for DashScope")
```

**初始化位置（推荐）：** `apps/server/src/server.py` 的 `lifespan` 启动阶段调用一次 `model_patch.apply()`，**不要**在每个 `get_agent()` 内重复打补丁。

```python
from src.service import model_patch

def _startup_db_init():
    init_db()
    model_patch.apply()
```

**限制：** 兜底摘要调用本身也可能因历史过大而失败；本补丁解决的是「主调用 400 未被识别」而非万能。

---

### Phase 2：捕获实际 token 用量（中优先级）

#### 数据流目标

```
ChatOpenAI 返回 AIMessage(usage_metadata={input_tokens, output_tokens})
  → LangGraph state["messages"]          ✅ 已存在
  → 流式 buffer（seq + data）            ✅ convert_to_serializable 可含 usage
  → _flush_terminal_sync                 ❌ 未提取
  → ConversationMessage.extra_meta       ❌ 未写入
```

Buffer 实际结构为 `{"seq": N, "data": payload}`，其中 `payload` 可能是 v2 的 `{"type": "messages", "data": [AIMessageChunk, metadata]}`。提取逻辑应与 `message_parts_extractor._unwrap_stream_payload` 一致。

#### 2a. 从 buffer 提取 usage_metadata

**文件：** `apps/server/src/service/stream_registry.py`（可在同文件新增 helper，供 `_flush_terminal_sync` / `_flush_to_db_sync` 使用）

```python
def _extract_last_usage_from_buffer(events: list[dict]) -> dict | None:
    """从 buffer 倒序取最后一次 AIMessageChunk.kwargs.usage_metadata。"""
    for event in reversed(events):
        if not isinstance(event, dict):
            continue
        raw = event.get("data")
        if not isinstance(raw, dict) or raw.get("type") != "messages":
            continue
        inner = raw.get("data")
        if not isinstance(inner, list) or not inner:
            continue
        first = inner[0]
        if not isinstance(first, dict):
            continue
        kwargs = first.get("kwargs")
        if isinstance(kwargs, dict) and kwargs.get("usage_metadata"):
            return kwargs["usage_metadata"]
    return None
```

**联调注意：** 需确认 DashScope 流式响应经 `langchain dumps` 后，末 chunk 是否带 `usage_metadata`；若无，需改从非流式路径或 `response_metadata` 补充。

#### 2b. 持久化到 extra_meta

在 `_flush_to_db_sync` 或 `_flush_terminal_sync` 落库时：

```python
if usage_meta := _extract_last_usage_from_buffer(buffer_events_snapshot):
    meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
    meta["usage"] = usage_meta  # {input_tokens, output_tokens, ...}
    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
```

用途：计费展示、日志、Phase 3 校准；**不必**新增 DB 列。

#### 2c. 加载历史时读取「最近一轮」API 用量（勿累加）

**常见误区：** 把多轮 assistant 消息的 `input_tokens` **相加**。Chat API 中每条记录的 `input_tokens` 通常是**该次请求整段 prompt 的总量**（含当时全部历史），相加会严重高估（例如 10 轮各 50k → 累加 500k，真实上下文可能约 50k）。

**正确语义：**

- `last_input_tokens`：最近一条带 `extra_meta.usage` 的 assistant 消息的 `input_tokens`，表示**上一轮结束时的上下文规模**。
- 新用户消息、system、tools、skills 仍需本地估算，并加安全余量。

**文件：** `apps/server/src/service/chat_service.py` → `_load_history_for_agent()`

```python
@staticmethod
def _load_history_for_agent(
    db: Session, conversation_id: int, limit: int,
) -> tuple[list[dict[str, str]], int | None]:
    ...
    last_input_tokens: int | None = None
    for message in reversed(messages):
        if message.extra_meta:
            meta = json.loads(message.extra_meta)
            if usage := meta.get("usage"):
                if (t := usage.get("input_tokens")) is not None:
                    last_input_tokens = int(t)
                    break
    ...
    return payload, last_input_tokens
```

---

### Phase 3：用实际用量改进压缩（低优先级）

#### 3a. 将最近用量注入 agent config

**文件：** `apps/server/src/service/chat_service.py` → `stream_conversation_answer()`

```python
history, last_input_tokens = ChatService._load_history_for_agent(...)
if last_input_tokens is not None:
    config["configurable"]["last_reported_input_tokens"] = last_input_tokens
```

#### 3b. 消费方式（推荐优先级）

| 方案 | 说明 | 推荐 |
|------|------|------|
| **ChatService 预截断** | 若 `last_input_tokens` + 估算的新消息 > 阈值 × 安全系数，加载历史时截断条数或字符 | ✅ 首选，不 fork 依赖 |
| **调低 `MODEL_MAX_INPUT_TOKENS`** | 与设置页推荐值对齐，让 fraction 基于更保守的预算 | ✅ 与 1a 配合 |
| **langchain `use_usage_metadata_scaling`** | 计数器用历史 usage 缩放近似值（需查当前 langchain/deepagents 是否暴露） | 待调研 |
| **改 deepagents middleware** | 在 `_should_summarize` 读 config | ❌ 勿改 `.venv`；可向 deepagents 提 PR |

**不推荐：** 修改 `.venv/Lib/site-packages/deepagents/middleware/summarization.py`。

#### 3c. 可选：启用 truncate_args_settings

对大 tool 参数在摘要前做轻量截断，可与 Phase 1a 一并评估，例如：

```python
truncate_args_settings={
    "trigger": ("fraction", 0.50),
    "keep": ("fraction", 0.20),
    "max_length": 2000,
}
```

---

## 影响范围

| 步骤 | 文件 | 新增/修改 | 风险 |
|------|------|-----------|------|
| 1b | 新建 `model_patch.py`，`server.py` lifespan | ~35 行 | 低 |
| 1a | `employee.py`, `orchestrator/agent.py`（+ 可选 Settings） | 修改 4–15 行 | 低（过早摘要 ↑ 成本） |
| 2a | `stream_registry.py` | ~25 行 | 中（依赖流式 usage 是否存在） |
| 2b | `stream_registry.py` | ~8 行 | 低 |
| 2c | `chat_service.py` | ~15 行 | 低 |
| 3 | `chat_service.py` 预截断等 | ~30 行 | 中 |
| 文案 | `models-settings.tsx` | 1 处 | 低 |

## 验证

1. 确认 `MODEL_MAX_INPUT_TOKENS` 已设为不高于推理服务上限的保守值（参考设置页推荐表）。
2. 启动服务，确认日志出现 `Patched langchain_openai...`（仅一次）。
3. 构造长对话，观察在约 70% 阈值（或配置值）时触发自动压缩；日志中可见 summarization 相关行为。
4. 人为构造超长输入，确认 DashScope 400（`Range of input length`）转为 `ContextOverflowError` 并触发兜底摘要，而非直接返回用户。
5. 流式对话结束后，检查 `ConversationMessage.extra_meta` 含 `usage` 字段；`input_tokens` 与控制台/账单量级一致。
6. 回归：多轮 tool 调用后，`usage` 对应**最后一轮**模型调用的统计。
7. 后端：长对话手工测试；若有 Python lint，在 `apps/server` 下执行。

## 相关代码

- 压缩中间件：`apps/server/src/service/agent/employee.py`、`orchestrator/agent.py`
- 模型预算：`apps/server/src/service/model_context.py`
- 流式落库：`apps/server/src/service/stream_registry.py`
- buffer 解析参考：`apps/server/src/service/message_parts_extractor.py`（`_unwrap_stream_payload`）
- 设置 UI：`apps/web/src/components/settings/models-settings.tsx`
