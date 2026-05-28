# 自然语言任务下发 — 完整生命周期

> 场景：用户在总管助手输入"开发一个智能客服系统，前端 React，后端 Python"

## 阶段一：总管拆解（Orchestrator Agent）

```
用户 → 总管助手
  │
  └─[10:00] user: "开发一个智能客服系统，前端 React，后端 Python"
            │
            └──→ POST /chat/conversations/{cid}/stream  (SSE)
                  │ target_type="curator"
                  ▼
            ChatService.stream_conversation_answer()
                  │ 检测到 curator → get_orchestrator_agent()
                  ▼
            Orchestrator Agent (deepagents + LangGraph + 3 Tools)
              │
              ├─ 调用 list_workspace_employees()
              │    → 返回员工表格: | ID | 姓名 | 岗位 | 技能 | MCP |
              │
              ├─ Agent 推理: "产品经理做 PRD，王大明写后端，张伟写前端"
              │
              └─ 调用 create_orchestration_plan(
                     summary="智能客服系统开发",
                     tasks=[
                       {employee_id:3, task_name:"输出PRD", prompt:"...", cron:null},
                       {employee_id:2, task_name:"后端API", prompt:"...", cron:null},
                       {employee_id:4, task_name:"前端开发", prompt:"...", cron:null},
                       {employee_id:5, task_name:"集成测试", prompt:"...", cron:null},
                     ])
                    │
                    ├─ DB 写入: OrchestrationPlan (status=pending_confirmation)
                    ├─ DB 写入: EmployeeTask × 4 (source="orchestration", execute_mode="immediate")
                    └─ WorkspaceEventBus.push(orchestration_plan_generated)
                          → 前端 SSE 收到 → 渲染确认卡片
```

**前端看到**：

```
 ┌──────────────────────────────────────────────────┐
 │ [CuratorChatHeader] 总管助手 | 分发任务 · 查看结果 │
 ├──────────────────────────────────────────────────┤
 │                                                  │
 │ [10:00] user: 开发一个智能客服系统                   │
 │                                                  │
 │ [10:00] assistant: 好的，我来分析团队分工...          │
 │                                                  │
 │ ┌─── OrchestrationPlanCard ──────────────────┐   │
 │ │ 编排计划                                      │   │
 │ │ 智能客服系统开发                 4 个子任务     │   │
 │ │                                              │   │
 │ │ ● PRD 文档          李晓琳    待执行           │   │
 │ │ ● 后端 API          王大明    待执行           │   │
 │ │ ● 前端开发          张伟      待执行           │   │
 │ │ ● 集成测试          赵磊      待执行           │   │
 │ │                                              │   │
 │ │ [确认执行]  [取消]                             │   │
 │ └──────────────────────────────────────────────┘   │
 │                                                  │
 │ ████████████ ChatPromptInput ██████████████████ │
 └──────────────────────────────────────────────────┘
```

---

## 阶段二：确认执行（OrchestrationPlan → EmployeeTask → Conversation）

```
用户点击「确认执行」
  │
  └─→ PUT /orchestration/plans/{id}/confirm
        │
        ├─ plan.status = "executing"
        ├─ plan.started_at = now()
        │
        └─ _execute_plan(db, plan, workspace_id)
            │
            ├─ scheduled_tasks → TaskSchedulerService.reload_jobs()
            │
            └─ _start_immediate_tasks()
                │ 拓扑排序 (depends_on) + 并发控制 (MAX_CONCURRENT=2)
                │
                └─ for each task:
                    │
                    └─ _start_task_as_conversation(task, employee)
                        │
                        ├─ 1. 创建 Conversation
                        │     (target_type="employee", target_id=employee.id)
                        │
                        ├─ 2. 创建 TaskExecutionLog
                        │     (run_status="running", conversation_id=conv.id)
                        │
                        ├─ 3. 创建 ConversationMessage
                        │     (role="user", content=task.user_prompt)
                        │     (role="assistant", stream_state="streaming")
                        │
                        ├─ 4. db.commit()
                        │
                        ├─ 5. main_loop.call_soon_threadsafe(
                        │       registry.start(cid, agent, ...))
                        │     → agent.astream() 流式执行
                        │
                        └─ 6. WorkspaceEventBus.push(task_started)
                              → 前端收到 → 进度条更新
```

