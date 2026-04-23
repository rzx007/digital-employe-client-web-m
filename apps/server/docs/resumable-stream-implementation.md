# 可恢复流（Resumable Stream）实施文档

> 基于 deepagents 0.5.3 + langgraph 1.1.6，全面采用 `version="v2"` 流格式

## 1. 现状分析

### 1.1 当前架构

```
Client (SSE)
  → POST /chat/conversations/{id}/stream
    → FastAPI StreamingResponse (text/event-stream)
      → ChatService.stream_conversation_answer()
        → get_agent() 每次请求创建新 agent 实例
        → agent.astream({"messages": ...}, stream_mode=["messages","updates"])
        → 逐 chunk yield "data: {json}\n\n"       ← v1 格式: (mode, data) tuple
        → yield "data: [DONE]\n\n"
```

### 1.2 关键文件

| 文件 | 作用 |
|------|------|
| `src/service/agent.py` | Agent 工厂，`get_agent()` 创建 deepagents 实例，使用全局 `MemorySaver` |
| `src/service/chat_service.py` | 对话服务，`stream_conversation_answer()` 核心流式生成器，`_try_extract_artifact()` 提取文件事件 |
| `src/api/chat_api.py` | FastAPI 路由层，SSE 端点 `/chat/conversations/{id}/stream` |
| `src/models/conversation.py` | `Conversation` / `ConversationMessage` ORM 模型 |
| `src/db/init_db.py` | 数据库初始化 + `ensure_column` 自动迁移 |
| `src/core/config.py` | Settings dataclass，从 `.env` 读取配置 |

### 1.3 关键问题

| 问题 | 说明 | 位置 |
|------|------|------|
| Checkpointer 使用 `MemorySaver` | 内存存储，进程重启后丢失所有 checkpoint | `agent.py:24` |
| v1 streaming format | 当前使用 `(mode, data)` tuple，需手动解包，无法统一处理 subgraph 事件 | `chat_service.py:467-470` |
| SSE 断线不可恢复 | 客户端网络断开后，无法从断点继续接收流数据 | `chat_api.py:65-83` |
| 流式 chunk 无序列号 | SSE 事件没有 `id` 字段，无法标识断点位置 | `chat_service.py:490` |
| `_try_extract_artifact` 基于 v1 | 依赖 `isinstance(chunk, tuple)` 判断 stream_mode | `chat_service.py:296` |

### 1.4 环境确认

| 依赖 | 版本要求 | 实际安装 | 支持 v2 |
|------|----------|----------|---------|
| langgraph | >= 1.1 | 1.1.6 | ✅ |
| deepagents | 0.5.3 | 0.5.3 | ✅（v2 是 langgraph 层面的） |
| `version="v2"` | langgraph >= 1.1 | 1.1.6 | ✅ |

---

## 2. v1 vs v2 流格式对比

### 2.1 v1（当前使用）

```python
# astream 返回 tuple，需要手动解包
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

**问题：**
- 不同 stream_mode 的 payload 结构不同，需要条件判断
- 无法区分 subgraph 事件
- `invoke()` 返回普通 dict，interrupt 嵌在 `__interrupt__` key 中

### 2.2 v2（目标格式）

```python
# astream 返回统一的 StreamPart dict
async for chunk in agent.astream(
    {"messages": request_messages},
    stream_mode=["messages", "updates"],
    config={"configurable": {"thread_id": conversation_id}},
    version="v2",  # ← 关键变化
):
    # chunk 始终是 {"type": ..., "ns": ..., "data": ...} 的 dict
    if chunk["type"] == "messages":
        token, metadata = chunk["data"]
        # chunk["ns"] == () → 主 agent
        # chunk["ns"] == ("tools:abc123",) → subagent
    elif chunk["type"] == "updates":
        for node_name, state in chunk["data"].items():
            ...
```

**优势：**
- 统一结构：所有事件都是 `{"type", "ns", "data"}`
- 类型安全：可通过 `chunk["type"]` 窄化类型
- Subgraph 支持：`chunk["ns"]` 标识事件来源
- `invoke()` 返回 `GraphOutput` 对象，`.value` + `.interrupts` 分离

### 2.3 v2 StreamPart 类型

```python
{
    "type": "values" | "updates" | "messages" | "custom" | "checkpoints" | "tasks" | "debug",
    "ns": (),           # namespace tuple: () = 主 agent, ("tools:<id>",) = subagent
    "data": ...,        # 具体负载，类型随 type 变化
}
```

| type | data 结构 | 说明 |
|------|-----------|------|
| `"messages"` | `(token, metadata)` | LLM token 流，token 是 MessageChunk |
| `"updates"` | `{node_name: state_update}` | 节点执行后的状态更新 |
| `"values"` | 完整 state dict | 每步后的完整状态快照 |
| `"custom"` | 任意 dict | `get_stream_writer()` 发送的自定义数据 |
| `"checkpoints"` | StateSnapshot | checkpoint 事件 |

---

## 3. 实施方案概述

**核心思路：v2 流格式 + Checkpointer 持久化 + SSE 事件编号 + 断线重连 API**

### 三个阶段

| 阶段 | 内容 | 依赖 |
|------|------|------|
| Phase 1 | Checkpointer 持久化（SQLite）+ v2 格式迁移 | 无 |
| Phase 2 | SSE 事件编号 + 断线检测 + 重连 API | Phase 1 |
| Phase 3 | Human-in-the-Loop 审批恢复（可选） | Phase 2 |

---

## 4. Phase 1：Checkpointer 持久化 + v2 流格式迁移

### 4.1 安装依赖

```bash
cd apps/server
uv add "langgraph-checkpoint-sqlite>=2.0.0"
```

### 4.2 修改 `src/service/agent.py`

#### 4.2.1 替换 checkpointer

**删除：**

```python
from langgraph.checkpoint.memory import MemorySaver
# ...
_CHECKPOINTER = MemorySaver()
```

**替换为：**

```python
import sqlite3
from langgraph.checkpoint.sqlite import SqliteSaver

