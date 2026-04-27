# 多智能体任务编排 — 可执行子任务清单

> **前置文档**：`docs/multi-agent-orchestration-plan.md`（架构设计）  
> **依赖关系**：按 Phase 顺序执行，同 Phase 内标注了依赖  
> **状态标记**：⬜ pending | 🔵 in_progress | ✅ done

---

## Phase 1: 基础设施（DB 模型 + 工作空间事件通道）

### 1.1 创建 OrchestrationPlan 模型

**文件**：`apps/server/src/models/orchestration_plan.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 1.1.1 | 新建 `OrchestrationPlan` 类，继承 `Base` | table name = `orchestration_plans` |
| 1.1.2 | 添加字段：`id`, `workspace_id(FK)`, `conversation_id(FK)`, `message_id(FK)` | |
| 1.1.3 | 添加字段：`user_input(Text)`, `plan_json(Text, default="[]")` | |
| 1.1.4 | 添加字段：`status(String, default="pending_confirmation")` | 枚举：pending_confirmation / confirmed / executing / completed / partially_failed / cancelled |
| 1.1.5 | 添加字段：`total_tasks(Integer, default=0)`, `completed_tasks(Integer, default=0)` | |
| 1.1.6 | 添加时间戳：`created_at`, `updated_at`（复用 `cst_now`） | 参考 `employee_task.py` 的时间戳写法 |
| 1.1.7 | 在 `apps/server/src/models/__init__.py` 中导出新模型 | 确保 `init_db()` 能扫描到 |

**依赖**：无

---

### 1.2 扩展 EmployeeTask 模型

**文件**：`apps/server/src/models/employee_task.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 1.2.1 | 新增字段 `source(String, default="manual")` | 区分来源："manual" | "orchestration" |
| 1.2.2 | 新增字段 `orchestration_plan_id(FK, nullable=True)` | FK → `orchestration_plans.id` |
| 1.2.3 | 新增字段 `execute_mode(String, default="scheduled")` | "immediate" | "scheduled" |
| 1.2.4 | 新增字段 `valid_from(DateTime, nullable=True)` | 任务有效期起始 |
| 1.2.5 | 新增字段 `valid_until(DateTime, nullable=True)` | 任务有效期截止 |
| 1.2.6 | 修改 `cron_expression` 为 `nullable=True` | SQLite 不支持 ALTER COLUMN，用 `init_db()` 重建逻辑处理 |

**依赖**：1.1

---

### 1.3 扩展 TaskExecutionLog 模型

**文件**：`apps/server/src/models/task_execution_log.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 1.3.1 | 新增字段 `conversation_id(FK, nullable=True)` | FK → `conversations.id`, ondelete SET NULL |
| 1.3.2 | 添加 `index=True` 到 `conversation_id` | 方便反向查询 |

**依赖**：无

---

### 1.4 扩展 Conversation 模型

**文件**：`apps/server/src/models/conversation.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 1.4.1 | `target_type` 改为支持 `"curator"`（不改 SQL 定义，仅确保代码不拦截） | 当前 `Literal['employee','group']` → 改为 `Literal['employee','group','curator']` |

**依赖**：无

---

### 1.5 扩展 Conversation Schema

**文件**：`apps/server/src/schemas/conversation.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 1.5.1 | `TargetType` 枚举扩展 | `Literal["employee", "group"]` → `Literal["employee", "group", "curator"]` |

**依赖**：1.4

---

### 1.6 创建 Orchestration Schema

**文件**：`apps/server/src/schemas/orchestration.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 1.6.1 | 创建 `OrchestrationPlanRead` Pydantic schema | 对应 `OrchestrationPlan` 模型的只读输出 |
| 1.6.2 | 创建 `OrchestrationPlanList` 分页 schema | |
| 1.6.3 | 创建 `OrchestrationTaskItem` schema | 子任务展示用：employee_id, employee_name, task_name, cron, status 等 |