**前端看到**：

```
 ┌──────────────────────────────────────────────────┐
 │ CuratorChatHeader                                │
 ├──────────────────────────────────────────────────┤
 │                                                  │
 │ [10:00] user: 开发一个智能客服系统                   │
 │ [10:00] assistant: 好的，我来拆解...                │
 │                                                  │
 │ ┌─── TaskProgressBar ────────────────────────┐   │
 │ │ 执行中                          0/4 (0%)    │   │
 │ │ ████░░░░░░░░░░░░░░░░░░░░░░                  │   │
 │ │                                              │   │
 │ │ ○ PRD 文档        李晓琳    待执行             │   │
 │ │ ○ 后端 API        王大明    执行中             │   │
 │ │ ○ 前端开发        张伟      执行中             │   │
 │ │ ○ 集成测试        赵磊      待执行 [依赖前驱]   │   │
 │ └──────────────────────────────────────────────┘   │
 │                                                  │
 │ ████████████ ChatPromptInput ██████████████████ │
 └──────────────────────────────────────────────────┘
```

---

## 阶段三：员工执行（Conversation + agent.astream()）

```
[10:01] 王大明 (employee_id=2)
  │
  └─→ Conversation #34 (target_type="employee", target_id=2)
        │
        ├─ UserMsg: "用 Python FastAPI 实现智能客服核心 API..."
        │
        └─ agent.astream()
              │
              ├─ Agent: "好的，我先设计数据库模型..."
              ├─ Agent: execute("python -u design_models.py")
              ├─ Agent: "然后实现 API 接口..."
              └─ Agent: "完成！已生成后端代码到 /artifacts/"
                    │
                    ├─ Stream 正常结束
                    │
                    └─ _finalize_task_stream(cid, "completed")
                          │
                          ├─ 独立 session 打开
                          ├─ TaskExecutionLog.run_status = "success"
                          ├─ TaskExecutionLog.output_json = {"content": "最终回复"}
                          ├─ db.commit()
                          │
                          └─ WorkspaceEventBus.push(task_completed)
                                → 前端收到 → 进度条更新 + 执行报告卡片
```

**前端看到（时间线实时更新）**：

```
 ┌──────────────────────────────────────────────────┐
 │ CuratorChatHeader                                │
 ├──────────────────────────────────────────────────┤
 │                                                  │
 │ [10:00] user: 开发一个智能客服系统                   │
 │ [10:00] assistant: 好的，我来拆解...                │
 │                                                  │
 │ ┌─── TaskProgressBar ────────────────────────┐   │
 │ │ 执行中                          2/4 (50%)   │   │
 │ │ ████████░░░░░░░░░░░░░░                       │   │
 │ │                                              │   │
 │ │ ✓ PRD 文档        李晓琳    成功               │   │
 │ │ ✓ 后端 API        王大明    成功               │   │
 │ │ ○ 前端开发        张伟      执行中             │   │
 │ │ ○ 集成测试        赵磊      待执行 [依赖前驱]   │   │
 │ └──────────────────────────────────────────────┘   │
 │                                                  │
 │ ┌─── ExecutionReportCard (from="assistant") ─┐   │
 │ │ 🟡 陈小红                                     │   │
 │ │ 成功 · PRD文档                                │   │
 │ │ 已输出产品需求文档，包含功能需求和用户故事...     │   │
 │ │ ⭐⭐⭐⭐⭐  [查看详情]                            │   │
 │ └──────────────────────────────────────────────┘   │
 │                                                  │
 │ ┌─── ExecutionReportCard (from="assistant") ─┐   │
 │ │ 🟡 王大明                                     │   │
 │ │ 成功 · 后端API                                │   │
 │ │ 已完成 FastAPI 核心接口开发和数据库模型设计...   │   │
 │ │ ⭐⭐⭐☆☆  [查看详情]                            │   │
 │ └──────────────────────────────────────────────┘   │
 │                                                  │
 │ ████████████ ChatPromptInput ██████████████████ │
 └──────────────────────────────────────────────────┘
```

