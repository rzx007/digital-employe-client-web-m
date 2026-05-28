# 总管委派时 SSE 串流问题（Orchestrator / Employee Stream Isolation）

## 一、概述

当总管助手（Curator）在**同一条 SSE 连接**（例如 `GET /chat/conversations/187/stream`）上执行编排并 `confirm` 委派子任务时，曾出现**员工会话**（例如 `#188`）的 LangGraph `messages` 事件混入总管 SSE，导致总管聊天区展示员工的 `read_file`、`shell_execute`、技能全文等工具步骤。

本文记录现象、根因、修复与验证方法，供后续改委派、流式或 LangGraph 升级时对照。

### 相关文档

| 文档 | 关系 |
|------|------|
| [可恢复流架构](./resumable-stream-architecture.md) | `StreamRegistry`、buffer、resume 机制 |
| [HITL 架构](./hitl-architecture.md) | 总管/员工 agent 工具与人机协同 |

### 关键代码

| 路径 | 说明 |
|------|------|
| `src/service/stream_registry.py` | 按 `conversation_id` 隔离 buffer；`_run_agent_background` 消费 `agent.astream()` |
| `src/service/agent/orchestrator/execution.py` | `confirm` → `start_task_as_conversation`；**等总管流结束再 `registry.start(员工)`** |
| `src/service/agent/orchestrator/tools.py` | `confirm_orchestration_plan` / `list_tasks` |
| `src/service/agent/orchestrator/prompts.py` | 委派后禁止轮询、禁止代员工执行 |
| `apps/web/src/components/chat/curator/curator-view.tsx` | 总管时间线：`messages` + `ExecutionReportCard`（`executions` API） |

---

## 二、现象

### 用户可见

- 总管对话气泡内出现本应在**员工会话**里的内容：读 `hot-news` SKILL、`shell_execute`、完整热搜榜单等。
- 与产品预期不符：总管区应主要为**编排卡片 + 简短委派说明**；员工结果应通过 **`ExecutionReportCard`**（`executions?orchestrator_conversation_id=`）展示。

### SSE 日志特征（实锤）

在**仅抓取总管会话**的 SSE 文件中（例如 `POST/GET /chat/conversations/187/stream`）：

1. 同一递增 `id` 序列内，`metadata.thread_id` 从 **187** 变为 **188**。
2. 典型转折点：`confirm_orchestration_plan` 返回「已启动（会话 #188）」且 `list_tasks` 仍为 `thread_id: 187` 之后，下一条即为 `thread_id: 188` 的 model chunk（如「我先读取 hot-news 技能…」）。
3. chunk 内 `thread_id` **标注正确**（指向真实 run），却出现在 **187 的 HTTP 响应体**中。

说明：不是前端订错流、也不是 registry 把 188 的 buffer 写到 187 的 key，而是 **187 的 `astream` 迭代器消费到了 188 run 的事件**，再经 `buffer.add` 进入 187 SSE。

### 已排除的假设

| 假设 | 结论 |
|------|------|
| `StreamRegistry` 路由错误 | 否。每个会话独立 `ActiveStreamTask` / buffer。 |
| `orchestrator_conversation_id` 参与 SSE 路由 | 否。仅用于执行日志与 ContextVar。 |
| 员工图作为总管 subgraph 同步执行 | 否。员工为 `registry.start(employee_conv_id)` 独立后台任务。 |
| 前端合并多条 SSE | 否。原始抓包即为单会话 187。 |

员工会话 **188 的 `/stream` 完整、正常**，说明员工侧隔离与落库无问题。

---

## 三、根因

### 触发时序

```
用户消息 → registry.start(总管 conv_id)
         → agent.astream(..., thread_id=总管)
         → 工具 confirm_orchestration_plan
              → execute_plan → start_task_as_conversation
              → call_soon_threadsafe(registry.start(员工 conv_id))  // 总管 astream 尚未结束
         → 同一 asyncio 事件循环上两条 agent.astream 并发
```

`confirm_orchestration_plan` 在总管 **tool 节点内同步执行**，`execute_plan` 通过 `main_loop.call_soon_threadsafe` 尽快启动员工流；此时总管 `_run_agent_background` 仍在 `await _agent_it.__anext__()`。

### 机制

- LangGraph `stream_mode=["messages", "updates", "custom"]`（`version="v2"`）下，**同进程并发多个 `astream`** 时，部分 **`messages` 流事件会进入错误的消费端**（总管侧的迭代器）。
- 事件 metadata 仍带真实 `configurable.thread_id`（员工会话 id），故日志可辨认来源，但 **187 的循环仍将其 `buffer.add` 并 broadcast 到 187 SSE**。
- `stream_registry.py` 未在 `buffer.add` 前校验 `thread_id == conversation_id`（且单靠过滤只能止血，不能替代避免并发）。

### 与「总管自己代劳」的区别