**依赖**：1.1

---

### 1.7 DB 初始化迁移

**文件**：`apps/server/src/db/init_db.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 1.7.1 | 添加 `ensure_column("employee_tasks", "source", "source VARCHAR(32) NOT NULL DEFAULT 'manual'")` | |
| 1.7.2 | 添加 `ensure_column("employee_tasks", "orchestration_plan_id", "orchestration_plan_id INTEGER")` | |
| 1.7.3 | 添加 `ensure_column("employee_tasks", "execute_mode", "execute_mode VARCHAR(32) NOT NULL DEFAULT 'scheduled'")` | |
| 1.7.4 | 添加 `ensure_column("employee_tasks", "valid_from", "valid_from DATETIME")` | |
| 1.7.5 | 添加 `ensure_column("employee_tasks", "valid_until", "valid_until DATETIME")` | |
| 1.7.6 | 添加 `ensure_column("task_execution_logs", "conversation_id", "conversation_id INTEGER")` | |
| 1.7.7 | `cron_expression` NOT NULL 问题：SQLite 不支持 ALTER COLUMN，新表创建时自动为空，历史数据已有值不受影响 | 在模型中将 `nullable` 改为 `True`，旧数据读取无问题 |

**依赖**：1.2, 1.3

---

### 1.8 注册新模型到模块扫描

**文件**：`apps/server/src/models/__init__.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 1.8.1 | 添加 `from src.models.orchestration_plan import OrchestrationPlan` | 确保 `from src import models` 时所有新表被 SQLAlchemy 元数据注册 |

**依赖**：1.1

---

### 1.9 工作空间事件通道—后端

**文件**：`apps/server/src/service/workspace_events.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 1.9.1 | 实现 `WorkspaceEventBus` 类 | 基于现有 `StreamRegistry`，workspace ID 作为特殊 stream key：`ws-{workspace_id}` |
| 1.9.2 | 实现 `push(workspace_id, event: dict)` | 向所有已连接的客户端广播事件，`event` 必须有 `type` 字段 |
| 1.9.3 | 实现 `subscribe(workspace_id) -> asyncio.Queue` | 返回 asyncio.Queue，客户端通过它接收事件 |
| 1.9.4 | 实现 `unsubscribe(workspace_id, queue)` | 清理连接 |
| 1.9.5 | 事件类型定义（常量） | `TASK_STARTED`, `TASK_COMPLETED`, `TASK_FAILED`, `ORCHESTRATION_PLAN_GENERATED` |

**文件**：`apps/server/src/api/workspace_api.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 1.9.6 | 新增端点 `GET /workspaces/{workspace_id}/events` | SSE StreamingResponse，返回 `data: {json}\n\n` |
| 1.9.7 | 添加 token 鉴权（Query 参数） | 复用现有 auth 逻辑 |

**依赖**：无（与现有 StreamRegistry 平行）

---

## Phase 2: 编排 Agent（LangChain Tools + System Prompt）

### 2.1 员工能力汇总函数

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 2.1.1 | 实现 `_build_employee_capability_context(db, workspace_id) -> str` | 返回 Markdown 表格：`| ID | 姓名 | 岗位 | 技能 | MCP |` |
| 2.1.2 | 查询 `Employee` + `EmployeeSkill` + `EmployeeMcp` 表拼接信息 | 调用 `EmployeeService.list_employees(db, workspace_id)` |
| 2.1.3 | 技能列表格式：`skill_name (skill_name_zh)`，没有则填 `"—"` | |
| 2.1.4 | 返回字符串示例见架构文档 5.6 节 | |

**依赖**：无

---

### 2.2 Orchestrator System Prompt 模板

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 2.2.1 | 实现 `ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE` 字符串常量 | 包含：当前时间、员工表格占位、任务拆解规则、Tool 使用说明 |
| 2.2.2 | Prompt 中明确要求：拆解任务 → 调用 `create_orchestration_plan`；确认后调用 `confirm_orchestration_plan` | |
| 2.2.3 | Prompt 中明确：不要自己编造员工，必须参考 `list_workspace_employees` 返回的表格 | |

