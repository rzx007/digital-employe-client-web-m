# 多智能体任务编排系统 — 实施文档

> **版本**：v1.1  
> **状态**：核心能力已落地（编排 Agent、流式执行、workspace 事件）；本文档兼作架构说明与变更记录。  
> **目标**：从"手动填表式排班"演进为"自然语言对话式任务分发"，通过总管助手（Orchestrator Agent）智能拆解用户意图，自动匹配数字员工并执行。

---

## 一、现状分析

### 1.1 当前架构概要

```
用户 ──[手动填表]──> EmployeeTask (DB)
                        │
                        ├── dispatch_type = "skill" ──> TaskSchedulerService ──> get_agent() ──> LLM + Skill 执行
                        └── dispatch_type = "mcp"    ──> TaskSchedulerService ──> HTTP POST 到 MCP 服务
```

**核心数据流**（见 `apps/server/src/service/chat_service.py:297`、`task_scheduler_service.py:457`）：
| 环节 | 当前实现 | 文件位置 |
|------|----------|----------|
| 任务创建 | 手动填写 cron + skill/mcp 绑定 | 前端 workbench 表单 → `EmployeeTask` 模型 |
| 任务调度 | APScheduler BackgroundScheduler CST | `task_scheduler_service.py:54 reload_jobs()` |
| **Agent 执行** | **`agent.invoke()` 非流式、阻塞**，前端无实时反馈 | `task_scheduler_service.py:457 run_task_job()` |
| 对话交互 | SSE 流式（`agent.astream()`），前端实时渲染 | `chat_service.py:297 stream_conversation_answer()` |
| 总管助手 | 仅前端展示层（任务执行记录监控），无实际 Agent | `curator-view.tsx` |
| **全局通知** | **无**，前端只能轮询 `TaskExecutionLog` 表 | — |

### 1.2 总管助手当前状态（2026-05 更新）

已实现（与本文档早期「规划阶段」描述不同）：

| 能力 | 实现 |
|------|------|
| Orchestrator Agent | `apps/server/src/service/agent/orchestrator/`，`ChatService` 在 `target_type=curator` 时路由 |
| 会话持久化 | `Conversation.target_type="curator"`，每工作空间可有多条总管会话 |
| 默认会话 | `GET .../chat/curator/conversation` → `ensure_curator_conversation`（优先 `title='总管对话'`） |
| 总管聊天 UI | `CuratorView`：消息流 + 按会话过滤的执行时间线（`orchestrator_conversation_id`） |
| 新建对话 | `DraftChatView` + `ChatPanel`；**首条发送后仍留在草稿视图**（不切 `CuratorView`，除非用户从会话列表选中已有会话） |
| 全工作区概况 | 联系人详情 `CuratorOverviewSection`（`useAllTaskExecutions`），非会话列表项 |
| 编排关联 | `OrchestrationPlan.conversation_id`、`EmployeeTask.source_conversation_id`、`TaskExecutionLog.orchestrator_conversation_id` |

前端路由（`chat-view.tsx`）：

- 总管 + 草稿 / 无选中会话 → `DraftChatView`
- 总管 + 已选真实 `conversationId` → `CuratorView`
- 员工 / 群组逻辑不变

相关文档：`apps/server/docs/compatibility-inventory.md` §11、`docs/external-task-guide.md`、`docs/task-lifecycle.md`（会话 ID 语义）、`apps/server/docs/orchestrator-employee-stream-isolation.md`（总管/员工 SSE 隔离）。

### 1.3 总管多会话（阶段一～三摘要）

| 阶段 | 内容 |
|------|------|
| 一 | 查询隔离：`GET .../tasks/executions?orchestrator_conversation_id=`、`GET .../orchestration/plans?conversation_id=` |
| 二 | 落库 + 回填：`source_conversation_id`、`orchestrator_conversation_id`；编排写入与定时总管任务优先绑定来源会话 |
| 三 | 前端多会话列表、`ensure` 默认会话、bootstrap 空列表时创建默认会话；清空会话 scoped 删除执行 log |

**注意**：已移除会话列表固定项「任务执行结果」（原虚拟 ID `curator-executions`），全工作区执行概况仅在联系人面板展示。

**草稿与 bootstrap**：`useBootstrapCuratorDefaultConversation` 在 `isDraftConversation` 为 true 时不调用 ensure，避免「新建对话」被自动选中默认会话顶掉。

### 1.4 需要保留的设计

以下设计良好，应保留：
- `EmployeeTask` 模型（员工任务绑定 cron + skill + user_prompt）
- `TaskExecutionLog` 执行日志
- APScheduler 调度框架
- `get_agent()` Agent 工厂（按员工 + 技能目录创建 Agent）
- `StreamRegistry` SSE 流管理
- `ExtraMeta` 扩展元数据（`ConversationMessage.extra_meta`）
- `Checkpointer` 对话状态持久化（`AsyncSqliteSaver`）

---

## 二、目标架构

```
                              ┌──────────────────────────┐
                              │  GET /workspaces/{w}/     │
                              │      events (SSE)         │
                              │  工作空间级全局通知通道     │
                              └──────────┬───────────────┘
                                         │ 推 task_started / task_completed / task_failed
                                         │
┌─────────────────────────────────────────┼───────────────────────────────────────┐
│                         用户（人类管理者）  │                                       │
│  输入："我有一个新项目需要设计开发，主题是智能客服系统"  │                            │
└───────────────────────────┬─────────────┼───────────────────────────────────────┘
                            │             │
                            ▼             │
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    总管助手 (Orchestrator Agent)                                   │
│                                                                                   │
│  ┌─────────────────────┐  ┌──────────────────────┐                                │
│  │  LangChain Tools:    │  │  自然语言 Cron 解析   │                                │
│  │  · list_employees    │  │  (NL Scheduler)      │                                │
│  │  · create_plan       │  └──────────────────────┘                                │
│  │  · confirm_plan      │                                                         │
│  └─────────┬───────────┘                                                          │
│            │                                                                      │
│            ▼                                                                      │
│  确认卡 → 创建 EmployeeTask × N（execute_mode=immediate|scheduled）                │
│            │                                                                      │
│            │ 每条 EmployeeTask → 创建 Conversation → agent.astream()  SSE 流式执行  │
│            ▼                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Conversation │  │ Conversation │  │ Conversation │  │ Conversation │   ...    │
│  │ target: HR   │  │ target: PM   │  │ target: FE   │  │ target: BE   │          │
│  │ astream()    │  │ astream()    │  │ astream()    │  │ astream()    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                 │                   │
│         └─────────────────┴─────────────────┴─────────────────┘                   │
│                                   │                                               │
│              ┌────────────────────┼────────────────────┐                          │
│              │  progress 事件推 workspace channel       │                          │
│              │  前端: 进度条聚合 + 可点击跳转 conv 详情  │                          │
│              └─────────────────────────────────────────┘                          │
│                                   │                                               │
│                                   ▼                                               │
│                     结果汇总 → curator conversation message                        │
│                     (包含每个子任务的 conversation_id + 摘要)                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

核心设计原则：**任务的执行 = 新开一个 Conversation，复用现有 SSE 流式基础设施**。`agent.invoke()` 仅用于非流式场景，任务执行统一走 `agent.astream()`。

### 2.1 两种任务下发模式

| 模式 | 触发方式 | 执行时机 | 示例 |
|------|----------|----------|------|
| **即时执行** | 聊天框发送 → 确认 → 立即分派 | 确认后立即 | "帮我分析这份用户反馈，让 HR 和产品经理协作" |
| **定时执行** | 聊天框发送（含时间） → 生成 cron → APScheduler 调度 | 到达 cron 时间 | "每天上午 9:30 帮我总结昨日 AI 要闻"、"下午 3 点提醒我开会" |

---

## 三、需要新增/修改的模块

### 3.1 数据库层

#### 3.1.1 新增表：`orchestration_plans`（编排计划表）

记录总管助手生成的每一次任务编排计划。

```python
# apps/server/src/models/orchestration_plan.py (新建)

