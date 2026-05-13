# LangGraph Checkpoint 恢复流迁移 PRD

> 版本：v1.0 | 日期：2026-05-12

## 1. 问题陈述

### 1.1 现状

`StreamRegistry` 在 LangGraph 之上维护了一套自定义流管理层：

```
StreamRegistry
├─ StreamEventBuffer (deque, max 5000)    ← 内存事件缓冲
├─ ActiveStreamTask                       ← 流任务状态
├─ ChunkJsonBuilder                       ← stream_chunks JSON 构建
├─ broadcast / subscribe                  ← SSE 事件广播/订阅
├─ cursor / seq 游标追踪                   ← 断线恢复游标
├─ _flush_to_db (每 20 条 / 2 秒)          ← DB 持久化
└─ _flush_terminal                        ← 流结束持久化
```

### 1.2 痛点

| # | 问题 | 影响 |
|---|------|------|
| 1 | **游标追踪复杂** | 前端 `_lastSeqByChat` + 后端 `buffer.cursor` 双重追踪，切换对话时游标竞争 |
| 2 | **buffer 溢出风险** | `maxlen=5000`，超出后 trim 老事件，游标低于 `_base_cursor` 时恢复漏事件 |
| 3 | **代码量大** | `stream_registry.py` 769 行，buffer/subscriber/cursor 逻辑与 LangGraph 职责重叠 |
| 4 | **二次 resume 循环** | `onFinish → invalidateQueries → useEffect → setMessages → resumeStream` 重复渲染 |
| 5 | **内存占用** | 每次对话 5000 条事件 × N 个并发对话 |

### 1.3 机会

LangGraph 内建 `AsyncSqliteSaver` —— **项目已配置**，`thread_id = conversation_id`。调用 `agent.astream()` 时传入相同 `thread_id`，LangGraph 自动从上次 checkpoint 恢复执行。这套机制可以直接替代 `StreamRegistry` 的 buffer/replay 层。

---

## 2. 目标架构

### 2.1 核心变化

```
┌────────────────── 当前 ──────────────────┐
│                                          │
│  agent.astream()                         │
│       ↓                                  │
│  StreamRegistry.start()                  │
│       ↓                                  │
│  _run_agent_background                   │
│    ├─ chunk → buffer.add → broadcast     │
│    ├─ chunk_builder.add                  │
│    ├─ _flush_to_db (增量)                 │
│    └─ _flush_terminal (结束)              │
│                                          │
│  resume: buffer.get_events_after(cursor) │
│          → subscribe → queue loop        │
│                                          │
└──────────────────────────────────────────┘

┌────────────────── 目标 ──────────────────┐
│                                          │
│  ChatService._run_agent_stream()         │
│    ├─ agent.astream(thread_id)           │
│    ├─ chunk → queue.put                 │
│    ├─ _flush_to_db (增量, 保留)           │
│    └─ _flush_terminal (结束, 保留)        │
│                                          │
│  resume: cancel task → 重新 astream()    │
│          → LangGraph checkpoint 恢复     │
│          → queue.put 新事件              │
│                                          │
└──────────────────────────────────────────┘
```

### 2.2 删除的组件

- `StreamEventBuffer` — LangGraph checkpoint 替代
- `ActiveStreamTask` — `asyncio.Task` + `asyncio.Queue` 替代
- `ChunkJsonBuilder` — 简化为朴素列表
- `broadcast / subscribe` — `asyncio.Queue` 替代
- `cursor / seq / base_cursor` — 不再需要
- `get_events_after(cursor)` — 不再需要

### 2.3 保留的组件

| 组件 | 说明 |
|------|------|
| `AsyncSqliteSaver` | 已有，全局 checkpointer |
| `_flush_to_db` | DB 持久化 `stream_state`/`content`/`stream_chunks`/`stream_cursor`/`message_parts` |
| `_flush_terminal` | 流结束持久化 + `message_parts` 提取 |
| `_finalize_task_stream` | 写 `TaskExecutionLog` |
| `ConversationMessage` 模型 | 不变 |
| `ConversationMessageRead` schema | 不变 |
| `message_parts_extractor.py` | 不变 |

---

## 3. 详细设计

### 3.1 后端：`chat_service.py` 重构

#### 3.1.1 新增模块级状态