**依赖**：无

---

### 2.3 实现 `list_workspace_employees` Tool

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 2.3.1 | 用 `@tool` 装饰器定义 `list_workspace_employees() -> str` | 从 contextvars 获取 db session |
| 2.3.2 | 调用 `_build_employee_capability_context(db, workspace_id)` 返回表格 | |
| 2.3.3 | Docstring 写清：列出当前工作空间所有数字员工及其角色/技能/MCP | |

**依赖**：2.1

---

### 2.4 实现 `create_orchestration_plan` Tool ★核心

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 2.4.1 | 用 `@tool` 装饰器定义 `create_orchestration_plan(summary: str, tasks: str) -> str` | tasks 参数是 JSON 数组字符串 |
| 2.4.2 | 解析 tasks JSON，校验每个 task 的 `employee_id` 在表中存在 | |
| 2.4.3 | DB 写入：创建 `OrchestrationPlan` | |
| 2.4.4 | DB 写入：遍历 tasks，逐条创建 `EmployeeTask`（source="orchestration", orchestration_plan_id=plan.id, execute_mode 根据 cron 是否为空判断） | |
| 2.4.5 | `db.commit()` | |
| 2.4.6 | 构造 SSE 事件 `orchestration_plan_generated`，推送当前聊天流 + workspace 事件通道 | 通过 `StreamRegistry` 和 `WorkspaceEventBus` |
| 2.4.7 | 返回自然语言确认提示："编排计划 #{id} 已生成，包含 {n} 个子任务，请确认" | |

**关键注意**：
- `tasks` JSON 中允许 `cron: null`（即时任务），此时 `execute_mode="immediate"`
- `skill_id` 可能为 null（让 Agent 自己从技能列表中选）
- DB session 通过 `contextvars` 传递（见 2.7）

**依赖**：2.1

---

### 2.5 实现 `confirm_orchestration_plan` Tool ★核心

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 2.5.1 | 用 `@tool` 装饰器定义 `confirm_orchestration_plan(plan_id: int) -> str` | |
| 2.5.2 | 更新 `OrchestrationPlan.status = "executing"` | |
| 2.5.3 | 遍历 `EmployeeTask WHERE orchestration_plan_id = plan_id` | |
| 2.5.4 | `execute_mode == "immediate"` → 调用 `_start_task_as_conversation(task, employee)` | 并发执行所有即时任务（`asyncio.gather`） |
| 2.5.5 | `execute_mode == "scheduled"` → 调用 `TaskSchedulerService.reload_jobs()` | |
| 2.5.6 | 推送 workspace 事件（每个子任务 `task_started`） | |
| 2.5.7 | 即时任务全部完成后，汇总结果写入 curator conversation | |
| 2.5.8 | 返回执行摘要："已启动 3 个即时任务，2 个定时任务已加入调度队列" | |

**依赖**：_start_task_as_conversation（Phase 3）

---

### 2.6 实现 `get_orchestrator_agent()` 工厂

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 2.6.1 | 实现 `get_orchestrator_agent(workspace_id, db, conversation_id=None) -> Agent` | |
| 2.6.2 | 创建 `ChatOpenAI` model（复用 `get_settings()`） | 与 `agent.py:get_agent()` 一致 |
| 2.6.3 | 调用 `create_deep_agent()`，挂载 3 个 Tool | `list_workspace_employees`, `create_orchestration_plan`, `confirm_orchestration_plan` |
| 2.6.4 | System prompt 注入员工表格 | 使用 `_build_employee_capability_context()` |
| 2.6.5 | 使用 `get_checkpointer()` | 复用全局 checkpointer |
| 2.6.6 | 不挂载 FilesystemBackend、不加载员工 skills | |

**依赖**：2.1, 2.2, 2.3, 2.4, 2.5