class OrchestrationPlan(Base):
    __tablename__ = "orchestration_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), ...)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), ...)
    message_id: Mapped[int] = mapped_column(ForeignKey("conversation_messages.id"), ...)

    # 原始用户输入
    user_input: Mapped[str] = mapped_column(Text, nullable=False)
    # 编排结果 JSON
    # [
    #   {
    #     "employee_id": 1, "employee_name": "陈小红",
    #     "task_name": "需求分析-智能客服",
    #     "prompt": "请分析智能客服系统的功能需求...",
    #     "dispatch_type": "skill", "skill_id": 5,
    #     "cron": null, "priority": 1, "depends_on": null
    #   },
    #   ...
    # ]
    plan_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # 状态：pending_confirmation / confirmed / executing / completed / partially_failed / cancelled
    status: Mapped[str] = mapped_column(String(32), default="pending_confirmation")
    # 子任务总数 / 完成数（从 EmployeeTask 聚合）
    total_tasks: Mapped[int] = mapped_column(Integer, default=0)
    completed_tasks: Mapped[int] = mapped_column(Integer, default=0)
    created_at / updated_at ...
```

子任务**不建独立表**，直接复用 `EmployeeTask`，通过 `orchestration_plan_id` 外键关联（见 5.5）。

#### 3.1.2 修改模型：`Conversation` 和 `ConversationMessage`

```python
# apps/server/src/models/conversation.py（修改）
class Conversation(Base):
    # 新增字段
    target_type: Mapped[str]  # 改为支持 "employee" | "group" | "curator"
    # 当 target_type="curator" 时，target_id 可设为 workspace_id
```

#### 3.1.3 修改模型：`TaskExecutionLog` 关联 Conversation

任务的执行结果（Agent 最终返回文本）以 Conversation 为数据源，`TaskExecutionLog` 作为索引快照：

```python
# apps/server/src/models/task_execution_log.py（修改）
class TaskExecutionLog(Base):
    # ── 新增 ──
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 执行结果摘要（流结束后从 Conversation 最后一条 assistant message 提取）
    # output_json = {"content": "Agent 最终回复全文...", "conversation_id": 128}
    # output_json 字段已存在，无需修改，仅改变写入逻辑
```

**定位链**：`EmployeeTask` → `TaskExecutionLog` → `Conversation` → `ConversationMessage`。

总管助手查询执行结果时：
1. 查 `TaskExecutionLog` 拿到状态/时间/摘要文本
2. 如需完整结果，通过 `conversation_id` 跳转到对话页查看完整流

#### 3.1.4 新增 `init_db()` 迁移

在 `apps/server/src/db/` 的 `init_db()` 中添加 `Base.metadata.create_all(engine)`（新表自动创建），并补充 `ensure_column()` 调用。

### 3.2 后端服务层

#### 3.2.1 新模块：`OrchestratorAgent`（总管 Agent 工厂）★核心模块

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

总管助手本身是一个 Agent，通过 **LangChain Tool** 的方式内置任务编排能力。Agent 推理出子任务后**主动调用 Tool**，Tool 内部直接操作 DB。

**工具清单**：

```python
# orchestrator_agent.py

from langchain_core.tools import tool
from sqlalchemy.orm import Session

# ── Tool 1: 查看所有员工 ──
@tool
def list_workspace_employees() -> str:
    """列出当前工作空间所有数字员工，包含其角色、技能、MCP 外接能力。
    用于判断哪个员工适合处理什么类型的任务。"""
    # 从 DB 查询 employees + employee_skills + employee_mcps
    # 返回 Markdown 表格供 Agent 识别

# ── Tool 2: 生成编排计划 ── ★核心 Tool
@tool
def create_orchestration_plan(
    summary: str,
    tasks: str,
) -> str:
    """创建任务编排计划。调用时机：确认任务拆解和员工分配无误后调用此工具落库。

    参数:
      summary: 编排计划的中文描述（如"智能客服系统开发：PRD+前后端+测试"）
      tasks: JSON 数组字符串，每个元素格式:
        {
          "employee_id": <int>,
          "task_name": "<任务名称>",
          "prompt": "<下发给该员工 Agent 的执行指令>",
          "dispatch_type": "skill",
          "skill_id": <int | null>,
          "cron": "<cron 表达式 | null 表示立即执行>",
          "priority": <int>,
          "depends_on": <int | null>  // 依赖另一个 task 的数组索引
        }
    """
    # 1. 解析 tasks JSON
    # 2. DB 事务:
    #    a. INSERT INTO orchestration_plans (workspace_id, conversation_id, 
    #       message_id, user_input, plan_json, status, total_tasks)
    #    b. FOR each task:
    #         INSERT INTO employee_tasks (employee_id, task_name, user_prompt,
    #           dispatch_type, skill_id, cron_expression, execute_mode, 
    #           orchestration_plan_id, source, ...)
    #         WHERE execute_mode = ("immediate" if cron is null else "scheduled")
    #    c. 更新 plan.completed_tasks, plan.total_tasks
    # 3. db.commit()
    # 4. 向 SSE 流推送编排确认事件（orchestration_plan_generated）
    # 5. 返回: "编排计划 #3 已生成，包含 5 个子任务，请确认后开始执行"

# ── Tool 3: 确认执行 ──
@tool
def confirm_orchestration_plan(plan_id: int) -> str:
    """用户确认编排计划后调用，开始执行所有子任务。
    注意：此工具只有当用户明确说「确认」「开始执行」「没问题」时才调用。"""
    # 1. 更新 orchestration_plans.status = "executing"
    # 2. 遍历所有 EmployeeTask (WHERE orchestration_plan_id = plan_id):
    #    a. execute_mode == "immediate":
    #       → 为每个任务创建 Conversation + 启动 astream()
    #       → _star_task_as_conversation(task)   ← 见 3.2.4 节
    #    b. execute_mode == "scheduled":
    #       → 调用 TaskSchedulerService.reload_jobs()  ← cron 到时后同样走 _star_task_as_conversation()
    # 3. 推 workspace 事件（每个子任务推送一次）
    # 4. 即时任务并发执行（asyncio.gather），不阻塞 Agent 流持续输出
    # 5. 即时任务全部完成后，汇总结果写入 curator conversation
    # 6. 返回执行结果摘要