---

## 阶段四：全部完成（派生状态）

```
[10:05] 最后一个子任务完成
  │
  └─ _finalize_task_stream(cid, "completed")
        │
        ├─ TaskExecutionLog.run_status = "success"
        │
        └─ WorkspaceEventBus.push(task_completed)
              │
              ▼
         前端 SSE 收到 → React Query refetch
              │
              ▼
         GET /orchestration/plans?workspace_id=1
              │
              └─ _compute_plan_progress(plan)
                    │
                    ├─ completed = COUNT DISTINCT tl.task_id WHERE run_status != "running"
                    │   → 4
                    │
                    ├─ failed = COUNT DISTINCT tl.task_id WHERE run_status IN (failed, timeout, cancelled)
                    │   → 0
                    │
                    ├─ total = COUNT(et.id) WHERE orchestration_plan_id = plan.id
                    │   → 4
                    │
                    └─ completed >= total, failed == 0
                       → status = "completed"
```

**前端看到（最终态）**：

```
 ┌──────────────────────────────────────────────────┐
 │ CuratorChatHeader                                │
 ├──────────────────────────────────────────────────┤
 │                                                  │
 │ [10:00] user: 开发一个智能客服系统                   │
 │ [10:00] assistant: 好的，我来拆解...                │
 │                                                  │
 │ ┌─── TaskProgressBar ────────────────────────┐   │
 │ │ 执行中                          4/4 (100%)  │   │
 │ │ ████████████████████████████████             │   │
 │ │                                              │   │
 │ │ ✓ PRD 文档        李晓琳    成功               │   │
 │ │ ✓ 后端 API        王大明    成功               │   │
 │ │ ✓ 前端开发        张伟      成功               │   │
 │ │ ✓ 集成测试        赵磊      成功               │   │
 │ └──────────────────────────────────────────────┘   │
 │                                                  │
 │ ┌─── ExecutionReportCard ────────────────────┐   │
 │ │ 🟡 陈小红 · 成功 · PRD文档                    │   │
 │ │ ⭐⭐⭐⭐⭐  [查看详情]                            │   │
 │ └──────────────────────────────────────────────┘   │
 │ ┌─── ExecutionReportCard ────────────────────┐   │
 │ │ 🟡 王大明 · 成功 · 后端API                    │   │
 │ │ ⭐⭐⭐☆☆  [查看详情]                            │   │
 │ └──────────────────────────────────────────────┘   │
 │ ┌─── ExecutionReportCard ────────────────────┐   │
 │ │ 🟡 张伟 · 成功 · 前端开发                     │   │
 │ │ ⭐⭐⭐⭐☆  [查看详情]                           │   │
 │ └──────────────────────────────────────────────┘   │
 │ ┌─── ExecutionReportCard ────────────────────┐   │
 │ │ 🟡 赵磊 · 成功 · 集成测试                     │   │
 │ │ ⭐⭐⭐☆☆  [查看详情]                            │   │
 │ └──────────────────────────────────────────────┘   │
 │                                                  │
 │ ████████████ ChatPromptInput ██████████████████ │
 └──────────────────────────────────────────────────┘
```

---

## 阶段五：异常分支

### 子任务失败

```
[10:03] 张伟 · 前端开发
  │
  └─ agent.astream() 异常
        │
        └─ _run_agent_background except Exception
              │
              ├─ state_final = "error"
              │
              └─ finally → _finalize_task_stream(cid, "error")
                    │
                    ├─ TaskExecutionLog.run_status = "failed"
                    │
                    └─ _compute_plan_progress 聚合时
                         completed = 4, failed = 1
                         → status = "partially_failed"
```

### LLM 超时

```
agent.astream() 120s 无产出
  → asyncio.TimeoutError
    → Exception("Agent stream timed out after 120s")
      → state_final = "error"
        → _finalize_task_stream → run_status = "failed"
```

### 进程崩溃重启

