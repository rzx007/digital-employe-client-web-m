# AI 对话可恢复流架构

## 一、概述

可恢复流（Resumable Stream）是数字员工客户端 AI 对话模块的核心基础设施。它基于 SSE (Server-Sent Events) 协议，实现 LLM 流式输出的断线重连、中途取消和数据持久化。后续多会话并发、技能对话等特性均构建在此之上。

### 设计目标

| 目标 | 说明 |
|------|------|
| **可恢复** | 前端断线后从指定 `cursor` 续传，不丢事件 |
| **可取消** | 用户可随时中止，数据不丢失 |
| **可持久** | 中间态不断落 DB，前端随时可拉取部分结果 |
| **轻内存** | Buffer 有上限（5000 event），溢出后自动剪裁，冷路径走 DB |
| **不阻塞** | JSON 序列化在 `asyncio.to_thread` 中执行，事件循环不卡顿 |

---

## 二、核心组件

```
┌──────────────────────────────────────────────────────────────┐
│                       StreamRegistry                         │
│                     (module singleton)                       │
│  _tasks: dict[conversation_id → ActiveStreamTask]            │
│                                                              │
│  ┌──────────────── ActiveStreamTask ────────────────────┐    │
│  │ status: "streaming" | "completed" | "cancelled" |    │    │
│  │         "error"                                       │    │
│  │ buffer: StreamEventBuffer                             │    │
│  │          _events: deque[{seq, data}]  maxlen=5000     │    │
│  │          base_cursor: int                             │    │
│  │ subscribers: set[callback]                            │    │
│  │ _asyncio_task: asyncio.Task                           │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────── DB 持久化 ────────────────────────────┐    │
│  │ ConversationMessage (一行)                             │    │
│  │   stream_state: "streaming" | "completed" | ...       │    │
│  │   stream_cursor: int  ← 最新 flush 到的 event seq      │    │
│  │   chunk_json: str     ← [data, data, ...] 渐进更新     │    │
│  │   stream_chunks: str  ← [{seq,data},...] 含真实seq     │    │
│  │   content: str        ← 最终文本（终态时写入）          │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### ChunkJsonBuilder

增量构建 `chunk_json`（前端兼容格式）和 `stream_json`（冷路径回放格式），O(1) 序列化：

```
add({seq:42, data:{...}})
  → _data_parts:  ['"你好"', '"世界"', ...]          → to_chunk_json()  → ["你好","世界",...]
  → _event_parts: ['{"seq":1,"data":"你好"}', ...]   → to_stream_json() → [{"seq":1,"data":"你好"},...]
```

- `to_chunk_json()` — `[data1, data2, ...]` 格式，前端渲染使用
- `to_stream_json()` — `[{"seq":N,"data":...}, ...]` 格式，冷路径回放使用（含真实 seq）

### StreamEventBuffer

```
add(data) → {seq: self._seq++, data}
trim()    → 超过 maxlen 时 popleft，更新 base_cursor
get_events_after(cursor) → [e for e in _events if e.seq > cursor]
```

---

## 三、状态机

```
                        [start]
                          │
                          ▼
                      streaming
                      /  |    \
               complete  |     error
                  │       │       │
                  ▼       ▼       ▼
              completed cancelled error
```

- `streaming`：后台 agent 正在执行
- `completed`：正常结束
- `cancelled`：用户取消
- `error`：异常或超时

所有判断统一用 `task.status != "streaming"`，**不再另设 `completed` 布尔字段**。

---

## 四、API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/chat/conversations/{id}/stream` | **启动新对话流**（SSE 响应） |
| `GET` | `/chat/conversations/{id}/stream/resume?cursor=N` | **恢复流**，从指定 cursor 续传 |
| `POST` | `/chat/conversations/{id}/stream/cancel` | **取消流**（无 DB 依赖） |

### 4.1 POST /stream