def _get_checkpointer() -> SqliteSaver:
    settings = get_settings()
    checkpoint_dir = os.path.dirname(settings.sqlite_path)
    os.makedirs(checkpoint_dir, exist_ok=True)
    checkpoint_path = os.path.join(checkpoint_dir, "checkpoints.db")
    conn = sqlite3.connect(checkpoint_path, check_same_thread=False)
    return SqliteSaver(conn)

_CHECKPOINTER: SqliteSaver | None = None

def get_checkpointer() -> SqliteSaver:
    global _CHECKPOINTER
    if _CHECKPOINTER is None:
        _CHECKPOINTER = _get_checkpointer()
    return _CHECKPOINTER
```

#### 4.2.2 修改 `get_agent()` 中的 checkpointer 引用

```python
# agent.py:169
# 原: checkpointer = _CHECKPOINTER
checkpointer = get_checkpointer()
```

### 4.3 改造 `src/service/chat_service.py` 的流式方法

#### 4.3.1 `_try_extract_artifact` 改为 v2 格式

当前实现基于 v1 tuple 格式判断 `isinstance(chunk, tuple)`，v2 格式下 chunk 始终是 dict：

```python
@staticmethod
def _try_extract_artifact(
    chunk: dict,  # v2: StreamPart dict
    conversation_id: int,
    pending_tool_calls: dict,
) -> dict | None:
    """
    v2 格式下从 StreamPart 中检测文件操作并生成 artifact 事件。

    chunk 结构: {"type": "messages"|"updates"|..., "ns": (), "data": ...}
    """
    chunk_type = chunk.get("type")

    # 处理 messages 事件：检测 write_file / edit_file 的 ToolMessage
    if chunk_type == "messages":
        data = chunk.get("data")
        if not isinstance(data, (list, tuple)) or len(data) == 0:
            return None
        message = data[0]
        msg_type = getattr(message, "type", None)
        if msg_type != "tool":
            return None

        tool_name = getattr(message, "name", None)
        tool_call_id = getattr(message, "tool_call_id", None) or ""
        content = getattr(message, "content", "") or ""

        if tool_name not in ("write_file", "edit_file"):
            return None

        file_path = ChatService._extract_file_path_from_tool_output(content)
        if file_path and is_artifact_file(file_path):
            pending_tool_calls[tool_call_id] = {
                "tool_name": tool_name,
                "file_path": file_path,
            }
            logger.info(
                "artifact pending: tool=%s file=%s call_id=%s",
                tool_name, file_path, tool_call_id,
            )
        return None

    # 处理 updates 事件：从 tools files 中提取文件内容
    if chunk_type == "updates":
        data = chunk.get("data")
        if not isinstance(data, dict):
            return None
        tools_data = data.get("tools")
        if not isinstance(tools_data, dict):
            return None
        files = tools_data.get("files")
        if not isinstance(files, dict):
            return None

        for file_path, file_info in files.items():
            if not isinstance(file_info, dict):
                continue
            file_content = file_info.get("content")
            if file_content is None or not is_artifact_file(file_path):
                continue

            tool_call_id = ""
            tool_name = ""
            for tid, info in list(pending_tool_calls.items()):
                if info["file_path"] == file_path:
                    tool_call_id = tid
                    tool_name = info["tool_name"]
                    del pending_tool_calls[tid]
                    break

            if not tool_call_id:
                tool_call_id = f"file:{conversation_id}:{file_path}"

            status = "completed" if tool_name == "write_file" or not tool_name else "updated"
            return build_artifact_event(
                file_path=file_path,
                content=str(file_content),
                conversation_id=conversation_id,
                tool_call_id=tool_call_id,
                status=status,
            )

    return None