```python
# chat_service.py 顶部
_agent_tasks: dict[int, asyncio.Task] = {}        # conversation_id → agent asyncio task
_stream_queues: dict[int, asyncio.Queue] = {}     # conversation_id → SSE event queue
```

#### 3.1.2 `stream_conversation_answer()` 新流程

```python
async def stream_conversation_answer(db, conversation_id, question, ...):
    # 1. 加载历史 + 保存用户消息 (不变)
    # 2. 创建 assistant 占位消息 (不变)
    # 3. 构建 agent (不变)
    
    # 4. 检查是否已有活跃任务
    if conversation_id in _agent_tasks and not _agent_tasks[conversation_id].done():
        yield error("当前会话已有正在执行的任务")
        return
    
    # 5. 创建 queue 并启动后台 agent loop
    queue = asyncio.Queue()
    _stream_queues[conversation_id] = queue
    assistant_msg.stream_state = "streaming"
    db.commit()
    
    task = asyncio.create_task(
        _run_agent_background(db, conversation_id, agent, messages, 
                              config, stream_msg_id, ...)
    )
    _agent_tasks[conversation_id] = task
    
    # 6. 从 queue 消费事件 → yield SSE
    try:
        while True:
            evt = await asyncio.wait_for(queue.get(), timeout=30.0)
            if isinstance(evt, dict) and evt.get("_terminal"):
                yield evt["_payload"]
                break
            yield evt
    finally:
        # 清理
        _stream_queues.pop(conversation_id, None)
        _agent_tasks.pop(conversation_id, None)
```

#### 3.1.3 `_run_agent_background()` 新实现

```python
async def _run_agent_background(db, conversation_id, agent, messages, 
                                config, stream_msg_id, ...):
    """从 chat_service 独立出来，在后台 asyncio task 中运行"""
    from src.db.session import get_session_local
    from src.service.message_parts_extractor import extract_message_parts
    
    db = get_session_local()()
    queue = _stream_queues.get(conversation_id)
    
    chunk_items = []       # 朴素列表替代 ChunkJsonBuilder
    assistant_text_parts = []
    latest_updates_text = None
    last_flush_time = time.monotonic()
    
    try:
        _agent_it = agent.astream(
            {"messages": messages},
            stream_mode=["messages", "updates", "custom"],
            config=config,
            version="v2",
        ).__aiter__()
        
        while True:
            chunk = await asyncio.wait_for(_agent_it.__anext__(), 
                                           timeout=AGENT_CHUNK_TIMEOUT)
            
            serializable = ChatService.convert_to_serializable(chunk)
            
            # custom tool_output 事件 → 直接入队 + 不存档
            if is_tool_output_event(serializable):
                queue.put_nowait(json.dumps(serializable))
                continue
            
            # 提取文本
            text = ChatService._extract_text_from_chunk(serializable)
            if text:
                assistant_text_parts.append(text)
            
            # 存档 + 入队
            chunk_items.append(serializable)
            queue.put_nowait(json.dumps(serializable, ensure_ascii=False, default=str))
            
            # 周期性 flush
            if len(chunk_items) >= FLUSH_INTERVAL or \
               time.monotonic() - last_flush_time >= FLUSH_INTERVAL_SECS:
                stream_json = json.dumps(chunk_items, ensure_ascii=False, default=str)
                await _flush_to_db(db, stream_msg_id, state=None, content=None,
                                   stream_json=stream_json)
                last_flush_time = time.monotonic()
        
    except StopAsyncIteration:
        # 正常结束
        final_text = latest_updates_text or "模型已完成调用。"
        stream_json = json.dumps(chunk_items, ensure_ascii=False, default=str)
        
        message_parts_json = None
        if stream_json:
            parts = extract_message_parts(stream_json)
            if parts:
                message_parts_json = json.dumps(parts, ensure_ascii=False)
        
        await _flush_to_db(db, stream_msg_id, state="completed", content=final_text,
                           stream_json=stream_json, message_parts=message_parts_json)
        queue.put_nowait({"_terminal": True, "_payload": "data: [DONE]\n\n"})
        
    except asyncio.CancelledError:
        # 用户取消 → 保留 checkpoint (LangGraph 自动处理)
        partial_text = latest_updates_text or None
        await _flush_to_db(db, stream_msg_id, state="cancelled", content=partial_text,
                           stream_json=stream_json)
        queue.put_nowait({"_terminal": True, "_payload": "data: [DONE]\n\n"})
        
    except Exception as e:
        await _flush_to_db(db, stream_msg_id, state="error", content=partial_text,
                           stream_json=stream_json, error_message=str(e))
        queue.put_nowait({"_terminal": True, 
                          "_payload": f"data: {json.dumps({'error': str(e)})}\n\ndata: [DONE]\n\n"})
    finally:
        if _agent_it:
            try: await _agent_it.aclose()
            except: pass
        db.close()
```