```
1. _append_message(role="user")
2. _append_message(role="assistant", content="")   ← 占位，不设 stream_state
3. registry.start() → asyncio.create_task(background)
   ├─ 成功 → assistant_msg.stream_state = "streaming" → commit
   └─ 失败 → assistant_msg.stream_state = "error" → commit → 返回 error SSE
4. resume_conversation_stream() → yield SSE events
```

### 4.2 GET /stream/resume?cursor=N

```
get_stream_status()
 ├─ 已结束 → stream_ended + cursor + [DONE]
 └─ 未结束 →
    get_task()
     ├─ 无活跃 task →
     │   └─ DB stale detection → 自动修复或 no_stream + [DONE]
     └─ task.is_active →
         ├─ cursor < buffer.base_cursor → 冷路径
         │   json.loads(DB stream_chunks) → 使用真实 seq 回放
         │   每个 event 前检查 task.status（cancel 时秒停）
         │   last_seq = base_cursor
         ├─ cursor >= buffer.base_cursor → 热路径
         │   buffer.get_events_after(cursor) → 直接内存回放
         └─ subscribe → queue loop → 实时 event → [DONE]
```

**冷路径**对前端透明，SSE 格式完全一致。

### 4.3 POST /cancel

```
task.status = "cancelled"
task._asyncio_task.cancel()
→ 后台 CancelledError → flush_terminal(state="cancelled", chunk_json, stream_json)
→ buffer.add({"status":"cancelled"}) → broadcast → 挂起 resume 收到 [DONE]
→ finally: task.status = "cancelled" → subscribers.clear()
```

---

## 五、后台任务流程 (`_run_agent_background`)

```
db = get_session_local()()     ← 独立 DB session（与 SSE 的 Depends(get_db) 分离）
chunk_builder = ChunkJsonBuilder()

while agent.astream().__anext__():    ← 每 120s 超时
    serializable = convert(chunk)
    evt = buffer.add(serializable)
    chunk_builder.add(evt)
    broadcast(evt)

    每 20 事件 / 2s：_maybe_flush()
        chunk_json  = chunk_builder.to_chunk_json()     ← O(1) 前端渲染格式
        stream_json = chunk_builder.to_stream_json()    ← O(1) 冷路径回放格式
        _flush_to_db(chunk_json=chunk_json,             ← 渐进写 DB
                     stream_json=stream_json)
        if ok: buffer.trim()                            ← 安全剪裁

终态：
    _flush_terminal(state, content, chunk_json, stream_json, retry=3)
    buffer.add({"status": state})
    broadcast → 挂起 resume 收到 [DONE]

finally:
    task.status = state_final
    subscribers.clear()
    db.close()
```

### DB 列说明

| 列名 | 写入时机 | 格式 | 用途 |
|------|----------|------|------|
| `chunk_json` | 每次 flush + 终态 | `[data1, data2, ...]` | 前端渲染（`mapStoredMessagesToUIMessages`） |
| `stream_chunks` | 每次 flush + 终态 | `[{"seq":N,"data":...}, ...]` | 冷路径回放（含真实 seq） |
| `stream_cursor` | 每次 flush + 终态 | `int` | 最新已持久化的 seq |
| `stream_state` | start / 终态 | `"streaming"` / `"completed"` / ... | 流状态 |
| `content` | 终态 | `str` | 最终回复文本 |

---

## 六、SSE 协议

### 事件格式

```
id: 42
data: {"__type__":"AIMessageChunk","content":"你好",...}

id: 43
data: {"status":"completed"}

data: [DONE]
```

| 字段 | 说明 |
|------|------|
| `id:` | 事件序号（seq），前端用于断线重连时传 `cursor` |
| `data:` | 内容不变，`json.dumps` 在 `asyncio.to_thread` 中执行 |
| `[DONE]` | 流结束标记 |

### 管理事件

```json
{"type":"stream_ended","data":{"status":"completed","error":null,"cursor":150}}
{"type":"no_stream","data":{"message":"无可恢复的流"}}
```

---

## 七、前端使用指南

### 7.1 SSE 协议兼容性

