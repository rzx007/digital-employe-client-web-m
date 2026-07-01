# 总管会话中员工任务执行消息回传流程

## 整体流程（7 个阶段）

### 1. 用户发消息给总管

- `POST /chat/conversations/{conv_id}/stream` → `ChatService.stream_conversation_answer()`
- 识别 `target_type == "curator"`，创建总管 LangGraph Agent

### 2. 总管 LLM 创建并确认执行计划

- LLM 调用 `create_orchestration_plan` 工具 → 写入 `OrchestrationPlan` + `EmployeeTask` 行
- 用户确认后，LLM 调用 `confirm_orchestration_plan` → 进入 `execute_plan()`

### 3. 为每个任务创建员工会话

- `start_task_as_conversation()` (`execution.py:219`) 创建：
  - 新 `Conversation`（target_type="employee"）
  - `TaskExecutionLog`（记录 `orchestrator_conversation_id` 关联）
  - 用户/助手消息行

### 4. 流隔离——等待总管流结束

- `_start_employee_stream_when_orchestrator_idle()` 每 0.5s 轮询 `registry.is_active(orchestrator_conv_id)`
- **总管 SSE 流彻底结束后**，才启动员工的 `agent.astream()`，防止消息串流

### 5. 员工执行，流完成

- `_run_agent_background()` 运行员工 Agent，完成后调用 `_finalize_task_stream()`

### 6. 关键——执行结果回注总管会话

- `_finalize_task_stream()` (`stream_registry.py:937`) 调用 `append_orchestrator_execution_summary()`
- 该函数在**总管会话**中插入一条 `role="assistant"` 消息，格式如：

  > 【任务完成】微博热搜 — 微博热搜助手（员工会话 #188，耗时 12.3s）

- 消息带 `extra_meta.source = "orchestrator_execution_summary"` + `execution_log_id`
- 同时前端还有 `ExecutionReportCard` 卡片组件展示任务状态

### 7. 下次对话刷新上下文

- 用户再次发消息时，`build_delegation_execution_context()` 把最新任务状态和输出摘要注入总管的 system prompt

## 数据关联链

```
TaskExecutionLog.orchestrator_conversation_id  →  定位总管会话
ConversationMessage.extra_meta.execution_log_id  →  关联执行日志
GET /executions?orchestrator_conversation_id=xxx  →  前端卡片数据
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/service/agent/orchestrator/execution.py` | 计划调度、员工会话创建 |
| `src/service/orchestrator_execution_summary.py` | 执行结果回注总管会话消息 |
| `src/service/stream_registry.py` | 流生命周期、`_finalize_task_stream()` |
| `src/service/agent/orchestrator/tools/` | 总管工具定义（按 `employees` / `plans` / `tasks` / `skills` 四大类分模块；详见 `orchestrator-tools-layout.md`） |
| `src/service/agent/orchestrator/prompts.py` | 构建委派执行上下文 |

## 总结

员工执行完成后，`_finalize_task_stream` 自动在总管会话中追加一条助手消息（含任务摘要），前端同时通过 execution API 展示卡片——两者并存于同一总管会话时间线中。