```

#### 4.3.2 `_extract_text_from_chunk` 适配 v2

```python
@staticmethod
def _extract_text_from_chunk(chunk: dict) -> str:
    """从 v2 StreamPart 中提取文本内容。

    v2 chunk 结构: {"type": "...", "data": ..., "ns": ...}
    messages 类型: data = (token, metadata)
    updates 类型: data = {node_name: state}
    """
    chunk_type = chunk.get("type")

    if chunk_type == "messages":
        data = chunk.get("data")
        if isinstance(data, (list, tuple)) and len(data) >= 1:
            token = data[0]
            content = getattr(token, "content", None)
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = []
                for item in content:
                    if isinstance(item, str):
                        parts.append(item)
                    elif isinstance(item, dict) and "text" in item:
                        parts.append(item["text"])
                return "".join(parts)
        return ""

    if chunk_type == "updates":
        # updates 中一般不含纯文本，但可以检查
        return ""

    return ""
```

#### 4.3.3 `stream_conversation_answer` 迁移到 v2

```python
@staticmethod
async def stream_conversation_answer(
    db: Session,
    conversation_id: int,
    question: str,
    skill_name: str,
    debug_content_only: bool = False,
    extra_meta: dict | None = None,
):
    settings = get_settings()

    conversation = ChatService.get_conversation(db, conversation_id)
    history_messages = ChatService._load_history_for_agent(
        db,
        conversation_id=conversation_id,
        limit=settings.chat_history_max_messages,
    )

    ChatService._append_message(
        db, conversation=conversation, role="user",
        content=question, extra_meta=extra_meta,
    )
    request_messages = [
        *history_messages, {"role": "user", "content": question}
    ]

    conversation = ChatService.get_conversation(db, conversation_id)
    workspace = db.get(Workspace, conversation.workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。"
        )

    target_type = conversation.target_type
    target_id = conversation.target_id
    if target_type == "employee":
        employee = db.get(Employee, target_id)
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。"
            )
        skills_path_payload = employee.skills_json
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_type 仅支持 employee 或 group。",
        )

    try:
        skills_path = ChatService.resolve_employee_skills_dir(
            skills_payload=skills_path_payload,
            employee_id=employee.id if target_type == "employee" else None,
            employee_name=employee.name if target_type == "employee" else None,
            employee_code=(
                employee.employee_code
                if target_type == "employee" else None
            ),
        )
    except HTTPException:
        skills_path = ""

    root_path = settings.artifacts_path
    agent = get_agent(
        skills_path, root_path,
        employee_id=employee.id if target_type == "employee" else None,
        conversation_id=conversation_id,
    )

    collected_chunks: list[Any] = []
    assistant_text_parts: list[str] = []
    pending_tool_calls: dict[str, dict] = {}

    try:
        skill_question = question
        if skill_name:
            skill_question = f"请使用{skill_name}技能回答这个问题：{question}"
        if request_messages:
            request_messages[-1] = {"role": "user", "content": skill_question}

        # ============ v2 核心变化：添加 version="v2" ============
        async for chunk in agent.astream(
            {"messages": request_messages},
            stream_mode=["messages", "updates"],
            config={"configurable": {"thread_id": conversation_id}},
            version="v2",  # ← 启用 v2 统一流格式
        ):
            # chunk 始终是 {"type": "...", "ns": ..., "data": ...}
            # 不再是 (mode, payload) tuple

            serializable_chunk = ChatService.convert_to_serializable(chunk)
            collected_chunks.append(serializable_chunk)
            text_part = ChatService._extract_text_from_chunk(chunk)
            if text_part:
                assistant_text_parts.append(text_part)

            if debug_content_only:
                if text_part:
                    yield f"data: {text_part}\n\n"
                continue

            # 检测 artifact 事件（传入 v2 dict 而非 tuple）
            artifact_event = ChatService._try_extract_artifact(
                chunk, conversation_id, pending_tool_calls,
            )
            if artifact_event:
                yield f"data: {json.dumps(artifact_event, ensure_ascii=False)}\n\n"

            yield f"data: {json.dumps(serializable_chunk, ensure_ascii=False, default=str)}\n\n"

        final_text = "".join(assistant_text_parts).strip() or "模型已完成调用。"
        ChatService._append_message(
            db,
            conversation=conversation,
            role="assistant",
            content=final_text,
            chunk_json=json.dumps(
                collected_chunks, ensure_ascii=False, default=str,
            ),
        )
        yield "data: [DONE]\n\n"

    except Exception as e:
        logger.error("流式对话执行失败: %s", e, exc_info=True)
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
```

### 4.4 `convert_to_serializable` 适配 v2

v2 chunk 是标准 dict，不再有 tuple 和 LangChain 对象在顶层，但 `chunk["data"]` 中仍有 LangChain 对象需要处理。现有方法已能递归处理 dict，只需确保顶层正确传入：

```python
# 无需大改，convert_to_serializable 已经能处理 dict
# 但 v2 的 messages 类型中 data = (token, metadata) 是 tuple
# 需要确保 tuple 被正确处理 → 现有代码 line 576 已处理 list/tuple
```

### 4.5 验证标准

- 重启服务后，同一 `conversation_id` 对话上下文不丢失
- `agent.get_state(config)` 返回正确 checkpoint
- v2 格式流正常输出，`chunk["type"]` 和 `chunk["data"]` 结构正确
- Artifact 检测功能正常（从 v2 `updates` 类型中提取文件操作）

---

## 5. Phase 2：SSE 事件编号 + 断线重连 API

### 5.1 目标

- 每个 SSE 事件携带 `id:` 和 `event:` 字段
- 客户端断线后可通过新 API 从断点继续
- Agent 已完成的步骤不重新执行（利用 checkpointer）

### 5.2 SSE 事件格式

**改造后格式（基于 v2 StreamPart）：**

```
id: {conversation_id}:{sequence}
event: chunk
data: {"type":"messages","ns":[],"data":[...]}