**改前 → 改后**（前端只需要多解析一个 `id:` 场）：

```
改前:
  data: {"__type__":"AIMessageChunk","content":"你好"}\n\n

改后:
  id: 42
  data: {"__type__":"AIMessageChunk","content":"你好"}\n\n
```

- `data:` 内容格式**完全不变**，现有解析代码零改动
- `id:` 是标准 SSE 字段，值为事件序号（seq）
- 终端事件同样带 `id:`：`id: 43\ndata: [DONE]`
- 管理事件（`stream_ended` / `no_stream`）不带 `id:`，但在 `stream_ended.data` 中有 `cursor` 字段

### 7.2 新对话

```
1. POST /chat/conversations/{id}/stream
   body: { skill, question, debug_content_only, extra_meta }
   → 返回 SSE text/event-stream

2. 解析 SSE 事件:
   ┌─ id: <n>    → lastSeq = parseInt(id)   // 记录当前 seq
   └─ data: {...} → 跟现有逻辑一样解析渲染

3. 收到 data: [DONE] → 对话结束，lastSeq 是最终位置
```

### 7.3 恢复对话（断线重连 / 页面切回）

```
1. GET /chat/conversations/{id}/messages
   → 返回历史消息列表，assistant 消息含 chunk_json、stream_cursor
   → chunk_json 不再是恒定 null，流运行中就有部分数据，可直接渲染

2. GET /chat/conversations/{id}/stream/resume?cursor={lastSeq}
   → 返回 SSE 流，从上次断点续传
   → 如果不传 cursor（默认 0），功能正确但性能差（走 DB 全量回放）

3. 解析 SSE 事件（同 7.2）

4. 响应可能的情况:
   ┌─ stream_ended  → 对话已结束，data.cursor 是最后位置
   └─ no_stream     → 无活跃流
```

### 7.4 中止对话

```
POST /chat/conversations/{id}/stream/cancel
→ 200: 取消成功
→ SSE 端随后收到 [DONE]
```

### 7.5 前端适配清单

| 序号 | 改动 | 是否必须 |
|------|------|----------|
| 1 | 解析 SSE `id:` 场，存 `lastSeq` | **必须** |
| 2 | resume 时传 `GET /resume?cursor={lastSeq}` | **必须** |
| 3 | `stream_ended` 中读取 `data.cursor` | 建议 |
| 4 | `data:` 解析、渲染逻辑 | **不需要改** |
| 5 | `/messages`、`POST /stream` 调用方式 | **不需要改** |
| 6 | SSE 连接管理、取消逻辑 | **不需要改** |

### 7.6 关键行为约定

| 情况 | 行为 |
|------|------|
| 不传 `cursor`（默认 0） | 后端从头回放所有事件（DB → 内存），功能正确但性能较差 |
| 传正确 `cursor` | 直接走内存快路径，毫秒级恢复 |
| `cursor` 过期（断线太久，buffer 已剪裁） | 后端自动从 DB stream_chunks 冷路径回放（含真实 seq），**前端无感知** |
| chunk_json 在流中不为 null | `/messages` 拉到中间态数据可直接渲染，不再是空白等待 |

---

## 八、数据一致性保证

| 场景 | 保证 |
|------|------|
| start 失败 | 消息标记 `stream_state="error"`，无僵尸 |
| 中间 flush 失败 | 下次 flush 重写，buffer 不剪裁直到 DB 成功 |
| 终态 flush 失败 | `_flush_terminal` 重试 3 次（间隔 0.3s） |
| cancel 与 DB 竞态 | `task.status` 只在 finally 中设终态，确保 chunk_json 先落盘 |
| buffer 剪裁 | 只在 flush DB 成功后才 trim |
| 服务重启 | shutdown 时 cancel 所有 active task，保证 flush 完成 |
| 多会话并发 | WAL 模式，写不阻塞读 |

---

## 九、关键配置