```
server.py lifespan 启动时
  → cleanup_zombie_executions()
    → SELECT * FROM task_execution_logs
      WHERE run_status = "running"
        AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now - 10min)
    → run_status = "timeout"
```

### 并发上限

```
员工已有 2 个 running 任务
  → _can_assign_to_employee() → False
    → 第三个任务跳过，结果中提示 "达到并发上限，已排队"
```

---

## 数据模型关系

```
OrchestrationPlan (编排计划)
  │ id, user_input, plan_json, status, total_tasks
  │
  └─1:N── EmployeeTask (子任务)
            │ id, employee_id, task_name, user_prompt,
            │ cron_expression, execute_mode, source, orchestration_plan_id
            │
            └─1:N── TaskExecutionLog (执行日志, source of truth)
                      │ id, task_id, conversation_id, employee_id,
                      │ run_status, output_json, started_at, ended_at
                      │
                      └─1:1── Conversation (员工对话)
                                │ target_type="employee", target_id=employee.id
                                │
                                └─1:N── ConversationMessage (消息记录)
                                          │ role, content, chunk_json, stream_state
```

**状态派生规则**：

```
OrchestrationPlan.status = _compute_plan_progress() 查询时聚合
  ├─ pending_confirmation / cancelled → 保持原值
  ├─ completed >= total && failed == 0 → "completed"
  └─ completed >= total && failed > 0 → "partially_failed"

TaskExecutionLog.run_status = 唯一写入源
  ├─ _start_task_as_conversation → "running"
  ├─ _finalize_task_stream → "success" | "failed" | "cancelled"
  └─ cleanup_zombie_executions → "timeout"
```

---

## SSE 事件类型

| 事件 | 触发时机 | 推送到 |
|------|----------|--------|
| `orchestration_plan_generated` | `create_orchestration_plan` Tool 写入 DB 后 | `WorkspaceEventBus` (queue.Queue, 线程安全) |
| `task_started` | `_start_task_as_conversation` 启动 `registry.start()` 后 | 同上 |
| `task_completed` | `_finalize_task_stream(stream_state="completed")` | 同上 |
| `task_failed` | `_finalize_task_stream(stream_state="error"/"cancelled")` | 同上 |

前端 SSE 仅用于**触发 React Query 轮询加速**，实际数据来自 DB 查询 `useAllTaskExecutions()` (15s) + `useOrchestrationPlansQuery()` (5s)。刷新页面不丢数据。

---

## 定时任务分支

```
用户: "每天上午9:30帮我总结AI要闻"
  │
  └─ create_orchestration_plan(tasks=[{cron:"30 9 * * *", execute_mode:"scheduled"}])
        │
        └─ EmployeeTask (execute_mode="scheduled")
              │
              └─ TaskSchedulerService.reload_jobs()
                    │
                    └─ APScheduler CronTrigger → run_task_job()
                          │
                          └─ _start_task_as_conversation()
                              (后续流程与即时任务完全一致)
```

---

## 会话 ID 语义（总管 ↔ 员工）

| 字段 / API 参数 | 含义 |
|-----------------|------|
| `OrchestrationPlan.conversation_id` | 创建编排计划时的**总管会话** |
| `orchestrator_conversation_id`（查询参数 / 编排子任务响应） | 同上，总管下发来源会话 |
| `TaskExecutionLog.conversation_id` | **员工执行会话**（子任务 `start_task_as_conversation` 新建） |
| `OrchestrationTaskItem.conversation_id` | 员工执行会话（最新一条 log） |

总管时间线过滤：`GET /workspaces/{id}/tasks/executions?orchestrator_conversation_id={curator_conv_id}`（`task_execution_logs.orchestrator_conversation_id` 列优先；未回填行 fallback JOIN）。编排计划列表：`GET .../orchestration/plans?conversation_id={curator_conv_id}`。

落库（阶段二）：`employee_tasks.source_conversation_id`、`task_execution_logs.orchestrator_conversation_id`；启动时 `init_db` → `backfill_orchestrator_conversation_links`。详见 [`apps/server/docs/compatibility-inventory.md`](../apps/server/docs/compatibility-inventory.md) §11。