```

**Agent 工厂**：

```python
def get_orchestrator_agent(
    workspace_id: int,
    db: Session,
    conversation_id: int | None = None,
) -> Agent:
    """
    创建总管助手 Agent。
    与 Employee Agent（agent.py#get_agent）的区别：
    - 不加载员工技能文件（总管不自己干活）
    - 挂载 3 个编排专用 LangChain Tool
    - 可选择挂载 SQLite 工具用于查 employee_tasks 历史
    - System Prompt 动态注入当前工作空间的所有员工档案
    """
    settings = get_settings()
    model = ChatOpenAI(
        model=settings.deepagent_model,
        temperature=0,
        api_key=settings.api_key,
        base_url=settings.base_url,
    )

    # 构建包含员工档案的 system prompt
    employee_context = _build_employee_capability_context(db, workspace_id)
    system_prompt = ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE.format(
        current_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        employee_table=employee_context,
    )

    agent = create_deep_agent(
        model=model,
        tools=[list_workspace_employees, create_orchestration_plan, confirm_orchestration_plan],
        system_prompt=system_prompt,
        checkpointer=get_checkpointer(),
        # 无需挂载 FilesystemBackend（总管不操作文件）
    )
    return agent
```

**调用链路（完整流程）**：

```
用户在总管助手输入框: "开发智能客服系统"
        │
        ▼
POST /chat/conversations/{cid}/stream  (chat_api.py)
        │ target_type="curator"
        ▼
ChatService.stream_conversation_answer()
        │ 检测到 curator → 走编排分支
        ▼
get_orchestrator_agent(workspace_id, db, conversation_id)
        │
        ▼
Agent.astream(messages) ── SSE 流开始 ──┐
        │                                │
        ├─ Agent 推理: "先看看有哪些员工"   │
        │   → 调用 list_workspace_employees()  │ Tool 输出作为流事件推送前端
        │                                │
        ├─ Agent 推理: "PRD 给产品经理... │
        │   后端给王大明... 前端给张伟..."  │
        │   → 调用 create_orchestration_plan( │
        │       summary="智能客服开发",    │
        │       tasks=[...])             │
        │   → DB 写入 OrchestraionPlan + │
        │      EmployeeTask × 5        │
        │   → 推送 orchestration_plan_  │
        │      generated 事件 → 前端渲染 │
        │      确认卡片                  │
        │                                │
        ├─ Agent 回复: "已生成编排计划 #3  │
        │   包含 5 个任务，请确认"         │
        │                                │
        │  ⬅ 用户点击「确认执行」按钮        │
        │                                │
        ├─ 前端: PUT /orchestration/    │
        │   plans/{id}/confirm          │
        │   → trigger Tool 调用         │
        │                                │
        ├─ Agent → confirm_orchestration_│
        │   plan(plan_id=3)             │
        │   → EmployeeTask 逐条执行      │
        │   → 推送 progress 事件        │
        │                                │
        └─ Agent 回复汇总结果            │
```

#### 3.2.2 修改：`ChatService` 支持 Curator 对话

**文件**：`apps/server/src/service/chat_service.py`（修改）

```python
# stream_conversation_answer() 中增加分支
if conversation.target_type == "curator":
    agent = get_orchestrator_agent(
        workspace_id=conversation.workspace_id,
        db=db,
        conversation_id=conversation_id,
    )
    # Tool 里需要 db session → 用 contextvars 或 partial 注入
else:
    # 原有逻辑：Employee Agent
    skills_path = resolve_employee_skills_dir(...)
    agent = get_agent(skills_path, root_path, employee_id=..., conversation_id=...)
```

> **注意**：LangChain Tool 需要访问 DB session。由于 Tool 函数是纯函数无法直接注入，采用 `contextvars` 传递 db（类似 Flask/g 对象），或在 `get_orchestrator_agent` 中用 `functools.partial` 闭包捕获 session。

#### 3.2.3 修改：`TaskSchedulerService` 支持自然语言 Cron

**文件**：`apps/server/src/service/task_scheduler_service.py`（修改）

```python
@staticmethod
def parse_nl_cron(nl_input: str) -> str:
    """
    将自然语言时间表达式转为 cron:
    "每天上午 9:30" → "30 9 * * *"
    "每周一上午 10 点" → "0 10 * * 1"
    "下午 3 点提醒我开会" → "0 15 * * *"
    使用 LLM 一次调用完成
    """
```

#### 3.2.4 新模块：工作空间级 SSE 事件通道

**文件**：`apps/server/src/service/workspace_events.py`（新建）

提供一个工作空间级别的全局 SSE 长连接，用于推送任务启动/完成/失败等通知，避免前端轮询 `TaskExecutionLog`。

```
GET /workspaces/{workspace_id}/events?token=xxx
→ SSE 流: data: {"type":"task_started","task_id":42,"conversation_id":128,...}\n\n
```

**实现**：复用 `StreamRegistry` 机制，工作空间 ID 作为 special stream key（`ws-{workspace_id}`）：

```python
# workspace_events.py

class WorkspaceEventBus:
    """工作空间级事件总线，基于 StreamRegistry。"""

    @staticmethod
    def push(workspace_id: int, event: dict):
        """向所有已连接的工作空间客户端广播事件。"""
        registry.broadcast(f"ws-{workspace_id}", event)

    @staticmethod
    async def subscribe(workspace_id: int) -> AsyncGenerator[str, None]:
        """SSE 生成器，客户端调用 GET /workspaces/{id}/events 时使用。"""
        queue = registry.subscribe(f"ws-{workspace_id}")
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            registry.unsubscribe(f"ws-{workspace_id}", queue)
```

**事件类型**：

| 事件 type | 触发时机 | payload |
|-----------|----------|---------|
| `task_started` | Conversation 创建 + astream 启动 | `task_id`, `conversation_id`, `employee_id`, `employee_name`, `task_name` |
| `task_completed` | agent.astream 正常结束 | `task_id`, `conversation_id`, `run_status="success"`, `summary` |
| `task_failed` | agent.astream 异常/超时 | `task_id`, `conversation_id`, `error` |
| `orchestration_plan_generated` | 编排计划生成 | `plan_id`, `summary`, `tasks[]` |

#### 3.2.5 重构：任务执行 = 创建 Conversation + 流式 Agent

**核心改动**：废弃 `task_scheduler_service.py` 中的 `agent.invoke()`，改为创建 Conversation + `agent.astream()`，复用现有 SSE 流式基础设施。

**文件**：`apps/server/src/service/task_scheduler_service.py`（修改）

```python
# 旧代码（删除）
# result = agent.invoke(messages, config={"configurable": {"thread_id": f"task-{task_id}-{timestamp}"}})

