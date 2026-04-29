# 外部任务下发接入指南

> 适用于：外部系统通过代码调用，向数字员工团队下发任务。

## 快速接入

### 最小流程（3 步）

```python
from src.db.session import get_session_local
from src.service.chat_service import ChatService

db = get_session_local()()

# 1. 获取（或创建）总管助手会话
conversation = ChatService.ensure_curator_conversation(db)

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

### 流程图

```
外部程序
  │
  ├─ ensure_curator_conversation(db)
  │    → 返回 conversation (target_type="curator", 每工作空间唯一)
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
  │    │    │    → 写 EmployeeTask 表（source="orchestration"）
  │    │    │    → 推 workspace 事件
  │    │    │    → 返回 {"type":"plan_generated", ...}
  │    │    │
  │    │    ├─ [简单任务] confirm_orchestration_plan(plan_id)
  │    │    │    → 即时任务: _start_task_as_conversation → 创建员工对话 + agent.astream
  │    │    │    → 定时任务: 加入 APScheduler
  │    │    │
  │    │    └─ [复杂任务] 等待确认（见下文确认流程）
  │    │
  │    └─ SSE 流结束 [DONE]
  │
  └─ 外部程序收到结果
```

## 详细说明

### 任务确认

简单任务（即时 + 无依赖 + ≤2 个子任务）会自动执行，无需外部程序干预。

复杂任务（定时 / 有依赖 / ≥3 个子任务）Agent 只创建计划，不自动执行。外部程序需要：

```python
# 方案 1: 再发一条确认消息
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
from src.models.task_execution_log import TaskExecutionLog
from sqlalchemy import select

# 按员工查
logs = db.scalars(
    select(TaskExecutionLog)
    .where(TaskExecutionLog.employee_id == 1)
    .order_by(TaskExecutionLog.id.desc())
    .limit(10)
).all()

# 按编排计划查（通过 EmployeeTask 反查）
from src.models.employee_task import EmployeeTask
plan_tasks = db.scalars(
    select(TaskExecutionLog)
    .join(EmployeeTask, TaskExecutionLog.task_id == EmployeeTask.id)
    .where(EmployeeTask.orchestration_plan_id == plan_id)
).all()

for log in logs:
    print(f"[{log.run_status}] {log.task_name_snapshot}: {log.output_json}")
```

### 定时任务管理

```python
# 查看当前定时任务
from src.models.employee_task import EmployeeTask
tasks = db.scalars(
    select(EmployeeTask)
    .where(
        EmployeeTask.source == "orchestration",
        EmployeeTask.execute_mode == "scheduled",
        EmployeeTask.is_active == True,
    )
).all()

for t in tasks:
    print(f"{t.task_name} | cron: {t.cron_expression} | 下次: {t.next_run_at}")
```

## 已知限制

1. **确认阻塞**：复杂任务需要外部程序主动确认，不会自动执行
2. **状态追踪**：执行完成后通过 `TaskExecutionLog.run_status` 查询（success/failed/timeout）
3. **并发限制**：每员工最多同时 2 个执行中任务（`MAX_CONCURRENT_PER_EMPLOYEE`）