#### 3.1.4 `resume_conversation_stream()` 新实现

```python
async def resume_conversation_stream(db, conversation_id, debug_content_only=False):
    """恢复：cancel 当前 task → 等 LangGraph checkpoint → 重新 astream"""
    
    # 1. 取消当前 task
    current_task = _agent_tasks.get(conversation_id)
    if current_task and not current_task.done():
        current_task.cancel()
        try:
            await current_task  # 等待 CancelledError 处理完成
        except asyncio.CancelledError:
            pass
    
    # 2. 短暂延迟，等 LangGraph flush checkpoint
    await asyncio.sleep(0.1)
    
    # 3. 重新构建 agent
    msg = ChatService._get_last_assistant_message(db, conversation_id)
    if not msg:
        yield error("无法恢复：未找到会话消息")
        return
    
    conversation = ChatService.get_conversation(db, conversation_id)
    agent = ChatService._build_agent(db, conversation)
    history = ChatService._load_history_for_agent(db, conversation_id, limit=30)
    
    # 4. 不传消息，让 LangGraph 从 checkpoint 恢复
    #    如果传 [] 或传历史，LangGraph 根据 checkpointer 决定从哪续执行
    queue = asyncio.Queue()
    _stream_queues[conversation_id] = queue
    msg.stream_state = "streaming"
    db.commit()
    
    config = {"configurable": {"thread_id": conversation_id}}
    task = asyncio.create_task(
        _run_agent_background(db, conversation_id, agent, None,  # messages=None
                              config, msg.id, ...)
    )
    _agent_tasks[conversation_id] = task
    
    # 5. yield SSE 事件
    try:
        while True:
            evt = await asyncio.wait_for(queue.get(), timeout=30.0)
            if isinstance(evt, dict) and evt.get("_terminal"):
                yield evt["_payload"]
                break
            yield evt
    finally:
        _stream_queues.pop(conversation_id, None)
        _agent_tasks.pop(conversation_id, None)
```

**关键点**：第 4 步把 `messages` 设为 `None` 或空列表。LangGraph 检测到已存在的 `thread_id` + checkpoint → 忽略传入的 messages，从上次 checkpoint 恢复执行。

#### 3.1.5 `cancel_conversation_stream()` 简化

```python
def cancel_conversation_stream(conversation_id: int) -> bool:
    task = _agent_tasks.get(conversation_id)
    if task and not task.done():
        task.cancel()
        return True
    return False
```

### 3.2 后端：`agent.py` 修改

在 `get_agent()` 和 `get_orchestrator_agent()` 返回的 agent 中加 `interrupt_before=["tools"]`：

```python
# agent.py get_agent() 中
agent = create_deep_agent(
    ...,
    checkpointer=checkpointer,
    interrupt_before=["tools"],  # ← 新增：工具执行前暂停，防重复执行
)
```

**效果**：agent 调用工具前 `astream()` yield `interrupt` 事件 → 用户断连重连时，从 checkpoint 恢复 → 跳过已完成的 reasoning，停在工具调用前 → 工具只执行一次。

### 3.3 后端：`stream_registry.py` 简化

| 删除 | 保留 |
|------|------|
| `ChunkJsonBuilder` | `_flush_to_db` → 移入 `chat_service.py` |
| `StreamEventBuffer` | `_flush_terminal` → 移入 `chat_service.py` |
| `ActiveStreamTask` | `_finalize_task_stream` |
| `subscribe` / `unsubscribe` / `broadcast` | `cleanup_zombie_executions` |
| `start()` / `cancel()` / `get_task()` / `is_active()` | |
| `_run_agent_background()` | |
| `_flush_heartbeat()` | |
| `registry` singleton | |
| `cursor` / `seq` 全部 | |