---

### 2.7 DB Session 传递机制

**文件**：`apps/server/src/service/orchestrator_agent.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 2.7.1 | 使用 `contextvars.ContextVar` 存储 `db_session` | 在 ChatService 创建 Orchestrator Agent 前 set，Tool 函数内部 get |
| 2.7.2 | 同样传递 `workspace_id` 和 `registry` 引用 | Tool 需要访问 workspace_id 来推事件 |

**依赖**：2.4

**注意**：如果 `contextvars` 在 asyncio 中传递有问题，改用 `functools.partial` 闭包方案。

---

### 2.8 修改 ChatService 增加 Curator 分支

**文件**：`apps/server/src/service/chat_service.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 2.8.1 | 在 `stream_conversation_answer()` 函数中增加分支 | 检测 `conversation.target_type == "curator"` |
| 2.8.2 | curator 分支：调用 `get_orchestrator_agent()` 创建 Agent | 传入 workspace_id, db |
| 2.8.3 | curator 分支：不调 `resolve_employee_skills_dir()` | 总管不加载员工技能 |
| 2.8.4 | 保持 SSE 流生成逻辑不变 | `registry.start()` 调用方式相同 |

**依赖**：2.6

---

## Phase 3: 确认与执行（流式对话化任务执行）

### 3.1 实现 `_start_task_as_conversation()`

**文件**：`apps/server/src/service/task_scheduler_service.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 3.1.1 | 新建函数 `_start_task_as_conversation(db, task, employee, workspace_id) -> int` | 返回 conversation_id |
| 3.1.2 | 创建 `Conversation` (`target_type="employee"`, `target_id=employee.id`, `title=task.task_name`) | |
| 3.1.3 | 创建 `TaskExecutionLog` (`run_status="running"`, `conversation_id=conv.id`) | 此时写入 `conversation_id` 建立关联 |
| 3.1.4 | 创建 `ConversationMessage` (role="user", content=task.user_prompt) | |
| 3.1.5 | 创建 `ConversationMessage` (role="assistant", content="", stream_state="streaming") | |
| 3.1.6 | 调用 `get_agent()` 创建 Employee Agent（按技能目录） | 复用 `resolve_employee_skills_dir()` |
| 3.1.7 | 调用 `registry.start()` 启动后台 astream | |
| 3.1.8 | 调用 `WorkspaceEventBus.push(workspace_id, {"type": "task_started", ...})` | |
| 3.1.9 | 返回 `conversation.id` | |

**依赖**：1.9

---

### 3.2 修改 `run_task_job()` 入口

**文件**：`apps/server/src/service/task_scheduler_service.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 3.2.1 | `dispatch_type == "skill"` 分支改为调用 `_start_task_as_conversation()` | 替换原有 `_execute_task_call()` |
| 3.2.2 | 移除 `TaskExecutionLog` 创建逻辑（已在 3.1 中创建） | 不再在 `run_task_job()` 中创建日志 |
| 3.2.3 | 保留原有的 `task.user_prompt` 读取 + task 状态更新逻辑 | |
| 3.2.4 | `dispatch_type == "mcp"` 分支保持不变 | MCP 不走 conversation 流 |

**依赖**：3.1

---

### 3.3 实现流结束时的 TaskExecutionLog 回写