| 常量 | 值 | 位置 |
|------|------|------|
| `FLUSH_INTERVAL_EVENTS` | 20 | `stream_registry.py` |
| `FLUSH_INTERVAL_SECONDS` | 2.0 | `stream_registry.py` |
| `TASK_TTL_SECONDS` | 300（5 分钟） | `stream_registry.py` |
| `BUFFER_MAXLEN` | 5000 | `stream_registry.py` |
| `AGENT_CHUNK_TIMEOUT` | 120s | `stream_registry.py` |
| `WAL` + `busy_timeout=5000` | 每次连接 | `db/session.py` |

---

## 十、文件索引

| 文件 | 职责 |
|------|------|
| `src/service/stream_registry.py` | StreamRegistry、ActiveStreamTask、StreamEventBuffer、ChunkJsonBuilder、后台任务 |
| `src/service/chat_service.py` | stream_conversation_answer()、resume_conversation_stream()、cancel_conversation_stream() |
| `src/api/chat_api.py` | REST API 路由 |
| `src/models/conversation.py` | ConversationMessage ORM 模型 |
| `src/schemas/conversation.py` | Pydantic schema（含 stream_cursor） |
| `src/db/session.py` | SQLite engine（WAL + busy_timeout） |
| `src/server.py` | FastAPI lifespan（shutdown 清理） |

---

## 十一、恢复流完整流程图