id: {conversation_id}:{sequence}
event: artifact
data: {"type":"artifact","data":{...}}

id: {conversation_id}:{sequence}
event: done
data: {"status":"completed"}
```

### 5.3 数据模型修改

#### 5.3.1 `ConversationMessage` 添加流状态字段

```python
# models/conversation.py ConversationMessage 类中添加

stream_state = Column(String(32), nullable=True)
# 取值: "streaming" | "completed" | "error" | NULL（旧消息无此字段）

stream_cursor = Column(Integer, nullable=True, default=0)
# 已发送的最后一个事件序列号

stream_chunks = Column(Text, nullable=True)
# 序列化的事件列表（JSON array），用于断线重放
```

#### 5.3.2 `init_db.py` 添加迁移

```python
ensure_column(conn, "conversation_messages", "stream_state", "VARCHAR(32)")
ensure_column(conn, "conversation_messages", "stream_cursor", "INTEGER DEFAULT 0")
ensure_column(conn, "conversation_messages", "stream_chunks", "TEXT")
```

### 5.4 新增 `StreamEventBuffer` 类

```python
class StreamEventBuffer:
    """缓冲所有 SSE 事件，支持断线重放。"""

    def __init__(self, conversation_id: int):
        self.conversation_id = conversation_id
        self.events: list[dict] = []
        self._seq = 0

    def add(self, event_type: str, data: Any) -> dict:
        self._seq += 1
        event = {
            "seq": self._seq,
            "event": event_type,
            "data": data,
        }
        self.events.append(event)
        return event

    def format_sse(self, event: dict) -> str:
        lines = [
            f"id: {self.conversation_id}:{event['seq']}",
            f"event: {event['event']}",
            f"data: {json.dumps(event['data'], ensure_ascii=False, default=str)}",
        ]
        return "\n".join(lines) + "\n\n"

    def get_events_after(self, cursor: int) -> list[dict]:
        return [e for e in self.events if e["seq"] > cursor]

    @property
    def cursor(self) -> int:
        return self._seq
```

### 5.5 改造 `stream_conversation_answer`（Phase 2 完整版）

```python
@staticmethod
async def stream_conversation_answer(
    db: Session,
    conversation_id: int,
    question: str,
    skill_name: str,
    debug_content_only: bool = False,
    extra_meta: dict | None = None,
):
    settings = get_settings()
    conversation = ChatService.get_conversation(db, conversation_id)
    history_messages = ChatService._load_history_for_agent(
        db, conversation_id=conversation_id,
        limit=settings.chat_history_max_messages,
    )

    ChatService._append_message(
        db, conversation=conversation, role="user",
        content=question, extra_meta=extra_meta,
    )
    request_messages = [
        *history_messages, {"role": "user", "content": question}
    ]

    conversation = ChatService.get_conversation(db, conversation_id)
    workspace = db.get(Workspace, conversation.workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。"
        )

    target_type = conversation.target_type
    target_id = conversation.target_id
    if target_type == "employee":
        employee = db.get(Employee, target_id)
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。"
            )
        skills_path_payload = employee.skills_json
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_type 仅支持 employee 或 group。",
        )

    try:
        skills_path = ChatService.resolve_employee_skills_dir(
            skills_payload=skills_path_payload,
            employee_id=employee.id if target_type == "employee" else None,
            employee_name=employee.name if target_type == "employee" else None,
            employee_code=(
                employee.employee_code
                if target_type == "employee" else None
            ),
        )
    except HTTPException:
        skills_path = ""

    root_path = settings.artifacts_path
    agent = get_agent(
        skills_path, root_path,
        employee_id=employee.id if target_type == "employee" else None,
        conversation_id=conversation_id,
    )

    # --- Phase 2 新增：事件缓冲 ---
    buffer = StreamEventBuffer(conversation_id)
    collected_chunks: list[Any] = []
    assistant_text_parts: list[str] = []
    pending_tool_calls: dict[str, dict] = {}

    # 创建 streaming 状态的消息占位
    stream_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=None,
        stream_state="streaming",
        stream_cursor=0,
    )
    db.add(stream_msg)
    db.commit()
    db.refresh(stream_msg)

    skill_question = question
    if skill_name:
        skill_question = f"请使用{skill_name}技能回答这个问题：{question}"
    if request_messages:
        request_messages[-1] = {"role": "user", "content": skill_question}

    try:
        async for chunk in agent.astream(
            {"messages": request_messages},
            stream_mode=["messages", "updates"],
            config={"configurable": {"thread_id": conversation_id}},
            version="v2",
        ):
            # v2 chunk: {"type": "...", "ns": ..., "data": ...}
            serializable = ChatService.convert_to_serializable(chunk)
            collected_chunks.append(serializable)
            text_part = ChatService._extract_text_from_chunk(chunk)
            if text_part:
                assistant_text_parts.append(text_part)

            # 检测 artifact
            artifact_event = ChatService._try_extract_artifact(
                chunk, conversation_id, pending_tool_calls,
            )
            if artifact_event:
                evt = buffer.add("artifact", artifact_event)
                yield buffer.format_sse(evt)

            # 常规 chunk（带 SSE id + event 字段）
            if not debug_content_only:
                evt = buffer.add("chunk", serializable)
                yield buffer.format_sse(evt)
            elif text_part:
                yield f"data: {text_part}\n\n"

        # 流完成：更新消息
        final_text = "".join(assistant_text_parts).strip() or "模型已完成调用。"
        stream_msg.content = final_text
        stream_msg.stream_state = "completed"
        stream_msg.stream_cursor = buffer.cursor
        stream_msg.chunk_json = json.dumps(
            collected_chunks, ensure_ascii=False, default=str,
        )
        stream_msg.stream_chunks = json.dumps(
            buffer.events, ensure_ascii=False, default=str,
        )
        db.commit()

        evt = buffer.add("done", {"status": "completed"})
        yield buffer.format_sse(evt)

    except Exception as e:
        logger.error("流式对话执行失败: %s", e, exc_info=True)
        stream_msg.stream_state = "error"
        stream_msg.stream_chunks = json.dumps(
            buffer.events, ensure_ascii=False, default=str,
        )
        db.commit()
        evt = buffer.add("error", {"error": str(e)})
        yield buffer.format_sse(evt)