**文件**：`apps/server/src/service/chat_service.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 3.3.1 | 在 `_run_agent_background()` 的 stream 迭代结束后，调用 `_finalize_task_stream()` | |
| 3.3.2 | 实现 `_finalize_task_stream(db_session_factory, conversation_id, stream_state)` | |
| 3.3.3 | 反向查询：`SELECT * FROM task_execution_logs WHERE conversation_id = ? AND run_status = 'running'` | |
| 3.3.4 | 如果 `stream_state == "completed"`：提取最后一条 assistant message 的 `content` 文本 | 从 `ConversationMessage` 表查 |
| 3.3.5 | 写回 `TaskExecutionLog`: `output_json = {"content": final_text}`, `run_status = "success"`, `ended_at`, `duration_ms` | |
| 3.3.6 | 如果 `stream_state == "error"/"cancelled"`：`run_status = "failed"`, `error_message` | |
| 3.3.7 | 推送 workspace 事件 (`task_completed` / `task_failed`) | |
| 3.3.8 | 如果 TaskExecutionLog 关联了 `OrchestrationPlan`（通过 EmployeeTask.orchestration_plan_id），更新 `plan.completed_tasks` | |
| 3.3.9 | 提交 DB | |

**依赖**：3.1, 1.3

---

### 3.4 SSE 事件发射器（编排用）

**文件**：`apps/server/src/service/orchestrator_agent.py`（修改 `create_orchestration_plan` Tool）

| # | 任务 | 说明 |
|---|------|------|
| 3.4.1 | 在 `create_orchestration_plan` Tool 执行 DB 写入后，构造 `orchestration_plan_generated` 事件 | 见架构文档 5.2 节 event 结构 |
| 3.4.2 | 通过 `registry` 推送到当前 curator conversation 的 SSE 流 | 前端在 curator 对话中直接收到事件 |
| 3.4.3 | 同时通过 `WorkspaceEventBus.push()` 推 workspace 级事件 | 让监控面板也能感知 |

**依赖**：2.4

---

### 3.5 前端 SSE 事件解析扩展

**文件**：`apps/web/src/lib/chat/message-classifier.ts`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 3.5.1 | 新增 `OrchestrationPlanPart` 类型定义 | `{ type: "orchestration-plan", planId: number, summary: string, tasks: [...] }` |
| 3.5.2 | 新增 `TaskProgressPart` 类型定义 | `{ type: "orchestration-task-progress", planId: number, completed: number, total: number }` |
| 3.5.3 | 在消息分类函数中识别 `orchestration_plan_generated` 和 `task_progress_update` 自定义事件 | |

**依赖**：3.4

---

### 3.6 前端确认卡片组件

**文件**：`apps/web/src/components/chat/orchestration-plan-card.tsx`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 3.6.1 | 接收 `plan: OrchestrationPlanData` prop | |
| 3.6.2 | 渲染子任务列表（每行：员工头像+名字 + 任务名 + cron 预览/即时标签） | |
| 3.6.3 | 渲染"确认执行"按钮 → `PUT /orchestration/plans/{id}/confirm` | |
| 3.6.4 | 渲染"取消"按钮 → `PUT /orchestration/plans/{id}/cancel` | |
| 3.6.5 | 确认后卡片切换到"执行中"状态，显示 `TaskProgressBar` | |

**依赖**：3.5

---

### 3.7 前端 TaskProgressBar 组件

**文件**：`apps/web/src/components/chat/task-progress-bar.tsx`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 3.7.1 | 显示 `completed / total` 进度条 | |
| 3.7.2 | 每行子任务可点击，跳转到对应的 employee conversation | `useChatStore.setSelectedContactId(employee_id)` + `setSelectedConversationId(conversation_id)` |
| 3.7.3 | 实时更新：通过 workspace events 监听 `task_completed` 事件，更新 `completed` 计数 | |
| 3.7.4 | 全部完成后渲染"查看汇总"按钮 | |

**依赖**：3.6, 1.9（workspace events 可用后）

---

### 3.8 实现 `confirm` API 端点

**文件**：`apps/server/src/api/orchestration_api.py`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 3.8.1 | `PUT /orchestration/plans/{id}/confirm` | 通过 `StreamRegistry.inject_message()` 向 curator 对话注入"确认执行编排计划 #{plan_id}" |
| 3.8.2 | `PUT /orchestration/plans/{id}/cancel` | 更新 plan status = cancelled，推 workspace 事件 |
| 3.8.3 | `GET /orchestration/plans/{id}` | 返回 plan 详情 + 关联的 EmployeeTask 列表（含 execution 状态） |
| 3.8.4 | `GET /orchestration/plans` | 历史计划列表，支持分页 |

**文件**：`apps/server/src/api/__init__.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 3.8.5 | 注册 `orchestration_router` | `from src.api.orchestration_api import router` + `include_router` |