# 新代码
def _start_task_as_conversation(
    db: Session,
    task: EmployeeTask,
    employee: Employee,
    workspace_id: int,
) -> int:
    """
    将 EmployeeTask 启动为流式 Conversation：
    1. 创建 Conversation (target_type="employee", target_id=employee.id)
    2. 创建 TaskExecutionLog (run_status="running", conversation_id=conv.id)
    3. 插入 user message (content = task.user_prompt)
    4. 创建 agent → registry.start(cid, agent, ...) 后台 astream
    5. 推送 workspace 事件 (task_started)
    6. 返回 conversation_id
    
    流结束后 (ChatService._run_agent_background 收尾)：
    7. 提取最后一条 assistant message 文本
    8. 写回 TaskExecutionLog: output_json={"content":"...全文..."}, run_status="success"
    9. 推送 workspace 事件 (task_completed)
    10. 如果关联 OrchestrationPlan → 更新 plan.completed_tasks
    
    返回值 convention：前端通过该 ID 调用 GET /chat/conv/{cid}/stream/resume 查看实时执行。
    """
    db_session_factory = ...  # 从 contextvars 获取

    # 1. 创建 Conversation
    conversation = Conversation(
        workspace_id=workspace_id,
        target_type="employee",
        target_id=employee.id,
        title=task.task_name,
    )
    db.add(conversation)
    db.flush()

    # 2. 创建 TaskExecutionLog
    run_log = TaskExecutionLog(
        task_id=task.id,
        workspace_id=workspace_id,
        employee_id=employee.id,
        skill_id=task.skill_id,
        task_name_snapshot=task.task_name,
        run_status="running",
        run_result="执行中",
        input_json=task.task_input_json or "{}",
        output_json="{}",
        conversation_id=conversation.id,  # ← 新增
        started_at=cst_now(),
    )
    db.add(run_log)

    # 3. 插入 user message
    user_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=task.user_prompt,
        stream_state="completed",
    )
    db.add(user_msg)

    # 4. 创建空 assistant message placeholder
    assistant_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content="",
        stream_state="streaming",
    )
    db.add(assistant_msg)
    db.commit()

    # 5. 创建 Agent（按员工 skill 目录）
    skill_path = resolve_employee_skills_dir(...)
    agent = get_agent(skill_path, workspace.root_path, employee_id=employee.id, conversation_id=conversation.id)

    # 6. 启动后台 astream（复用 chat_service 的 registry.start 逻辑）
    registry.start(
        conversation_id=conversation.id,
        agent=agent,
        messages=history_messages,
        db_session_factory=db_session_factory,
    )

    # 7. 推 workspace 事件
    WorkspaceEventBus.push(workspace_id, {
        "type": "task_started",
        "task_id": task.id,
        "conversation_id": conversation.id,
        "employee_id": employee.id,
        "employee_name": employee.name,
        "task_name": task.task_name,
    })

    return conversation.id
```

**调度入口改动**：`run_task_job()` 中 `dispatch_type == "skill"` 的分支从 `_execute_task_call()` 改为 `_start_task_as_conversation()`。MCP 类型的任务保持当前的 HTTP 调用方式不变。

**流结束后处理**（`ChatService._run_agent_background()` 收尾逻辑）：

```python
# chat_service.py — 在 agent.astream() 迭代结束后
async def _finalize_task_stream(conversation_id: int, stream_state: str):
    """流结束时：回写 TaskExecutionLog + 推事件。"""
    db = db_session_factory()
    try:
        # 通过 TaskExecutionLog.conversation_id 反向定位
        log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.conversation_id == conversation_id,
                TaskExecutionLog.run_status == "running",
            )
        ).first()
        if not log:
            return

        log.ended_at = cst_now()
        log.duration_ms = (log.ended_at - log.started_at).total_seconds() * 1000

        if stream_state == "completed":
            # 提取最后一条 assistant message 文本
            last_msg = db.scalars(
                select(ConversationMessage).where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                ).order_by(ConversationMessage.id.desc())
            ).first()
            final_text = last_msg.content if last_msg else ""
            
            log.run_status = "success"
            log.run_result = "任务执行成功"
            log.output_json = json.dumps({"content": final_text})

            WorkspaceEventBus.push(log.workspace_id, {
                "type": "task_completed",
                "task_id": log.task_id,
                "conversation_id": conversation_id,
            })
        elif stream_state == "error":
            log.run_status = "failed"
            log.run_result = "执行异常"
            log.error_message = "agent stream error"

            WorkspaceEventBus.push(log.workspace_id, {
                "type": "task_failed",
                "task_id": log.task_id,
                "conversation_id": conversation_id,
                "error": "agent stream error",
            })

        # 编排计划进度更新
        task = db.get(EmployeeTask, log.task_id)
        if task and task.orchestration_plan_id:
            plan = db.get(OrchestrationPlan, task.orchestration_plan_id)
            if plan and log.run_status == "success":
                plan.completed_tasks += 1
                if plan.completed_tasks >= plan.total_tasks:
                    plan.status = "completed"

        db.commit()
    finally:
        db.close()
```

**完整数据链**：

```
EmployeeTask ──1:N──> TaskExecutionLog ──1:1──> Conversation ──1:N──> ConversationMessage
                      │                                                      │
                      │ output_json = {"content": "最终文本..."}              │
                      │ run_status                                            │ 完整流式内容
                      │ conversation_id ──────────────────────────────────────┘
                      
总管查结果: TaskExecutionLog.output_json → 看摘要
          点 TaskExecutionLog.conversation_id → 跳转对话页看完整流
```

### 3.3 后端 API 层

#### 3.3.1 新路由：`orchestration_api.py`

**文件**：`apps/server/src/api/orchestration_api.py`（新建，注册到 `server.py` 的 `APIRouter`）

编排计划的生成由 Agent Tool 在 SSE 流中完成，API 层只提供确认/取消/查询接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| `PUT` | `/orchestration/plans/{id}/confirm` | 确认编排计划 → 触发 `confirm_orchestration_plan` Tool |
| `PUT` | `/orchestration/plans/{id}/cancel` | 取消编排计划 → 更新状态为 cancelled |
| `GET` | `/orchestration/plans/{id}` | 获取编排计划详情（含子任务进度） |
| `GET` | `/orchestration/plans` | 历史编排计划列表 |

`confirm` 接口不是直接执行业务逻辑，而是**向正在运行的 curator Agent 流中注入一条用户确认消息**，让 Agent 自己调 `confirm_orchestration_plan` Tool：

```python
@router.put("/orchestration/plans/{id}/confirm")
def confirm_plan(plan_id: int, db: Session = Depends(get_db)):
    """确认编排计划。向 curator 对话注入确认指令，Agent 自行调用 Tool。"""
    plan = db.query(OrchestrationPlan).filter_by(id=plan_id).first()
    # 通过 StreamRegistry 向 curator 对话流注入消息：
    # "用户已确认编排计划 #3，请调用 confirm_orchestration_plan(plan_id=3)"
    registry.inject_message(plan.conversation_id, f"请确认执行编排计划 #{plan_id}")
    return ResponseBase(data={"plan_id": plan_id, "status": "confirming"})