**目标**：`stream_registry.py` 缩减到 ~150 行，只保留 DB 持久化和任务日志逻辑。

### 3.4 前端：`langchain-chat-transport.ts` 简化

```typescript
// 删除
private _lastSeqByChat = new Map<string, number>()
setLastSeq()                           // 移除
cancelPreviousReconnect()              // 移除 (不再有 reconnect 竞争)
reconnectToStream()                    // 移除
buildResumeApiUrl()                    // 移除
createResumeEventSourceResponse()      // 移除
```

**新 resume 流程**：
```typescript
// 前端不再调用 resumeStream() → reconnectToStream()
// 改为：调用 sendMessage({text: ''}, {body: {conversationId, resume: true}})
// 后端检测 resume=true → 走 resume_conversation_stream()
```

### 3.5 前端：`chat-conversation-view.tsx` 简化

```typescript
// 删除
setLastSeq(String(conversationId), lastStored.streamCursor)  // 不再追踪游标
resumeStream()            // 不再调用 resume
resume useEffect 整个删除  // 不再需要
```

**新流程**：检测到 `streamState === "streaming"` → 不特殊处理，`initialMessages` 包含方案B 提取的 `message_parts` → 调用 `sendMessage({text: ''}, {resume: true})` 触发后端恢复。

---

## 4. DB Schema 变更

| 操作 | 列 | 说明 |
|------|-----|------|
| **删除** | `stream_cursor` | 不再用游标追踪 |
| **保留** | `stream_state` | 仍需要 (`streaming`/`completed`/`cancelled`/`error`) |
| **保留** | `stream_chunks` | `message_parts` 提取 + 历史回放 |
| **保留** | `message_parts` | UI 渲染 |
| **保留** | `content` | 纯文本降级 |
| **保留** | `chunk_json` | 旧格式兼容 |

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| **工具重复执行** | 中 | 高：重复写文件/执行脚本 | `interrupt_before=["tools"]` 在工具前暂停 |
| **checkpoint 膨胀** | 低 | 中：DB 文件变大 | `AsyncSqliteSaver` 支持设置 `max_checkpoints` |
| **SSE 顺序问题** | 低 | 中：事件顺序打乱 | `asyncio.Queue` 保证 FIFO |
| **断连恢复慢** | 低 | 低：checkpoint 恢复比 buffer replay 慢几百 ms | 延迟在用户可接受范围 |
| **兼容性** | 低 | 高：旧 `stream_cursor` 值无意义 | `stream_cursor` 废弃，旧数据不影响 |

---

## 6. 迁移步骤

### Phase 1：后端核心重构（不拆前端）

1. `chat_service.py`：新增 `_agent_tasks`、`_stream_queues`、`_run_agent_background()`、重写 `stream_conversation_answer()`、`resume_conversation_stream()`
2. `agent.py`：加 `interrupt_before=["tools"]`
3. `stream_registry.py`：删除 buffer/subscriber/cursor 代码，保留持久化函数
4. 验证：启动服务 → 发起对话 → 断连（关 SSE）→ 重连 → 确认恢复

### Phase 2：前端简化

1. `langchain-chat-transport.ts`：删除 `_lastSeqByChat`、`reconnectToStream`、cursor 逻辑
2. `chat-conversation-view.tsx`：删除 `setLastSeq`、resume useEffect
3. 新增 resume API 调用（通过 `sendMessage` body 标记）
4. 验证：端到端恢复流测试

### Phase 3：清理

1. 删除 `stream_registry.py` 中剩下的冗余代码
2. 清理 `stream_cursor` 列（标记 deprecated，不立即删除）
3. 清理前端 `streamCursor` 字段（保留接口兼容，值为 0）

---

## 7. 成功指标

- [ ] `StreamRegistry` 从 769 行缩减到 ~150 行
- [ ] `chat-conversation-view.tsx` resume useEffect 删除
- [ ] 前端 `< 50 行` cursor 追踪逻辑删除
- [ ] 断连重连正常恢复，无事件丢失
- [ ] 工具不会因断连重连被重复执行
- [ ] `message_parts` 提取和 UI 渲染不变
- [ ] 存量对话兼容（stream_cursor 废弃但不报错）