**依赖**：2.5

---

## Phase 4: 定时任务自然语言

### 4.1 自然语言 Cron 解析

**文件**：`apps/server/src/service/task_scheduler_service.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 4.1.1 | 实现 `parse_nl_cron(nl_input: str) -> str` | 一次 LLM 调用，输入自然语言时间表达式，输出 cron 字符串 |
| 4.1.2 | System prompt 模板：只输出 cron 表达式，不要额外文字 | `"每天上午9:30" → "30 9 * * *"` |
| 4.1.3 | 使用现有 `ChatOpenAI` model（复用 settings） | |
| 4.1.4 | 异常处理：无法解析时返回 `None`，由调用方决定降级方案 | |

**依赖**：无

---

### 4.2 Orchestrator Agent 中集成 NL Cron

**文件**：`apps/server/src/service/orchestrator_agent.py`（修改 `create_orchestration_plan` Tool）

| # | 任务 | 说明 |
|---|------|------|
| 4.2.1 | 如果 `tasks` JSON 中的 `cron` 字段包含自然语言（不只是数字*），则调用 `parse_nl_cron()` 转换 | 判断：regex `[a-zA-Z\u4e00-\u9fff]` 有匹配 → 自然语言 |
| 4.2.2 | 转换成功 → 替换为标准 cron 表达式 | |
| 4.2.3 | 转换失败 → 保留原始自然语言，execute_mode 仍设为 scheduled，由 reload_jobs 时再次解析或人工介入 | |

**依赖**：4.1

---

## Phase 5: 结果聚合与前端通知

### 5.1 前端 workspace events 订阅 hook

**文件**：`apps/web/src/hooks/use-workspace-events.ts`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 5.1.1 | 实现 `useWorkspaceEvents()` hook | 建立 EventSource 连接到 `GET /workspaces/{workspace_id}/events` |
| 5.1.2 | 解析事件 JSON，按 `type` 分发到对应的 store / callback | |
| 5.1.3 | `task_started` → 更新 `orchestration-store` 的 sub-task status | |
| 5.1.4 | `task_completed` / `task_failed` → 更新进度 + notification | |
| 5.1.5 | 断线重连逻辑（exponential backoff） | |
| 5.1.6 | 获取 `workspace_id`：从 config/endpoint store 中读取 | |

**依赖**：1.9

---

### 5.2 前端 orchestration store

**文件**：`apps/web/src/stores/orchestration-store.ts`（新建）

| # | 任务 | 说明 |
|---|------|------|
| 5.2.1 | 状态：`pendingPlan: OrchestrationPlanData | null` | |
| 5.2.2 | 状态：`activePlans: Map<number, PlanProgress>` | plan_id → { total, completed, tasks: TaskProgress[] } |
| 5.2.3 | Action：`setPendingPlan(plan)` | 收到 `orchestration_plan_generated` 事件后调用 |
| 5.2.4 | Action：`updateTaskProgress(planId, taskId, status)` | 收到 task_completed/failed 事件后调用 |
| 5.2.5 | Action：`clearPendingPlan()` | 确认或取消后调用 |

**依赖**：无

---

### 5.3 CuratorView 重构为真实对话

**文件**：`apps/web/src/components/chat/curator-view.tsx`（重写）

| # | 任务 | 说明 |
|---|------|------|
| 5.3.1 | 移除 `disabled={true}`，启用输入框 | `handleSend` 实现：创建 curator conversation + 发送消息 |
| 5.3.2 | 引入 `useConversationAutoSelect`：自动选中 curator 的最新 conversation | |
| 5.3.3 | 有 conversation：渲染 `ConversationChatView`（isCurator=true） | 复用现有 SSE 流渲染 |
| 5.3.4 | 无 conversation：渲染 `DraftCuratorChatView`（欢迎词 + 快捷操作） | 快捷操作：查看历史任务/编排计划/员工状态 |
| 5.3.5 | 集成 `useWorkspaceEvents()` | 监听任务执行事件，更新对话中进度卡片 |
| 5.3.6 | **不自动跳转**：收到 task 事件后仅更新进度条/通知，不切换 conversation | 用户手动点击子任务卡片才跳转 |

**依赖**：5.1, 5.2

---

### 5.4 Curator 对话消息列表扩展

**文件**：`apps/web/src/components/chat/chat-panel.tsx`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 5.4.1 | 消息渲染时检测 `orchistration-plan` part → 渲染 `OrchestrationPlanCard` | |
| 5.4.2 | 消息渲染时检测 `orchestration-task-progress` part → 渲染 `TaskProgressBar` | |

**依赖**：3.5, 3.6, 3.7

---

### 5.5 编排结果汇总消息

**文件**：`apps/server/src/service/orchestrator_agent.py`（修改 `confirm_orchestration_plan` Tool）

| # | 任务 | 说明 |
|---|------|------|
| 5.5.1 | 即时任务执行完成后，提取每个子任务的 conversation_id | |
| 5.5.2 | 构造汇总 Markdown 消息写入 curator conversation：含子任务列表 + 各自 conversation_id 跳转链接 + 执行状态 | |
| 5.5.3 | 如果部分子任务失败，标注失败原因 | |

**依赖**：3.3（流结束后 TaskExecutionLog 回写完成）

---

## Phase 6: 打磨与边界处理

### 6.1 并发控制

**文件**：`apps/server/src/service/orchestrator_agent.py`（修改）

| # | 任务 | 说明 |
|---|------|------|
| 6.1.1 | 实现 `_can_assign_to_employee(db, employee_id) -> bool` | 查 `TaskExecutionLog` 中 `run_status='running'` 且 `employee_id` 匹配的数量 |
| 6.1.2 | 定义 `MAX_CONCURRENT_PER_EMPLOYEE = 2` | |
| 6.1.3 | 在 `_start_task_as_conversation()` 调用前检查 | 超出并发上限时该子任务状态置为 `queued`，等其他任务完成后再启动 |

**依赖**：3.1

---

### 6.2 任务依赖执行

**文件**：`apps/server/src/service/orchestrator_agent.py`（修改 `confirm_orchestration_plan` Tool）

| # | 任务 | 说明 |
|---|------|------|
| 6.2.1 | 如果 tasks JSON 中有 `depends_on` 字段，按拓扑排序执行 | 无依赖的先并发启动，有依赖的等前驱完成后启动 |
| 6.2.2 | 依赖检测：`depends_on` 指向 tasks 数组索引 | 依赖任务 completed 后才启动当前任务 |
| 6.2.3 | 循环依赖检测 | 有循环依赖时拒绝执行，返回错误 |

**依赖**：3.1

---

### 6.3 错误处理与重试

**文件**：`apps/server/src/service/chat_service.py`（修改 `_finalize_task_stream`）

| # | 任务 | 说明 |
|---|------|------|
| 6.3.1 | stream 异常（LLM 超时/网络错误）→ `TaskExecutionLog.run_status = "failed"` + 错误信息 | |
| 6.3.2 | 编排任务失败时不阻塞其他子任务 | 每个子任务独立的 asyncio task |
| 6.3.3 | workspace 事件推送 `task_failed` | |

**依赖**：3.3

---

### 6.4 编排任务过期处理

**文件**：`apps/server/src/service/task_scheduler_service.py`（修改 `reload_jobs`）

| # | 任务 | 说明 |
|---|------|------|
| 6.4.1 | 在 `reload_jobs()` 中过滤 `valid_until` 已过期的任务 | `valid_until IS NOT NULL AND valid_until < cst_now()` → 跳过不调度 |
| 6.4.2 | 已过期任务自动设置 `is_active = False` | |

**依赖**：1.2（valid_until 字段已存在）

---

### 6.5 编排历史查看

**文件**：`apps/web/src/components/workbench/`（新建或修改）

| # | 任务 | 说明 |
|---|------|------|
| 6.5.1 | 在 Workbench 或总管面板增加"编排历史"视图 | 调用 `GET /orchestration/plans` |
| 6.5.2 | 每条记录显示：创建时间、摘要、状态、完成数/总数 | |
| 6.5.3 | 点击展开子任务详情 + 执行日志链接 | |

**依赖**：3.8

---

## 快速参考：新增文件清单

| 文件 | Phase |
|------|-------|
| `apps/server/src/models/orchestration_plan.py` | 1.1 |
| `apps/server/src/schemas/orchestration.py` | 1.6 |
| `apps/server/src/service/workspace_events.py` | 1.9 |
| `apps/server/src/service/orchestrator_agent.py` | 2.1-2.7 |
| `apps/server/src/api/orchestration_api.py` | 3.8 |
| `apps/web/src/components/chat/orchestration-plan-card.tsx` | 3.6 |
| `apps/web/src/components/chat/task-progress-bar.tsx` | 3.7 |
| `apps/web/src/hooks/use-workspace-events.ts` | 5.1 |
| `apps/web/src/stores/orchestration-store.ts` | 5.2 |

## 快速参考：修改文件清单

| 文件 | Phase | 改动要点 |
|------|-------|----------|
| `apps/server/src/models/employee_task.py` | 1.2 | +6 字段 |
| `apps/server/src/models/task_execution_log.py` | 1.3 | +conversation_id |
| `apps/server/src/models/conversation.py` | 1.4 | target_type +curator |
| `apps/server/src/schemas/conversation.py` | 1.5 | TargetType 枚举 |
| `apps/server/src/models/__init__.py` | 1.8 | 导入新模型 |
| `apps/server/src/db/init_db.py` | 1.7 | ensure_column × 7 |
| `apps/server/src/api/workspace_api.py` | 1.9 | +events 端点 |
| `apps/server/src/api/__init__.py` | 3.8 | 注册新路由 |
| `apps/server/src/service/chat_service.py` | 2.8 + 3.3 | curator 分支 + 流结束回写 |
| `apps/server/src/service/task_scheduler_service.py` | 3.1 + 3.2 + 4.1 + 6.4 | _start_task_as_conversation + parse_nl_cron + 过期过滤 |
| `apps/web/src/lib/chat/message-classifier.ts` | 3.5 | 新增事件类型 |
| `apps/web/src/components/chat/curator-view.tsx` | 5.3 | 重构为真实对话 |
| `apps/web/src/components/chat/chat-panel.tsx` | 5.4 | 渲染确认卡片 |

---

## 执行顺序建议

```
Phase 1（无依赖）
    ↓
Phase 2（依赖 Phase 1 的模型）
    ↓
Phase 3（依赖 Phase 2 的 Tool，Phase 1 的 workspace events）
    ↓
Phase 4（依赖 Phase 2 的 Tool 逻辑）
    ↓
Phase 5（依赖 Phase 1 的 events、Phase 3 的组件）
    ↓
Phase 6（依赖所有前序 Phase，收尾）
```

同一 Phase 内可并行的任务：
- Phase 1：1.1+1.2+1.3+1.4 可并行 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9
- Phase 2：2.1 → 2.2 + 2.3 并行 → 2.4 + 2.5 并行 → 2.6 → 2.7 → 2.8
- Phase 3：3.1 → 3.2 → 3.3 → 3.4 + 3.5 + 3.6 + 3.7 并行 → 3.8
- Phase 5：5.1 + 5.2 并行 → 5.3 + 5.4 并行 → 5.5