```

> **为什么不是直接写 DB？** 因为编排计划生成和执行都在同一个 Agent 会话上下文中，确认动作应作为 Agent 对话流的一部分，保持 LangGraph checkpointing 一致性。

#### 3.3.2 修改：`chat_api.py` 支持 Curator 流

`target_type="curator"` 已是合法值，创建 conversation 时传入即可。`POST /chat/conversations/{id}/stream` 无需额外参数——ChatService 内部根据 `target_type` 自动路由到 `get_orchestrator_agent()` 或 `get_agent()`。

#### 3.3.3 新增端點：工作空間事件通道

**文件**：`apps/server/src/api/workspace_api.py`（修改，或新建 `workspace_events_api.py`）

```python
@router.get("/workspaces/{workspace_id}/events")
async def workspace_events(
    workspace_id: int,
    token: str = Query(...),  # 鉴权
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """工作空间级 SSE 事件通道，推送任务启动/完成/失败通知。"""
    # 验证 token
    return StreamingResponse(
        WorkspaceEventBus.subscribe(workspace_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
```

### 3.4 前端层

#### 3.4.1 重构：`CuratorView` → 真实对话界面

**文件**：`apps/web/src/components/chat/curator-view.tsx`（修改）

当前问题：
- 输入框 disabled，无法发送消息 → **改为启用**
- 只展示执行记录，不能对话 → **改为完整的 ConversationChatView 式交互**
- 无法接收编排计划和任务进度通知 → **订阅 workspace events**

改动：
```tsx
// curator-view.tsx
export function CuratorView({ ... }) {
  // 订阅 workspace 事件通道
  useWorkspaceEvents()  // 接收 task_started/completed/failed/failed 事件

  if (!conversationId) {
    // 新对话：显示欢迎词 + 输入框
    return <DraftCuratorChatView onSend={...} />
  }
  // 已有对话：渲染消息历史 + SSE 流
  return <ConversationChatView 
    conversationId={conversationId}
    isCurator={true} // 新增 prop
    ...
  />
}
```

**即时任务不跳转**：确认执行后，总管对话框内渲染 `TaskProgressBar`（显示 X/Y 完成），不自动跳转到员工的 conversation。子任务卡片可点击跳转，但由用户手动触发。

**workspace events 使用方式**：
```tsx
// hooks/use-workspace-events.ts (新建)
function useWorkspaceEvents() {
  useEffect(() => {
    const es = new EventSource(`/workspaces/${workspaceId}/events?token=${token}`)
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      switch (event.type) {
        case "task_started":
          // 更新编排计划进度（completed 不变，total 已知）
          break
        case "task_completed":
          // completed_tasks++ → 进度条更新
          break
        case "task_failed":
          // 标记子任务失败
          break
      }
    }
    return () => es.close()
  }, [workspaceId])
}
```

关键实现点：
1. **消息卡片类型扩展**：新增"确认卡片"（renders plan summary + confirm/cancel buttons）和"编排进度卡片"（TaskProgressBar + 子任务列表）
2. **SSE 事件类型扩展**：`orchestration_plan_generated`、`task_progress_update`
3. **确认交互**：用户点击"确认执行" → `PUT /orchestration/plans/{id}/confirm`
4. **不跳转**：确认后留在总管对话框，进度条实时更新；子任务卡片可点击跳转到对应 employee conversation

#### 3.4.2 新增 UI 组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `OrchestrationPlanCard` | `components/chat/orchestration-plan-card.tsx` | 渲染编排计划：任务列表 + 员工分配 + 确认/取消按钮 |
| `TaskProgressBar` | `components/chat/task-progress-bar.tsx` | 实时显示子任务执行进度（X/Y），每一行可点击跳转到对应 employee conversation |
| `EmployeeMentionChip` | 现有的 `@mention` 可复用 | 在编排计划中展示被分配的员工头像+名字 |
| `CronPreviewBadge` | `components/chat/cron-preview-badge.tsx` | 显示自然语言 Cron 的预览（如："每天上午 9:30"） |

#### 3.4.3 修改：消息分类器

`apps/web/src/lib/chat/message-classifier.ts` 需新增对 `orchestration` 类型事件的识别：

```typescript
// 新增 part type
interface OrchestrationPlanPart {
  type: "orchestration-plan"
  plan: OrchestrationPlanData
}
interface TaskProgressPart {
  type: "orchestration-task-progress"
  planId: number
  completed: number
  total: number
  tasks: EmployeeTaskProgress[]
}
```

#### 3.4.4 Store 扩展

`chat-store.ts` 无需大改，因 curator 会话复用 `selectedConversationId` 模式。需新增：
- `curatorConversationId: string | null` — 缓存总管对话 ID
- `pendingPlan: OrchestrationPlanData | null` — 待确认的编排计划（用于确认卡片渲染）

---

## 四、实施路线图

### Phase 1：基础设施（预计 3-5 天）

| # | 任务 | 涉及文件 | 验证方式 |
|---|------|----------|----------|
| 1.1 | 创建 `OrchestrationPlan` 模型 + 扩展 `EmployeeTask`（source / orchestration_plan_id / execute_mode / valid_from / valid_until / conversation_id） | `models/orchestration_plan.py`、`models/employee_task.py` | `init_db()` 后表存在 |
| 1.2 | 扩展 `Conversation.target_type` 支持 `"curator"` | `models/conversation.py`、`schemas/conversation.py` | 创建 curator 对话成功 |
| 1.3 | 实现 `WorkspaceEventBus`（复用 StreamRegistry）+ `GET /workspaces/{id}/events` 端点 | `service/workspace_events.py`、`api/workspace_api.py` | SSE 连接能收到事件 |
| 1.4 | 创建 `orchestration_api.py` 路由 + 注册（confirm/cancel/query） | `api/orchestration_api.py`、`server.py` | 接口可调通 |
| 1.5 | 实现员工能力汇总函数 `_build_employee_capability_context()` | `service/orchestrator_agent.py` | 返回结构化员工列表 |

### Phase 2：编排 Agent（预计 3-5 天）

| # | 任务 | 涉及文件 | 验证方式 |
|---|------|----------|----------|
| 2.1 | 实现 `OrchestratorAgent` 的 System Prompt 模板 | `service/orchestrator_agent.py` | Prompt 包含所有员工档案 |
| 2.2 | 实现 `list_workspace_employees` LangChain Tool | `service/orchestrator_agent.py` | Agent 可列出员工 |
| 2.3 | 实现 `create_orchestration_plan` LangChain Tool（内含 DB 写入 + SSE 事件推送） | `service/orchestrator_agent.py` | DB 有记录 + 前端收到确认卡片 |
| 2.4 | 修改 `ChatService.stream_...` 增加 curator 分支 → 路由到 `get_orchestrator_agent()` | `service/chat_service.py` | curator 对话可流式响应 |

### Phase 3：确认与执行（预计 3-5 天）

| # | 任务 | 涉及文件 | 验证方式 |
|---|------|----------|----------|
| 3.1 | 确认卡片 SSE 事件发射（`orchestration_plan_generated`） | `service/orchestrator_agent.py`、`lib/chat/sse-parts-builder.ts` | 前端收到确认卡片 |
| 3.2 | 前端 `OrchestrationPlanCard` 组件 + 确认/取消交互 | `components/chat/orchestration-plan-card.tsx`、`curator-view.tsx` | 可确认/取消计划 |
| 3.3 | 实现 `_start_task_as_conversation()` — 任务执行 = 创建 Conversation + `agent.astream()` | `service/task_scheduler_service.py` | 任务触发后前端可跳转 conversation 查看流式执行 |
| 3.4 | 实现 `confirm_orchestration_plan` LangChain Tool → 即时任务并发启动 conversation，定时任务 `reload_jobs()` | `service/orchestrator_agent.py` | 确认后子任务开始执行

### Phase 4：定时任务自然语言（预计 2-3 天）

| # | 任务 | 涉及文件 | 验证方式 |
|---|------|----------|----------|
| 4.1 | 自然语言 → Cron 解析（LLM 工具） | `service/task_scheduler_service.py#parse_nl_cron()` | "每天 9:30" → `30 9 * * *` |
| 4.2 | 总管对话中接受"明天下午 3 点提醒我开会"并创建定时任务 | 编排流程 + `EmployeeTask` 联合 | 到时间后自动触发 |

### Phase 5：结果聚合与通知（预计 2-3 天）

| # | 任务 | 涉及文件 | 验证方式 |
|---|------|----------|----------|
| 5.1 | 前端 `useWorkspaceEvents()` hook — 订阅 workspace 事件通道，更新编排进度 | `hooks/use-workspace-events.ts` | 前端收到 task_started/completed 事件 |
| 5.2 | 前端 `TaskProgressBar` 组件 — 实时显示编排进度，子任务可点击跳转 employee conversation（手动触发） | `components/chat/task-progress-bar.tsx` | 进度条动态更新，点击跳转 |
| 5.3 | 流结束后自动更新 `TaskExecutionLog` + `OrchestrationPlan.completed_tasks` + 推送完成事件 | `service/chat_service.py` `_run_agent_background()` | 日志完整、进度准确 |
| 5.4 | 编排结果汇总消息写入 curator 对话 | `service/orchestrator_agent.py` `confirm_orchestration_plan()` | 总管对话收到汇总 |

### Phase 6：打磨与边界处理（预计 2-3 天）

| # | 任务 | 涉及文件 | 验证方式 |
|---|------|----------|----------|
| 6.1 | 错误处理：单个子任务失败不影响整体 | `orchestration_service.py` | 部分失败时状态正确 |
| 6.2 | 支持任务依赖（前端 → 后端 → 测试） | 全栈 | DAG 依赖链执行正确 |
| 6.3 | 编排计划历史查看 | 前端 `OrchestrationHistoryPanel` | 可回顾历史计划 |
| 6.4 | 员工忙闲状态/并发控制 | `orchestration_service.py` | 同一员工不被同时分配多个即时任务 |

---

## 五、关键技术细节

### 5.1 Orchestrator Agent 的 System Prompt 设计

```text
你是数字员工团队的总管助手。你的职责是理解用户的指令，将其拆解为具体任务，
分配给最合适的数字员工。

## 可用数字员工：
| ID | 姓名 | 角色 | 技能 | 特殊能力 |
|----|------|------|------|----------|
| 1  | 陈小红 | HR经理 | 招聘筛选、简历分析、员工关系 | 排班管理 |
| 2  | 王大明 | 首席工程师 | 技术架构、代码审查 | 后端开发、DevOps |
| 3  | 李晓琳 | 产品设计师 | UX设计、用户研究 | 原型制作 |
| ...

## 你的能力：
1. 将复杂需求拆解为可独立执行的子任务
2. 为每个子任务指派最佳员工
3. 识别任务间依赖关系
4. 识别定时执行需求并生成 cron 表达式
5. 生成结构化的执行方案供用户确认

## 输出格式（当需要拆解任务时）：
{
  "tasks": [
    {
      "employee_id": <int>,
      "employee_name": "<str>",
      "task_name": "<str>",
      "prompt": "<详细执行指令>",
      "cron": "<cron表达式或null>",
      "depends_on_task_index": null
    }
  ],
  "summary": "<一段中文总结>"
}
```

### 5.2 确认卡片的 SSE 事件协议

`create_orchestration_plan` Tool 执行时，通过 StreamRegistry 向 SSE 流推送事件：

```json
// 新增 SSE 事件类型 — Agent Tool 写入 DB 后立即推送
{
  "type": "custom",
  "data": {
    "type": "orchestration_plan_generated",
    "plan_id": 3,
    "summary": "智能客服系统开发：PRD + 前后端 + 测试",
    "tasks": [
      {
        "employee_id": 1,
        "employee_name": "李晓琳",
        "role": "产品经理",
        "task_name": "输出PRD文档",
        "cron": null,
        "execute_mode": "immediate"
      },
      {
        "employee_id": 2,
        "employee_name": "王大明",
        "role": "后端开发",
        "task_name": "后端API开发",
        "cron": null,
        "execute_mode": "immediate"
      }
    ],
    "total": 5
  }
}
```

前端收到后渲染 `OrchestrationPlanCard`。用户点击「确认执行」→ `PUT /orchestration/plans/3/confirm` → registry 向 Agent 注入确认消息 → Agent 调用 `confirm_orchestration_plan` Tool。执行期间持续推送 progress 事件。

### 5.3 EmployeeTask 模型微调

即时任务和定时任务**统一走 `EmployeeTask`**，差异仅在两个字段：

```python
# 方案：新增 execute_mode 字段 + cron_expression 允许为空
class EmployeeTask(Base):
    # ... 现有字段 ...
    cron_expression: Mapped[str | None] = mapped_column(String(128), nullable=True)  # 改为 nullable
    execute_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="scheduled")
    # "scheduled" = 定时执行（cron_expression 必填）
    # "immediate" = 立即执行（cron_expression 为 null，确认后立刻跑）
```

`init_db()` 中需要 `ensure_column("employee_tasks", "execute_mode", "VARCHAR(32) NOT NULL DEFAULT 'scheduled'")`  + `ALTER TABLE ... ALTER COLUMN cron_expression DROP NOT NULL`（SQLite 不支持直接 drop not null，需要用重建表的方式或忽略校验）。

### 5.4 编排执行流程

用户确认后，通过 SSE 流向 Agent 注入消息触发 `confirm_orchestration_plan` Tool：

```
用户点击「确认执行」
        │
        ▼
PUT /orchestration/plans/{id}/confirm
        │
        ▼
registry.inject_message(conversation_id, "确认执行编排计划 #3")
        │ 复用现有 SSE 流机制，作为一条用户消息注入 Agent 对话
        ▼
Agent 收到消息 → 调用 confirm_orchestration_plan(plan_id=3) Tool
        │
        ▼
Tool 内部 (orchestrator_agent.py):
        │
        ├─ UPDATE orchestration_plans SET status = "executing"
        │
        ├─ FOR each EmployeeTask WHERE orchestration_plan_id = 3:
        │
        │   ├── execute_mode = "immediate":
        │   │   └── _start_task_as_conversation(task, employee)
        │   │       ├── 创建 Conversation (target_type="employee")
        │   │       ├── 插入 user message (content=task.user_prompt)
        │   │       ├── registry.start(cid, agent) ← agent.astream() 流式
        │   │       ├── 推 workspace 事件 task_started
        │   │       └── 流完成后 → 更新 TaskExecutionLog + 推 task_completed
        │   │
        │   └── execute_mode = "scheduled":
        │       └── TaskSchedulerService.reload_jobs()
        │           └── cron 触发时同样走 _start_task_as_conversation()
        │
        ├─ UPDATE orchestration_plans SET status = "completed" | "partially_failed"
        │   aggregated_completed_tasks
        │
        └─ return 汇总结果 → Agent 回复到 curator 对话中
```

#### 5.4.1 并发控制

同一员工可同时执行多个任务（每个任务用独立 `thread_id`，checkpointer 隔离），但需加并发上限防止 LLM API 被打爆：

```python
# orchestrator_agent.py 中
MAX_CONCURRENT_TASKS_PER_EMPLOYEE = 2

def _can_assign_to_employee(db: Session, employee_id: int) -> bool:
    running = db.query(TaskExecutionLog).filter(
        TaskExecutionLog.employee_id == employee_id,
        TaskExecutionLog.run_status == "running",
    ).count()
    return running < MAX_CONCURRENT_TASKS_PER_EMPLOYEE
```

编排时如果某员工已满，排队等待或通知用户。

#### 5.4.2 多时段任务编排

"周一到周二写代码，周三到周四 review" = **两个独立的 EmployeeTask**，不是一条任务的多时段切片：

| EmployeeTask | prompt | cron_expression | valid_from | valid_until |
|-------------|--------|-----------------|------------|--------------|
| 任务 A | "写代码..." | `0 9 * * 1,2` | 2026-04-27 | 2026-04-28 |
| 任务 B | "review 代码..." | `0 9 * * 3,4` | 2026-04-29 | 2026-04-30 |

Orchestrator Agent 自然语言拆解时自行判断：如果用户在描述中包含多个时间段的行为，拆成多条 EmployeeTask。

对应的字段扩展：

```python
class EmployeeTask(Base):
    # 新增
    valid_from: Mapped[datetime | None]  # 任务有效期起始（null = 立即生效）
    valid_until: Mapped[datetime | None]  # 任务有效期截止（null = 永久）
```

`TaskSchedulerService.reload_jobs()` 调度时自动跳过已过期的任务（`valid_until < now`）。

### 5.5 与现有 `EmployeeTask` + `Employee.meta_json.tasks` 的兼容

核心原则：**所有任务（手动填表 + 自然语言下发）统一落 `EmployeeTask` 表**，仅来源不同。

| 来源 | 创建方式 | 标识方式 |
|------|----------|----------|
| 手动填表（现有） | 前端 Workbench 表单 → `EmployeeTask` | 无特殊标记 |
| `meta_json.tasks` 同步（现有） | `TaskService.sync_workspace_tasks()` upsert | 按 `(task_name, dispatch_type, skill_id)` 唯一键 |
| 自然语言编排（新增） | `OrchestrationService.confirm_and_execute()` → `EmployeeTask` | `source = "orchestration"` 字段 + `orchestration_plan_id` 外键 |

新增 `EmployeeTask.source` 字段区分来源，避免 `sync_workspace_tasks` 误覆盖编排任务：

```python
class EmployeeTask(Base):
    # 新增
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    # "manual" = 手动创建 / meta_json 同步 | "orchestration" = 编排生成
    orchestration_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("orchestration_plans.id"), nullable=True
    )
```

`TaskService.sync_workspace_tasks()` 中增加过滤条件：`WHERE source != 'orchestration'`，确保只管理手动/同步任务，不误删编排任务。

### 5.6 员工能力描述数据结构

为 Orchestrator Agent 提供结构化员工档案（在每个会话中注入 System Prompt）：

```python
def build_employee_capability_context(db: Session, workspace_id: int) -> str:
    """构建员工能力描述文本，注入 Orchestrator System Prompt"""
    employees = EmployeeService.list_employees(db, workspace_id)
    lines = []
    for emp in employees:
        skills = ", ".join(
            f"{s.skill_name}({s.skill_name_zh})"
            for s in EmployeeService.list_employee_skills(db, emp.id)
        ) or "无"
        mcps = ", ".join(
            f"{m.capability_name}"
            for m in EmployeeService.list_employee_mcps(db, emp.id)
        ) or "无"
        line = f"| {emp.id} | {emp.name} | {emp.employee_code} | {skills} | {mcps} |"
        lines.append(line)
    
    header = "| ID | 姓名 | 岗位 | 技能 | 外接能力(MCP) |"
    return header + "\n" + "\n".join(lines)
```

### 5.7 前端总管 UI 状态机（2026-05）

```
联系人选总管
    │
    ├─ isDraftConversation 或 无 selectedConversationId
    │       → DraftChatView（ChatPanel + CuratorEmptyWelcome）
    │       → 首条消息创建 curator 会话后仍留在此视图（产品约定）
    │
    └─ 已选真实 conversationId
            → CuratorView（专用 composer + 消息/执行时间线）

会话列表为空且非草稿 → bootstrap ensure 默认会话并选中
用户点「新建对话」→ enterDraftConversation → bootstrap 不抢焦点
```

编排确认 / 执行进度仍在 `CuratorView` 时间线与 `OrchestrationPlanCard` 等组件中展示；草稿视图主要用于发起新会话的第一轮输入。

---

## 六、文件清单

### 新增文件

| 路径 | 说明 |
|------|------|
| `apps/server/src/models/orchestration_plan.py` | 编排计划 ORM |
| `apps/server/src/models/employee_task.py` | 扩展字段（source/orchestration_plan_id/execute_mode/valid_from/valid_until/conversation_id） |
| `apps/server/src/models/task_execution_log.py` | 新增 `conversation_id` FK |
| `apps/server/src/schemas/orchestration.py` | 编排相关 Pydantic schema |
| `apps/server/src/service/orchestrator_agent.py` | 总管 Agent 工厂 + 3 个 LangChain Tool |
| `apps/server/src/service/workspace_events.py` | 工作空间级 SSE 事件通道（WorkspaceEventBus） |
| `apps/server/src/api/orchestration_api.py` | 编排 API 路由（confirm/cancel/query） |
| `apps/web/src/components/chat/orchestration-plan-card.tsx` | 编排确认卡片 |
| `apps/web/src/components/chat/task-progress-bar.tsx` | 任务进度条（可点击跳转 conversation） |
| `apps/web/src/components/chat/cron-preview-badge.tsx` | Cron 预览 |
| `apps/web/src/hooks/use-workspace-events.ts` | 订阅 workspace SSE 事件通道 |
| `apps/web/src/hooks/use-orchestration-queries.ts` | 编排 API hooks |
| `apps/web/src/stores/orchestration-store.ts` | 编排状态 store |

### 修改文件

| 路径 | 改动内容 |
|------|----------|
| `apps/server/src/models/conversation.py` | `target_type` 支持 `"curator"` |
| `apps/server/src/schemas/conversation.py` | `TargetType` 扩展 |
| `apps/server/src/service/chat_service.py` | 增加 curator 分支 + `_run_agent_background` 流结束时更新 TaskExecutionLog |
| `apps/server/src/service/task_scheduler_service.py` | `_execute_task_call()` → `_start_task_as_conversation()` + `parse_nl_cron()` |
| `apps/server/src/api/chat_api.py` | curator 对话兼容 |
| `apps/server/src/api/workspace_api.py` | 新增 `GET /workspaces/{id}/events` 端点 |
| `apps/server/src/server.py` | 注册新路由 |
| `apps/server/src/db/` | `init_db()` 添加新表/字段 |
| `apps/web/src/components/chat/curator-view.tsx` | 重构为真实对话界面 + TaskProgressBar |
| `apps/web/src/lib/chat/message-classifier.ts` | 新增编排事件类型 |
| `apps/web/src/lib/chat/sse-parts-builder.ts` | 新增编排 SSE 解析 |
| `apps/web/src/stores/chat-store.ts` | 新增 curator 相关状态 |
| `apps/web/src/lib/constants.ts` | `curatorUnreadKey` 等（已移除虚拟会话 `curator-executions` 固定项） |

---

## 七、风险与注意事项

1. **LLM 任务拆解质量**：依赖 LLM 的结构化输出能力，需要充分的 System Prompt 设计 + 输出格式约束。建议使用 JSON mode 或 function calling。
2. **员工匹配准确性**：目前员工角色/技能匹配靠 LLM 语义理解，初期可能不准。后续可引入 `pgvector` 做 embedding 相似度匹配。
3. **并发安全**：编排计划确认后批量执行时，注意 DB session 管理和 APScheduler 并发调度。
4. **Checkpointer 隔离**：Orchestrator Agent 和 Employee Agent 应使用不同的 `thread_id`（通过 `conversation_id` 区分），避免状态污染。
5. **向后兼容**：现有基于 `EmployeeTask` + `meta_json` 的排班机制保留不变，编排系统作为新增功能并行运行。

---

## 八、实施总结

### 实施范围

6 个 Phase，全部完成。从手动填表式排班演进为自然语言对话式任务分发。

### 核心链路

```
用户: "帮我开发智能客服系统"
  → curator conversation (SSE 流)
    → Orchestrator Agent:
        1. list_workspace_employees()  ← Tool: 查看所有员工
        2. create_orchestration_plan() ← Tool: 写 DB + 推确认卡片事件
  → 前端显示确认卡片
  → 用户点击「确认执行」
    → PUT /orchestration/plans/{id}/confirm
    → _execute_plan()
      → _start_immediate_tasks() (拓扑排序 + 并发控制)
        → _start_task_as_conversation()
          → 创建 Conversation + TaskExecutionLog
          → call_soon_threadsafe → registry.start()
            → agent.astream() 流式执行
            → _finalize_task_stream() → run_status = success/failed
```

### 兜底机制

| 场景 | 处理 | 涉及文件 |
|------|------|----------|
| 进程崩溃重启 | `cleanup_zombie_executions()`：10 分钟无心跳的 running → `timeout` | `stream_registry.py` |
| 线程/agent crash | `_finalize_task_stream` 独立 session 回写 | `stream_registry.py` |
| LLM 超时 | `AGENT_CHUNK_TIMEOUT=120s` → Exception → `state_final="error"` | `stream_registry.py` |
| 员工并发超限 | `MAX_CONCURRENT_PER_EMPLOYEE=2`，排队等待 | `orchestrator_agent.py` |
| 任务依赖循环 | 依赖完成后才启动后置任务，依赖失败者标记未完成 | `orchestrator_agent.py` |
| SQLite NOT NULL 兼容 | cron 为空时写 `""` | `orchestrator_agent.py` |
| event loop 跨线程 | `set_main_event_loop()` + `call_soon_threadsafe()` | `server.py`, `orchestrator_agent.py` |
| 时区不一致 | `replace(tzinfo=None)` 统一后相减 | `stream_registry.py` |

### 新增文件

| 文件 | 说明 |
|------|------|
| `apps/server/src/models/orchestration_plan.py` | 编排计划 ORM |
| `apps/server/src/schemas/orchestration.py` | 编排 Pydantic schema |
| `apps/server/src/service/orchestrator_agent.py` | **总管 Agent 工厂** + 3 个 LangChain Tool |
| `apps/server/src/service/workspace_events.py` | 工作空间级 SSE 事件通道 |
| `apps/server/src/api/orchestration_api.py` | 编排 API (list/get/confirm/cancel) |
| `apps/web/src/components/chat/curator/curator-view.tsx` | 总管已选会话：聊天 + 执行时间线 |
| `apps/web/src/components/chat/curator/curator-empty-welcome.tsx` | 总管欢迎/引导（草稿与空会话） |
| `apps/web/src/components/chat/views/chat-draft-view.tsx` | 总管新建对话草稿（共用 ChatPanel） |
| `apps/web/src/hooks/use-bootstrap-curator-conversations.ts` | 空列表 ensure 默认会话 |
| `apps/web/src/components/chat/orchestration-plan-card.tsx` | 确认卡片 |
| `apps/web/src/components/chat/task-progress-bar.tsx` | 实时进度条 |
| `apps/web/src/components/chat/cron-preview-badge.tsx` | Cron 中文预览 |
| `apps/web/src/hooks/use-workspace-events.ts` | workspace 事件订阅 + 自动桥接 store |
| `apps/web/src/stores/orchestration-store.ts` | 编排状态管理 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `models/employee_task.py` | +6 字段 (source/orch_plan_id/execute_mode/valid_from/valid_until) |
| `models/task_execution_log.py` | +conversation_id, +last_heartbeat_at |
| `models/orchestration_plan.py` | +started_at |
| `chat_service.py` | curator 分支 → `get_orchestrator_agent()` + `_validate_target` 支持 curator |
| `task_scheduler_service.py` | `run_task_job` skill 分支 → `_start_task_as_conversation()`；+`parse_nl_cron()`；过期任务过滤 |
| `stream_registry.py` | `_finalize_task_stream` 独立 session；心跳更新 `last_heartbeat_at`；+`cleanup_zombie_executions` |
| `server.py` | 启动保存主事件循环 + 清理僵尸 running 任务 |
| `chat-view.tsx` | curator 路由统一走 CuratorView |
| `init_db.py` | 新列迁移 |

### 后续优化方向（用户体验）

1. **编排卡片可视化** — PlanCard 增加依赖关系 DAG 图和执行时间线
2. **执行结果预览** — 在总管对话中直接展示子任务执行摘要，不必跳转
3. **错误提示增强** — 前台展示 Agent 异常/超时原因，提供重试按钮
4. **定时任务管理界面** — 在 Workbench 中增加编排生成任务的查看/编辑/暂停功能
5. **员工忙闲状态** — 在联系人列表中展示员工实时并发占用率