总管 Prompt 曾鼓励「执行中汇报进度」「简单任务直接告知结果」，会导致总管在 **187** 上反复 `list_tasks`、`read_file`、`shell_execute`（`thread_id` 确为 187）。那是**行为层**问题，已通过 Prompt / 工具 docstring 收紧（见第五节）。

**串流**指 metadata 为 **188** 的 chunk 出现在 **187** SSE，必须由**错开双流启动时机**解决。

---

## 四、修复

### 4.1 主修复：等总管流结束再启员工流

**文件**：`src/service/agent/orchestrator/execution.py`

**函数**：`_start_employee_stream_when_orchestrator_idle`

**逻辑**：

1. 若存在 `orchestrator_conversation_id`（委派发起会话），轮询 `registry.is_active(orchestrator_conversation_id)`。
2. 每 `_ORCH_STREAM_IDLE_POLL_SECONDS`（0.5s）检查一次，最多 `_ORCH_STREAM_IDLE_MAX_POLLS`（600）次（约 5 分钟）。
3. 总管流不再 active 后，再调用 `registry.start(员工会话, ...)`。
4. 超时仍启动并打 `warning`，避免任务永久挂起。

**调度**：`start_task_as_conversation` 末尾使用：

```python
main_loop.call_soon_threadsafe(_schedule_employee_stream)
# _schedule_employee_stream → asyncio.create_task(_start_employee_stream_when_orchestrator_idle(...))
```

替代原先在 `confirm` 工具执行过程中**立即** `registry.start(188)`。

### 4.2 日志关键字（排查用）

| 日志 | 含义 |
|------|------|
| `defer employee conv=%s until orchestrator conv=%s stream ends` | 已开始等待总管流结束 |
| `orchestrator conv=%s idle after %s polls, starting employee conv=%s` | 等待结束，启动员工流 |
| `[run] conv=%s stream completed normally` | 总管 `_run_agent_background` 正常结束（应早于或紧贴员工启动） |

日志目录：`~/.digital-employee/logs/main.log`（Electron 主进程与后端见 AGENTS.md）。

### 4.3 未采用 / 仅作补充的手段

| 手段 | 说明 |
|------|------|
| `buffer.add` 前过滤 `metadata.thread_id != conversation_id` | 可防脏数据进 UI，**不解决**双流并发；可能静默丢事件。未作为唯一修复。 |
| 进程/线程隔离员工 agent | 成本高；当前以错开启动时机为准。 |
| 移除总管 `shell_execute` | 影响「用户明确要求总管亲自做」场景；由 Prompt 限制即可。 |

---

## 五、Prompt 与工具描述（配套，非串流主因）

产品层总管 UI 已区分：`messages` 编排 + `ExecutionReportCard` 展示员工结果。总管仍刷屏/代劳时，多为模型行为，见：

- `src/service/agent/orchestrator/prompts.py`：「委派执行后」、收紧「输出约定」、禁止 confirm 后 `list_tasks` 轮询与代员工 shell/read。
- `src/service/agent/orchestrator/tools.py`：`confirm_orchestration_plan`、`list_tasks`、`list_workspace_employees` 的 tool docstring。

---

## 六、验证

### 6.1 串流回归（A/B）

1. 重启后端，总管发起简单任务（如微博热搜）→ 自动 `create` + `confirm`。
2. 仅抓取总管会话 SSE 存盘。
3. 检查：

```powershell
Select-String -Path "总管-sse.txt" -Pattern '"thread_id": <员工会话id>'
```

**期望**：0 条匹配。

4. 员工会话 `/stream` 仍应完整（与修复前一致）。

### 6.2 日志时序

`[run] conv=<总管> stream completed normally` 应出现在 `starting employee conv=<员工>` 之前（或紧相邻），不应在员工大量 model chunk 之后仍长时间处于总管 active。

### 6.3 修复前日志参考特征

- 总管 SSE `id` 连续递增序列中，confirm / `list_tasks`(187) 之后立即出现 `thread_id: 188` 的 `AIMessageChunk`。
- 同一文件内 187 / 188 的 `thread_id` 大量交错，且 188 段包含员工专属工具名（`read_file` SKILL、`shell_execute` 等）。

---

## 七、后续改动注意事项

1. **任何在总管 `astream` 未结束时启动第二条 `astream` 的路径**（不仅是 `confirm`，还包括调度器、手动 API）都应复用「等 idle 再 start」或等价互斥。
2. **升级 LangGraph / deepagents** 后应重跑第六节回归；框架若改进并发 `messages` 隔离，可考虑简化轮询，但需用 SSE 抓包证明。
3. **不要**假设 `orchestrator_conversation_id` 能用于流路由；执行关联走 DB / `TaskExecutionLog` 与前端 `executions` API。
4. 总管多轮 `list_tasks`、复述员工结果为 **Prompt/产品** 范畴，与本文串流 bug 分开排查。

---

## 八、变更记录

| 日期 | 说明 |
|------|------|
| 2026-05-29 | 初版：根因（并发 `astream`）、`execution.py` 延迟启动员工流、验证方法、Prompt 配套说明 |