```

### 5.6 新增 API：断线重连端点

#### 5.6.1 Schema

```python
# schemas/conversation.py
class ResumeStreamRequest(BaseModel):
    last_event_id: int = Field(
        default=0,
        description="客户端最后成功接收的事件序列号",
    )
```

#### 5.6.2 路由

```python
# chat_api.py

@router.post("/chat/conversations/{conversation_id}/stream/resume")
async def resume_conversation_stream(
    conversation_id: int,
    payload: ResumeStreamRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """断线重连：从指定事件位置继续流式输出。"""
    return StreamingResponse(
        ChatService.resume_stream(
            db, conversation_id, payload.last_event_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

#### 5.6.3 `resume_stream` 方法

```python
@staticmethod
async def resume_stream(
    db: Session, conversation_id: int, last_event_id: int,
):
    """从断点恢复流输出。

    逻辑：
    1. 查找该会话最新的 assistant 消息（有 stream_state 的）
    2. completed / error → 重放缓冲事件中 last_event_id 之后的部分
    3. streaming → 重放已缓冲部分 + 尝试恢复 agent 执行
    """
    conversation = ChatService.get_conversation(db, conversation_id)

    stmt = (
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation_id,
            ConversationMessage.stream_state.isnot(None),
        )
        .order_by(ConversationMessage.id.desc())
        .limit(1)
    )
    msg = db.scalars(stmt).first()

    if not msg or not msg.stream_chunks:
        evt_id = f"{conversation_id}:0"
        yield (
            f"id: {evt_id}\nevent: error\n"
            f'data: {{"error": "无可恢复的流"}}\n\n'
        )
        return

    buffer = StreamEventBuffer(conversation_id)
    events = json.loads(msg.stream_chunks)
    buffer.events = events
    buffer._seq = max((e["seq"] for e in events), default=0)

    # 重放 last_event_id 之后的事件
    for evt in events:
        if evt["seq"] > last_event_id:
            yield buffer.format_sse(evt)

    if msg.stream_state == "completed":
        yield (
            f"id: {conversation_id}:{buffer.cursor + 1}\n"
            f'event: done\ndata: {{"status": "completed"}}\n\n'
        )
    elif msg.stream_state == "error":
        yield (
            f"id: {conversation_id}:{buffer.cursor + 1}\n"
            f'event: error\ndata: {{"status": "error", "msg": "流中断"}}\n\n'
        )
    elif msg.stream_state == "streaming":
        # 尝试从 checkpoint 恢复
        settings = get_settings()
        agent = get_agent(
            "", settings.artifacts_path,
            conversation_id=conversation_id,
        )
        config = {"configurable": {"thread_id": conversation_id}}
        state = agent.get_state(config)

        if state.next:
            # agent 还有未完成的步骤
            yield (
                f"id: {conversation_id}:{buffer.cursor + 1}\n"
                f'event: info\ndata: {{"status": "pending_resume", '
                f'"next_nodes": {json.dumps(list(state.next))}}}\n\n'
            )
        else:
            yield (
                f"id: {conversation_id}:{buffer.cursor + 1}\n"
                f'event: done\ndata: {{"status": "replay_complete"}}\n\n'
            )
```

### 5.7 Checkpoint 状态查询（可选）

```python
# chat_service.py
@staticmethod
def get_agent_checkpoint_state(conversation_id: int) -> dict | None:
    settings = get_settings()
    agent = get_agent(
        "", settings.artifacts_path,
        conversation_id=conversation_id,
    )
    config = {"configurable": {"thread_id": conversation_id}}
    state = agent.get_state(config)
    return {
        "next": list(state.next) if state.next else [],
        "has_state": bool(state.values),
        "tasks": [
            {"id": t.id, "name": t.name, "error": t.error}
            for t in state.tasks
        ],
    }
```

```python
# chat_api.py
@router.get(
    "/chat/conversations/{conversation_id}/checkpoint",
    response_model=ResponseBase,
)
def get_checkpoint_state(
    conversation_id: int, db: Session = Depends(get_db),
) -> ResponseBase:
    ChatService.get_conversation(db, conversation_id)
    state = ChatService.get_agent_checkpoint_state(conversation_id)
    return ResponseBase(data=state)
```

---

## 6. Phase 3：Human-in-the-Loop 审批恢复（可选）

### 6.1 配置 interrupt

```python
# agent.py get_agent() 中添加
agent = create_deep_agent(
    model=model,
    # ... 现有参数 ...
    interrupt_on={
        "write_file": True,
        "edit_file": True,
    },
)
```

### 6.2 v2 格式下的 interrupt 处理

v2 格式中，`invoke()` 返回 `GraphOutput` 对象：

```python
from langgraph.types import GraphOutput, Command

result = agent.invoke(
    {"messages": request_messages},
    config={"configurable": {"thread_id": conversation_id}},
    version="v2",
)

# v2: result 是 GraphOutput
if result.interrupts:  # 不再是 "__interrupt__" in result
    interrupt_value = result.interrupts[0].value
    action_requests = interrupt_value["action_requests"]

    # 审批后恢复
    result = agent.invoke(
        Command(resume={"decisions": [{"type": "approve"}]}),
        config={"configurable": {"thread_id": conversation_id}},
        version="v2",
    )
```

v2 的 `astream()` 中，interrupt 通过 `values` stream part 的 `interrupts` 字段传递：

```python
async for chunk in agent.astream(
    {"messages": request_messages},
    stream_mode=["messages", "updates", "values"],
    config={"configurable": {"thread_id": conversation_id}},
    version="v2",
):
    if chunk["type"] == "values":
        # v2: interrupt 信息在 values stream part 中
        # 不再是 v1 的 __interrupt__ key
        pass
```

### 6.3 审批 API

```python
# schemas/conversation.py
class ToolCallDecision(BaseModel):
    type: str = Field(description="approve | edit | reject")
    edited_action: dict | None = Field(
        default=None,
        description="编辑后的工具调用参数（type=edit 时必填）",
    )
```

```python
# chat_api.py
from langgraph.types import Command

@router.post(
    "/chat/conversations/{conversation_id}/approve",
    response_model=ResponseBase,
)
async def approve_tool_call(
    conversation_id: int,
    payload: list[ToolCallDecision],
    db: Session = Depends(get_db),
) -> StreamingResponse:
    ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    agent = get_agent(
        "", settings.artifacts_path,
        conversation_id=conversation_id,
    )
    config = {"configurable": {"thread_id": conversation_id}}
    decisions = [d.model_dump(exclude_none=True) for d in payload]

    return StreamingResponse(
        ChatService.stream_after_resume(
            agent, config, decisions, conversation_id, db,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
```

### 6.4 审批后恢复流

```python
# chat_service.py
@staticmethod
async def stream_after_resume(agent, config, decisions, conversation_id, db):
    """HITL 审批后恢复 agent 执行。"""
    buffer = StreamEventBuffer(conversation_id)
    assistant_text_parts: list[str] = []
    pending_tool_calls: dict[str, dict] = {}

    try:
        async for chunk in agent.astream(
            Command(resume={"decisions": decisions}),
            config=config,
            stream_mode=["messages", "updates"],
            version="v2",  # ← v2 格式
        ):
            text_part = ChatService._extract_text_from_chunk(chunk)
            if text_part:
                assistant_text_parts.append(text_part)

            artifact_event = ChatService._try_extract_artifact(
                chunk, conversation_id, pending_tool_calls,
            )
            if artifact_event:
                evt = buffer.add("artifact", artifact_event)
                yield buffer.format_sse(evt)

            serializable = ChatService.convert_to_serializable(chunk)
            evt = buffer.add("chunk", serializable)
            yield buffer.format_sse(evt)

        final_text = "".join(assistant_text_parts).strip() or "操作已完成。"
        conversation = ChatService.get_conversation(db, conversation_id)
        ChatService._append_message(
            db, conversation=conversation,
            role="assistant", content=final_text,
        )
        evt = buffer.add("done", {"status": "completed"})
        yield buffer.format_sse(evt)

    except Exception as e:
        logger.error("审批恢复流失败: %s", e, exc_info=True)
        evt = buffer.add("error", {"error": str(e)})
        yield buffer.format_sse(evt)
```

---

## 7. 前端对接指南

### 7.1 SSE 事件结构

| 字段 | 说明 |
|------|------|
| `id` | 格式 `{conversation_id}:{seq}`，用于断线重连定位 |
| `event` | 事件类型：`chunk` / `artifact` / `done` / `error` / `info` |
| `data` | JSON 负载（v2 格式的 StreamPart） |

### 7.2 v2 chunk data 结构

前端接收到的 `data` 字段是序列化后的 v2 StreamPart：

```json
{
  "type": "messages",
  "ns": [],
  "data": [{ "content": "你", "type": "AIMessageChunk", ... }, { "langgraph_node": "model_request", ... }]
}
```

```json
{
  "type": "updates",
  "ns": [],
  "data": { "tools": { "files": { "/artifacts/report.md": { "content": "..." } } } }
}
```

### 7.3 流式请求实现

```typescript
interface StreamEvent {
  seq: number
  event: "chunk" | "artifact" | "done" | "error" | "info"
  data: {
    type: "messages" | "updates" | "values" | "custom"
    ns: string[]
    data: unknown
  }
}

async function* streamChat(
  conversationId: number,
  question: string,
  lastEventId = 0,
  skill?: string,
): AsyncGenerator<StreamEvent> {
  const isResume = lastEventId > 0
  const url = isResume
    ? `/api/chat/conversations/${conversationId}/stream/resume`
    : `/api/chat/conversations/${conversationId}/stream`

  const body = isResume
    ? { last_event_id: lastEventId }
    : { question, skill }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok || !response.body) throw new Error("Stream request failed")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop() || ""

    let currentSeq = 0
    let currentEvent = ""
    let currentData = ""

    for (const line of lines) {
      if (line.startsWith("id: ")) {
        const parts = line.substring(4).split(":")
        currentSeq = parseInt(parts[1], 10)
      } else if (line.startsWith("event: ")) {
        currentEvent = line.substring(7)
      } else if (line.startsWith("data: ")) {
        currentData = line.substring(6)
      } else if (line === "" && currentEvent && currentData) {
        try {
          const data = JSON.parse(currentData)
          yield { seq: currentSeq, event: currentEvent as StreamEvent["event"], data }

          localStorage.setItem(
            `stream_cursor_${conversationId}`,
            String(currentSeq),
          )
        } catch {
          // ignore parse errors
        }
        currentEvent = ""
        currentData = ""
      }
    }
  }
}
```

### 7.4 断线自动重连

```typescript
async function streamWithReconnect(
  conversationId: number,
  question: string,
  onEvent: (event: StreamEvent) => void,
  skill?: string,
) {
  let lastEventId = parseInt(
    localStorage.getItem(`stream_cursor_${conversationId}`) || "0",
    10,
  )
  const isFirstCall = lastEventId === 0

  try {
    for await (const event of streamChat(
      conversationId,
      isFirstCall ? question : "",
      isFirstCall ? 0 : lastEventId,
      skill,
    )) {
      lastEventId = event.seq
      onEvent(event)

      if (event.event === "done" || event.event === "error") {
        localStorage.removeItem(`stream_cursor_${conversationId}`)
        return
      }
    }
  } catch (error) {
    console.error("Stream disconnected, lastEventId:", lastEventId)
    throw error
  }
}
```

### 7.5 解析 v2 StreamPart 数据

```typescript
function parseV2Chunk(data: StreamEvent["data"]): string {
  // v2 messages 类型：提取 LLM token 文本
  if (data.type === "messages" && Array.isArray(data.data)) {
    const [token, metadata] = data.data as [any, any]
    if (typeof token?.content === "string") return token.content
    if (Array.isArray(token?.content)) {
      return token.content
        .filter((c: any) => typeof c === "string")
        .join("")
    }
  }
  return ""
}

function parseV2Namespace(ns: string[]): {
  isSubagent: boolean
  source: string
} {
  const isSubagent = ns.some((s) => s.startsWith("tools:"))
  const source = isSubagent
    ? ns.find((s) => s.startsWith("tools:")) || "unknown"
    : "main"
  return { isSubagent, source }
}
```

---

## 8. 文件改动清单

| 文件 | 改动内容 | 阶段 |
|------|----------|------|
| `pyproject.toml` | 添加 `langgraph-checkpoint-sqlite` 依赖 | Phase 1 |
| `src/service/agent.py` | 替换 `MemorySaver` → `SqliteSaver`，添加 `get_checkpointer()` | Phase 1 |
| `src/core/config.py` | 添加 `checkpoint_path` 配置项（可选） | Phase 1 |
| `src/service/chat_service.py` | `stream_conversation_answer` 添加 `version="v2"`；`_try_extract_artifact` 改为处理 v2 dict；`_extract_text_from_chunk` 适配 v2；新增 `StreamEventBuffer` / `resume_stream` / `stream_after_resume` / `get_agent_checkpoint_state` | Phase 1+2+3 |
| `src/api/chat_api.py` | 新增 `resume_conversation_stream` / `approve_tool_call` / `get_checkpoint_state` 端点 | Phase 2+3 |
| `src/models/conversation.py` | `ConversationMessage` 添加 `stream_state` / `stream_cursor` / `stream_chunks` | Phase 2 |
| `src/db/init_db.py` | 添加 `ensure_column` 迁移 | Phase 2 |
| `src/schemas/conversation.py` | 新增 `ResumeStreamRequest` / `ToolCallDecision` | Phase 2+3 |
| 前端 streaming hooks | 改造 SSE 解析（适配 v2 StreamPart）+ 断线重连 | Phase 2 |

---

## 9. 风险与注意事项

| 风险 | 缓解措施 |
|------|----------|
| deepagents 0.5.3 + langgraph 1.1.6 + v2 组合未经验证 | Phase 1 首先单独测试 v2 流格式是否正常工作 |
| `SqliteSaver` 线程安全 | `check_same_thread=False` + 全局单例 |
| v2 格式下 `convert_to_serializable` 对 LangChain 对象的处理 | v2 chunk 的 `data` 字段内仍有 AIMessageChunk 等，现有递归序列化已覆盖 |
| `stream_chunks` 存储大消息 | 限制事件数量（如 500），超过阈值只保留最后 N 条 |
| 长时间无活动的 streaming 状态消息 | 定期扫描 `stream_state="streaming"` 且超过 10 分钟的消息，标记为 error |
| v1 → v2 前后端不兼容 | 前后端同时切换，旧客户端不升级会解析失败（建议版本号控制） |

---

## 10. 推荐实施顺序

1. **Phase 1 最小验证**：仅添加 `version="v2"` 到 `agent.astream()`，确认流正常输出
2. **Phase 1 Checkpointer**：替换 `MemorySaver` → `SqliteSaver`，测试重启恢复
3. **Phase 1 方法改造**：`_try_extract_artifact` / `_extract_text_from_chunk` 适配 v2 dict
4. **Phase 2 SSE 编号**：添加 `StreamEventBuffer`，改造输出格式
5. **Phase 2 重连 API**：添加 `resume_stream` 端点 + 数据库字段迁移
6. **前端对接**：改造 SSE 解析 + 断线重连
7. **Phase 3 HITL**：按业务需求决定

---

## 11. 测试验证

### 11.1 Phase 1：v2 格式验证

```bash
# 发起对话，检查返回的 chunk 结构
# v1: 返回 ["messages", {...}] 或 ["updates", {...}] 数组
# v2: 返回 {"type": "messages", "ns": [], "data": [...]} dict
curl -N -X POST http://localhost:58000/chat/conversations/{id}/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "你好"}'
# 观察输出中是否有 "type":"messages" 和 "ns" 字段
```

### 11.2 Phase 1：Checkpointer 持久化验证

```bash
# 1. 启动服务
uv run python start.py

# 2. 发起对话
curl -X POST http://localhost:58000/chat/conversations/{id}/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "我叫张三"}'

# 3. 重启服务

# 4. 同一 conversation_id 再问，验证上下文连续
curl -X POST http://localhost:58000/chat/conversations/{id}/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "我叫什么名字？"}'
# 预期：agent 能回答"张三"
```

### 11.3 Phase 2：SSE 事件编号 + 重连

```bash
# 1. 发起流式对话，观察 id 和 event 字段
curl -N -X POST http://localhost:58000/chat/conversations/{id}/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "写一个 hello world"}'
# 预期输出:
# id: 1:1
# event: chunk
# data: {"type":"messages",...}
#
# id: 1:2
# event: chunk
# data: {"type":"messages",...}

# 2. 记录最后一个 seq，模拟断线重连
curl -N -X POST http://localhost:58000/chat/conversations/{id}/stream/resume \
  -H "Content-Type: application/json" \
  -d '{"last_event_id": 15}'
# 预期：从 seq=16 开始重放，最后收到 event: done
```

### 11.4 Phase 3：HITL 验证

```bash
# 1. 触发 interrupt（写入文件时暂停）
curl -N -X POST http://localhost:58000/chat/conversations/{id}/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "帮我写一个 test.txt 文件"}'
# 预期：流暂停，返回 interrupt 信息

# 2. 查询 checkpoint 状态
curl http://localhost:58000/chat/conversations/{id}/checkpoint

# 3. 提交审批
curl -X POST http://localhost:58000/chat/conversations/{id}/approve \
  -H "Content-Type: application/json" \
  -d '[{"type": "approve"}]'
# 预期：恢复执行，返回后续流
```
