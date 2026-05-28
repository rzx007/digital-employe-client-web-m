# 外部任务下发接入指南

> 适用于：外部系统通过代码调用，向数字员工团队下发任务。

## 快速接入

### 最小流程（3 步）

```python
from src.core.config import get_settings
from src.db.session import get_session_local
from src.service.chat_service import ChatService

settings = get_settings()
workspace_id = settings.default_workspace_id

db = get_session_local()()

# 1. 获取（或创建）当前工作空间的默认总管助手会话
conversation = ChatService.ensure_curator_conversation(db, workspace_id)

# 2. 发送任务描述，SSE 流式返回结果
async for chunk in ChatService.stream_conversation_answer(
    db=db,
    conversation_id=conversation.id,
    question="开发一个智能客服系统，前端 React，后端 Python",
    skill_name="",
):
    # chunk 是 SSE 格式的字符串，如:
    # 'data: {"type":"messages","ns":[],"data":[[...]]}\n\n'
    # 'data: [DONE]\n\n'
    print(chunk)
```

> **重要**：`stream_conversation_answer` 使用的 `conversation_id` 即为后续编排与执行追溯的**总管会话**。`create_orchestration_plan` 会把该 id 写入 `orchestration_plans.conversation_id` 与子任务的 `employee_tasks.source_conversation_id`。

### 流程图

```
外部程序
  │
  ├─ ensure_curator_conversation(db, workspace_id)
  │    → 返回默认总管会话 (target_type="curator"；每工作空间至少一条)
  │
  ├─ stream_conversation_answer(db, conversation.id, question)
  │    │
  │    ├─ 目标路由: conversation.target_type == "curator"
  │    │    → get_orchestrator_agent(workspace_id, db, conversation.id)
  │    │    → Orchestrator Agent 接收用户输入，开始推理
  │    │
  │    ├─ Agent 内部执行逻辑:
  │    │    ├─ list_workspace_employees() → 查看可用员工
  │    │    ├─ create_orchestration_plan(...) → 创建编排计划
  │    │    │    → OrchestrationPlan.conversation_id = 当前总管会话
  │    │    │    → EmployeeTask（source="orchestration", source_conversation_id=同上）
  │    │    │    → 推 workspace 事件
  │    │    │    → 返回 {"type":"plan_generated", ...}
  │    │    │
  │    │    ├─ [简单任务] confirm_orchestration_plan(plan_id)
  │    │    │    → 即时任务: start_task_as_conversation
  │    │    │         → 员工会话 log.conversation_id（执行会话）
  │    │    │         → log.orchestrator_conversation_id（总管来源会话）
  │    │    │    → 定时任务: 加入 APScheduler（触发时仍绑定 source_conversation_id）
  │    │    │
  │    │    └─ [复杂任务] 等待确认（见下文确认流程）
  │    │
  │    └─ SSE 流结束 [DONE]
  │
  └─ 外部程序收到结果
```

## 会话 ID 语义

| 字段 / 参数 | 含义 |
|-------------|------|
| `OrchestrationPlan.conversation_id` | 创建编排计划时的总管会话 |
| `EmployeeTask.source_conversation_id` | 任务由哪条总管会话下发 |
| `TaskExecutionLog.orchestrator_conversation_id` | 本次执行归属的总管会话（查总管时间线用） |
| `TaskExecutionLog.conversation_id` | **员工 Agent 执行会话**（子任务运行时新建，非总管会话） |

详见 [`task-lifecycle.md`](task-lifecycle.md) 与 [`apps/server/docs/compatibility-inventory.md`](../apps/server/docs/compatibility-inventory.md) §11。

## 详细说明

### 任务确认

简单任务（即时 + 无依赖 + ≤2 个子任务）会自动执行，无需外部程序干预。

复杂任务（定时 / 有依赖 / ≥3 个子任务）Agent 只创建计划，不自动执行。外部程序需要：

```python
# 方案 1: 再发一条确认消息（须使用与下发时相同的 conversation.id）
async for chunk in ChatService.stream_conversation_answer(
    db=db,
    conversation_id=conversation.id,
    question="确认执行",
    skill_name="",
):
    process(chunk)

# 方案 2: 调用 REST API 直接确认
import requests
requests.put(f"http://localhost:58000/orchestration/plans/{plan_id}/confirm")
```

### 查询执行结果

```python
from sqlalchemy import select

from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog

curator_conversation_id = conversation.id  # ensure 或你持有的总管会话 id

# 推荐：按总管会话查（REST 等价于 GET .../tasks/executions?orchestrator_conversation_id=）
logs = db.scalars(
    select(TaskExecutionLog)
    .where(
        TaskExecutionLog.workspace_id == workspace_id,
        TaskExecutionLog.orchestrator_conversation_id == curator_conversation_id,
    )
    .order_by(TaskExecutionLog.started_at.desc())
    .limit(50)
).all()

# 按员工查
logs = db.scalars(
    select(TaskExecutionLog)
    .where(TaskExecutionLog.employee_id == 1)
    .order_by(TaskExecutionLog.id.desc())
    .limit(10)
).all()

# 按编排计划查
plan_logs = db.scalars(
    select(TaskExecutionLog)
    .join(EmployeeTask, TaskExecutionLog.task_id == EmployeeTask.id)
    .where(EmployeeTask.orchestration_plan_id == plan_id)
).all()

for log in logs:
    print(
        f"[{log.run_status}] {log.task_name_snapshot} "
        f"employee_conv={log.conversation_id} "
        f"orchestrator_conv={log.orchestrator_conversation_id}"
    )
```

HTTP 示例：

```http
GET /workspaces/1/tasks/executions?orchestrator_conversation_id={curator_conversation_id}&page_size=100
GET /workspaces/1/orchestration/plans?conversation_id={curator_conversation_id}
```

### 定时任务管理

```python
# 查看当前定时任务（含来源总管会话）
tasks = db.scalars(
    select(EmployeeTask)
    .where(
        EmployeeTask.workspace_id == workspace_id,
        EmployeeTask.source == "orchestration",
        EmployeeTask.execute_mode == "scheduled",
        EmployeeTask.is_active.is_(True),
    )
).all()

for t in tasks:
    print(
        f"{t.task_name} | cron: {t.cron_expression} | "
        f"下次: {t.next_run_at} | 总管会话: {t.source_conversation_id}"
    )
```

总管员工的定时任务触发时，会优先在 `source_conversation_id` 对应的总管会话中执行；未设置时回退 `ensure_curator_conversation` 的默认会话。

## 已知限制

1. **确认阻塞**：复杂任务需要外部程序主动确认，不会自动执行
2. **状态追踪**：执行完成后通过 `TaskExecutionLog.run_status` 查询（success/failed/timeout）
3. **并发限制**：每员工最多同时 2 个执行中任务（`MAX_CONCURRENT_PER_EMPLOYEE`）
4. **多总管会话**：除 `ensure_curator_conversation`（默认会话）外，可 `POST /workspaces/{id}/chat/conversations` 创建更多 `target_type=curator` 会话；`GET .../chat/conversations?target_type=curator&target_id=<员工id>` 列表
5. **按总管会话查执行**：`GET /workspaces/{id}/tasks/executions?orchestrator_conversation_id=<curator_conv_id>`
6. **非编排任务**：无 `orchestration_plan_id` / `source_conversation_id` 的手动或 MCP 任务，不会出现在「按总管会话过滤」的执行列表中