```
                     后端可恢复流 (Resumable Stream) 完整流程
 ─────────────────────────────────────────────────────────────────────────────

  请求: GET /chat/conversations/{id}/stream/resume?cursor=N
                                │
                                ▼
              ┌─────────────────────────────────┐
              │  resume_conversation_stream()    │
              │  chat_service.py:429            │
              └──────────────┬──────────────────┘
                             │
                             ▼
              ┌─────────────────────────────────┐
              │  registry.get_stream_status()   │──── 从 DB 查询 stream_state
              │  (已结束的流直接返回)              │     (completed/error/cancelled)
              └──────────────┬──────────────────┘
                             │
                    已结束? ──┤── 否
                    │        │
                    ▼        ▼
          ┌──────────┐   ┌──────────────────────────────┐
          │ SSE:     │   │  registry.get_task(id)        │
          │ stream_  │   │  查找内存中的 ActiveStreamTask  │
          │ ended    │   └──────────────┬───────────────┘
          │ [DONE]   │                  │
          └──────────┘        Task存在? ├── 否
                               │       │
                              是       ▼
                               │   ┌──────────────────────────┐
                               │   │ DB: 查 stream_state       │
                               │   │ == "streaming" 的消息      │
                               │   │                           │
                               │   │  有 ──→ 自动修复为 "error"  │
                               │   │         返回 stream_ended │
                               │   │  无 ──→ 返回 no_stream    │
                               │   └──────────────────────────┘
                               │
                               ▼
              ┌─────────────────────────────────────────┐
              │  有活跃的 ActiveStreamTask               │
              │  task.is_active == True                  │
              │  last_seq = cursor (客户端传来的游标)      │
              └──────────────────┬──────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────┐
              │  Phase 1: 冷路径 (Cold Path)              │
              │                                          │
              │  条件: cursor < buffer.base_cursor        │
              │  含义: 客户端缺失的事件已被 trim 出内存     │
              │                                          │
              │  优先: 从 DB 读取 msg.stream_chunks       │
              │        格式: [{"seq":N,"data":...}, ...]  │  ← 含真实 seq
              │                                          │
              │  兼容回退: 若 stream_chunks 为空           │
              │           使用旧 chunk_json (i+1 伪 seq)  │
              │                                          │
              │  for evt in stream_chunks:                │
              │    if evt.seq <= last_seq: skip           │
              │    if evt.seq > base_cursor: break        │
              │    yield SSE event                        │
              └──────────────────┬───────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────┐
              │  Phase 2: 内存 Buffer 扫描                │
              │                                          │
              │  buffer_events = buffer.get_events_after  │
              │                  (last_seq)               │
              │                                          │
              │  ┌─────────────────────────────┐         │
              │  │  StreamEventBuffer (内存)     │         │
              │  │  deque: [evt5, evt6, evt7..] │         │
              │  │  base_cursor = 4 (已trim)    │         │
              │  │  cursor = 7 (当前最新seq)     │         │
              │  └─────────────────────────────┘         │
              │                                          │
              │  遍历 buffer_events, yield SSE            │
              └──────────────────┬───────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────┐
              │  Phase 3: 订阅实时事件                     │
              │                                          │
              │  queue = asyncio.Queue()                 │
              │                                          │
              │  ① task.subscribe(_on_event)              │
              │     │                                    │
              │     │  注册回调: 新事件 → queue.put()      │
              │     │                                    │
              │  ② missed = buffer.get_events_after       │
              │             (last_seq)                    │
              │     │                                    │
              │     │  补漏: subscribe 和 scan 之间         │
              │     │        可能到达的新事件               │
              │     │                                    │
              │  ③ yield missed events                    │
              └──────────────────┬───────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────┐
              │  Phase 4: 实时 Queue 循环                 │
              │                                          │
              │  while True:                              │
              │    evt = await queue.get()               │
              │                                          │
              │    if 终止事件(completed/cancelled/error):  │
              │      yield → unsubscribe → break         │
              │    else:                                  │
              │      yield SSE: id:{seq}\ndata:{json}\n\n │
              └──────────────────┬───────────────────────┘
                                 │
                                 ▼
                           ┌──────────┐
                           │ 结束流    │
                           │ [DONE]   │
                           └──────────┘


 ─────────────────────────────────────────────────────────────────────────────

  后台 Agent 执行 (_run_agent_background) 并发写入:

  ┌──────────────────────────────────────────────┐
  │  agent.astream() ──→ chunk ──→ serializable  │
  │                         │                    │
  │                         ▼                    │
  │               buffer.add(data)               │
  │               chunk_builder.add(evt)         │
  │               broadcast(evt)  ───→ subscribers│
  │                         │                    │
  │                         ▼ (每20事件/每2秒)    │
  │               _maybe_flush()                 │
  │                 │                             │
  │                 ▼                             │
  │               _flush_to_db()                 │
  │                 ├─ chunk_json = [data,...]    │  ← 前端渲染用
  │                 ├─ stream_chunks = [{seq,data}]│  ← 冷路径回放用
  │                 ├─ stream_cursor = buffer.seq │
  │                 └─ stream_state = "streaming" │
  │                         │                    │
  │                         ▼                    │
  │               buffer.trim()                  │
  │                 └─ 淘汰超出 maxlen 的旧事件    │
  │                    更新 base_cursor           │
  └──────────────────────────────────────────────┘


 ─────────────────────────────────────────────────────────────────────────────

  数据生命周期 (事件 seq):

  时间 ──────────────────────────────────────────────────────►

  Agent 产生:  seq1  seq2  seq3 ... seq20  seq21  seq22  seq23
                  │                       │
                  ▼                       ▼
  buffer trim:  [seq1..seq20] trim!     [seq21..seq23] 仍在内存
                  │                       │
                  ▼                       │
  DB flush:     stream_chunks =          │
                [{seq:1,data},            │
                 {seq:2,data},            │
                 ...                      │
                 {seq:20,data}]           │
                                        base_cursor = 20
                  │                       │
                  ▼                       ▼
  Resume 场景:                        客户端 cursor=15
                                      (断线前最后收到的 seq)

    Phase 1 冷路径:                   Phase 2 Buffer:
    从 stream_chunks                  从内存 buffer
    replay seq 16..20                 replay seq 21..23
    (seq<=15 跳过, >20 break)
                  │                       │
                  └───────────┬───────────┘
                              ▼
                    Phase 3+4: 订阅实时
                    seq 24, 25, 26 ...
                              │
                              ▼
                          客户端完整恢复
                          无遗漏 无重复
```
