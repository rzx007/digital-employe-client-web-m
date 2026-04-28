from __future__ import annotations

import asyncio
import json
import logging
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from sqlalchemy import select
from sqlalchemy.orm import Session

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend
from deepagents.middleware.permissions import FilesystemPermission
from src.core.config import get_settings
from src.models.employee import Employee
from src.models.employee_mcp import EmployeeMcp
from src.models.employee_skill import EmployeeSkill
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.workspace import cst_now
from src.service.agent import get_checkpointer

load_dotenv()

logger = logging.getLogger(__name__)

MAX_CONCURRENT_PER_EMPLOYEE = 2

_main_loop: asyncio.AbstractEventLoop | None = None


def set_main_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def _get_main_loop() -> asyncio.AbstractEventLoop:
    if _main_loop is None:
        raise RuntimeError("main event loop not set")
    return _main_loop

_db_session_ctx: ContextVar[Session | None] = ContextVar("orchestrator_db", default=None)
_workspace_id_ctx: ContextVar[int | None] = ContextVar("orchestrator_ws", default=None)
_conversation_id_ctx: ContextVar[int | None] = ContextVar("orchestrator_conv", default=None)


def _get_db() -> Session:
    db = _db_session_ctx.get()
    if db is None:
        raise RuntimeError("orchestrator DB session not set")
    return db


def _get_workspace_id() -> int:
    ws = _workspace_id_ctx.get()
    if ws is None:
        raise RuntimeError("orchestrator workspace_id not set")
    return ws


def _get_conversation_id() -> int | None:
    return _conversation_id_ctx.get()


def _set_context(db: Session, workspace_id: int, conversation_id: int | None = None) -> None:
    _db_session_ctx.set(db)
    _workspace_id_ctx.set(workspace_id)
    _conversation_id_ctx.set(conversation_id)


def _count_running_tasks(db: Session, employee_id: int) -> int:
    from src.models.task_execution_log import TaskExecutionLog
    from sqlalchemy import func
    return db.scalar(
        select(func.count(TaskExecutionLog.id)).where(
            TaskExecutionLog.employee_id == employee_id,
            TaskExecutionLog.run_status == "running",
        )
    ) or 0


def _can_assign_to_employee(db: Session, employee_id: int) -> bool:
    return _count_running_tasks(db, employee_id) < MAX_CONCURRENT_PER_EMPLOYEE


def _get_employee_name(db: Session, employee_id: int) -> str:
    emp = db.get(Employee, employee_id)
    return emp.name if emp else f"#{employee_id}"


def _mark_task_failed(task_id: int, conversation_id: int, error: str) -> None:
    from src.db.session import get_session_local
    from sqlalchemy import select
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    from src.service.workspace_events import WorkspaceEventBus

    db = get_session_local()()
    try:
        log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.task_id == task_id,
                TaskExecutionLog.run_status == "running",
            )
        ).first()
        if log:
            log.run_status = "failed"
            log.run_result = "任务执行失败"
            log.error_message = error[:2000] if error else "agent thread crash"
            log.ended_at = cst_now()
            if log.started_at:
                log.duration_ms = int((log.ended_at - log.started_at).total_seconds() * 1000)
            db.commit()
            WorkspaceEventBus.push(log.workspace_id, {
                "type": "task_failed",
                "task_id": task_id,
                "conversation_id": conversation_id,
                "error": error[:200],
            })
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def _build_employee_capability_context(db: Session, workspace_id: int) -> str:
    employees = list(
        db.scalars(
            select(Employee)
            .where(Employee.workspace_id == workspace_id)
            .order_by(Employee.id.asc())
        ).all()
    )
    if not employees:
        return "（当前工作空间没有数字员工）"

    lines = ["| ID | 姓名 | 岗位 | 技能 | 外接能力(MCP) |", "|---|---|---|---|---|"]
    for emp in employees:
        skills = list(
            db.scalars(
                select(EmployeeSkill).where(EmployeeSkill.employee_id == emp.id)
            ).all()
        )
        skills_line = ", ".join(
            f"{s.skill_name}({s.skill_name_zh})"
            for s in skills
            if s.skill_name
        ) or "—"
        mcps = list(
            db.scalars(
                select(EmployeeMcp).where(EmployeeMcp.employee_id == emp.id)
            ).all()
        )
        mcps_line = ", ".join(
            f"{m.capability_name}"
            for m in mcps
            if m.capability_name
        ) or "—"
        lines.append(f"| {emp.id} | {emp.name} | {emp.employee_code or '—'} | {skills_line} | {mcps_line} |")

    return "\n".join(lines)


ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE = """今天的时间是{current_time}

你是数字员工团队的总管助手。你的职责是理解用户的指令，将其拆解为具体任务，分配给最合适的数字员工。

## 可用数字员工
{employee_table}

## 工作流程
1. 用户描述需求后，先调用 `list_workspace_employees` 查看当前可用的员工及其技能
2. 分析需求，拆解为可独立执行的子任务
3. 为每个子任务指派最合适的员工（根据技能和角色匹配）
4. 调用 `create_orchestration_plan` 将编排计划落库，生成确认卡片
5. 用户确认后，调用 `confirm_orchestration_plan` 开始执行

## 子任务拆解规则
- 每个子任务必须对应一个具体的数字员工，不要自己编造
- 任务 prompt 要写清楚具体做什么，输出什么，格式如何
- 如果有定时需求，cron 字段使用标准 cron 表达式（如 "30 9 * * *" 表示每天上午 9:30）
- cron 为 null 表示立即执行
- 如果用户描述了多个时间段的行为（如"周一写代码，周三review"），拆成多条独立的子任务
- 不要自己直接执行任务，你的职责只是拆解和分配

## 输出约定
- 始终用中文回复
- 生成编排计划后，向用户展示摘要并请求确认
- 确认后开始执行，执行中汇报进度
"""


@tool
def list_workspace_employees() -> str:
    """列出当前工作空间所有数字员工及其角色、技能、MCP 外接能力。在拆解任务前必须先调用此工具。"""
    db = _get_db()
    workspace_id = _get_workspace_id()
    return _build_employee_capability_context(db, workspace_id)


@tool
def create_orchestration_plan(summary: str, tasks: str) -> str:
    """创建任务编排计划。调用时机：确认任务拆解和员工分配无误后调用。

    参数:
      summary: 编排计划的中文描述
      tasks: JSON 数组字符串，每个元素格式:
        {{
          "employee_id": <int>,
          "task_name": "<任务名称>",
          "prompt": "<下发给该员工 Agent 的执行指令>",
          "dispatch_type": "skill",
          "skill_id": <int | null>,
          "cron": "<cron 表达式 | null>",
          "priority": <int>,
          "depends_on": <int | null>
        }}
    """
    db = _get_db()
    workspace_id = _get_workspace_id()
    conversation_id = _get_conversation_id()

    if not conversation_id:
        return "错误：当前没有活跃的对话，无法创建编排计划。"

    try:
        task_list: list[dict] = json.loads(tasks)
    except json.JSONDecodeError as exc:
        return f"错误：tasks 参数格式不是合法的 JSON 数组: {exc}"

    if not isinstance(task_list, list) or len(task_list) == 0:
        return "错误：tasks 不能为空，至少需要一个子任务。"

    for i, t in enumerate(task_list):
        emp = db.get(Employee, t.get("employee_id"))
        if not emp:
            return f"错误：子任务 #{i} 指定的员工 ID={t.get('employee_id')} 不存在。"

    plan = OrchestrationPlan(
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        user_input=summary,
        plan_json=json.dumps(task_list, ensure_ascii=False),
        status="pending_confirmation",
        total_tasks=len(task_list),
        completed_tasks=0,
    )
    db.add(plan)
    db.flush()

    for t in task_list:
        cron_expr = t.get("cron")
        task = EmployeeTask(
            workspace_id=workspace_id,
            employee_id=t["employee_id"],
            employee_name_snapshot=t.get("employee_name") or "",
            task_name=t["task_name"],
            dispatch_type=t.get("dispatch_type", "skill"),
            skill_id=t.get("skill_id"),
            cron_expression=cron_expr if cron_expr else "",
            cron_expression_type="custom",
            user_prompt=t.get("prompt", ""),
            execute_mode="scheduled" if cron_expr else "immediate",
            source="orchestration",
            orchestration_plan_id=plan.id,
            priority=t.get("priority", 0),
            is_active=True,
        )
        db.add(task)

    db.commit()

    from src.service.workspace_events import WorkspaceEventBus
    WorkspaceEventBus.push(workspace_id, {
        "type": "orchestration_plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
    })

    return f"编排计划 #{plan.id} 已生成，包含 {len(task_list)} 个子任务，请确认后开始执行。"


@tool
def confirm_orchestration_plan(plan_id: int) -> str:
    """用户确认编排计划后调用，开始执行所有子任务。
    注意：此工具只有当用户明确说「确认」「开始执行」「没问题」「可以」等时才能调用。"""
    db = _get_db()
    workspace_id = _get_workspace_id()

    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"错误：编排计划 #{plan_id} 不存在。"

    if plan.status != "pending_confirmation":
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法执行。"

    return _execute_plan(db, plan, workspace_id)


def _execute_plan(db: Session, plan: OrchestrationPlan, workspace_id: int) -> str:
    plan.status = "executing"
    plan.started_at = cst_now()
    db.commit()

    tasks = list(
        db.scalars(
            select(EmployeeTask).where(
                EmployeeTask.orchestration_plan_id == plan.id
            ).order_by(EmployeeTask.priority.desc(), EmployeeTask.id.asc())
        ).all()
    )

    immediate_tasks = [t for t in tasks if t.execute_mode == "immediate"]
    scheduled_tasks = [t for t in tasks if t.execute_mode == "scheduled"]

    results: list[str] = []

    if scheduled_tasks:
        from src.service.task_scheduler_service import TaskSchedulerService
        TaskSchedulerService.reload_jobs()
        results.append(f"{len(scheduled_tasks)} 个定时任务已加入调度队列")

    if immediate_tasks:
        results += _start_immediate_tasks(db, immediate_tasks, plan, workspace_id)

    return "\n".join([f"编排计划 #{plan.id} 执行中："] + results)


def _start_immediate_tasks(
    db: Session,
    tasks: list[EmployeeTask],
    plan: OrchestrationPlan,
    workspace_id: int,
) -> list[str]:
    plan_json_obj: list[dict] = json.loads(plan.plan_json or "[]")

    task_lookup: dict[int, EmployeeTask] = {t.id: t for t in tasks}
    task_order: dict[int, int] = {}
    for i, t in enumerate(tasks):
        task_order[t.id] = i

    dep_map: dict[int, list[int]] = {}
    dep_count: dict[int, int] = {}
    for i, t in enumerate(tasks):
        deps: list[int] = []
        try:
            raw = plan_json_obj[i].get("depends_on") if i < len(plan_json_obj) else None
            if isinstance(raw, int):
                dep_task = tasks[raw] if raw < len(tasks) else None
                if dep_task and dep_task.id in task_lookup:
                    deps = [dep_task.id]
        except (IndexError, TypeError):
            pass
        dep_map[t.id] = deps
        dep_count[t.id] = len(deps)

    ready_ids: set[int] = {
        t.id for t in tasks if dep_count.get(t.id, 0) == 0
    }
    started_ids: set[int] = set()
    skipped_ids: set[int] = set()
    results: list[str] = []

    while ready_ids:
        batch: list[EmployeeTask] = []
        for tid in list(ready_ids):
            if tid in started_ids or tid in skipped_ids:
                ready_ids.discard(tid)
                continue
            t = task_lookup.get(tid)
            if not t:
                continue
            emp = db.get(Employee, t.employee_id)
            if not emp:
                results.append(f"任务 {t.task_name}: 员工不存在，跳过")
                skipped_ids.add(tid)
                ready_ids.discard(tid)
                continue
            if not _can_assign_to_employee(db, t.employee_id):
                continue
            batch.append(t)

        if not batch:
            break

        for task in batch:
            employee = db.get(Employee, task.employee_id)
            try:
                conv_id = _start_task_as_conversation(db, task, employee, workspace_id)
                results.append(f"任务 {task.task_name}: 已启动（会话 #{conv_id}）")
                started_ids.add(task.id)
                ready_ids.discard(task.id)

                for other_id, other_deps in dep_map.items():
                    if task.id in other_deps:
                        dep_count[other_id] = dep_count.get(other_id, 0) - 1
                        if dep_count[other_id] <= 0:
                            ready_ids.add(other_id)
            except Exception as exc:
                logger.error(
                    "启动即时任务失败 task_id=%s: %s", task.id, exc, exc_info=True
                )
                results.append(f"任务 {task.task_name}: 启动失败 - {exc}")
                skipped_ids.add(task.id)
                ready_ids.discard(task.id)

    pending = set(t.id for t in tasks) - started_ids - skipped_ids
    if pending:
        unreachable: list[str] = []
        at_capacity: list[str] = []
        for tid in pending:
            t = task_lookup.get(tid)
            if not t:
                continue
            if dep_count.get(tid, 0) > 0:
                unreachable.append(f"任务 {t.task_name}: 前置任务未完成")
            elif not _can_assign_to_employee(db, t.employee_id):
                at_capacity.append(
                    f"任务 {t.task_name}: 员工 {_get_employee_name(db, t.employee_id)} 达到并发上限({MAX_CONCURRENT_PER_EMPLOYEE})"
                )
        results.extend(unreachable)
        results.extend(at_capacity)

    return results


def _start_task_as_conversation(
    db: Session,
    task: EmployeeTask,
    employee: Employee,
    workspace_id: int,
) -> int:
    from src.models.conversation import Conversation, ConversationMessage
    from src.service.chat_service import ChatService
    from src.service.agent import get_agent
    from src.service.stream_registry import registry
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.workspace_events import WorkspaceEventBus

    conversation = Conversation(
        workspace_id=workspace_id,
        target_type="employee",
        target_id=employee.id,
        title=task.task_name,
    )
    db.add(conversation)
    db.flush()

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
        conversation_id=conversation.id,
        started_at=cst_now(),
    )
    db.add(run_log)

    user_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=task.user_prompt,
        stream_state="completed",
    )
    db.add(user_msg)

    assistant_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content="",
        stream_state="streaming",
    )
    db.add(assistant_msg)
    db.flush()

    try:
        skills_path = ChatService.resolve_employee_skills_dir(
            skills_payload=employee.skills_json,
            employee_id=employee.id,
            employee_name=employee.name,
            employee_code=employee.employee_code,
        )
    except Exception:
        skills_path = ""
    settings = get_settings()
    root_path = settings.artifacts_path

    agent = get_agent(skills_path, root_path, employee_id=employee.id, conversation_id=conversation.id)

    messages: list[dict] = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in [
            {"role": "user", "content": task.user_prompt or ""},
        ]
    ]

    db.commit()

    main_loop = _get_main_loop()
    main_loop.call_soon_threadsafe(
        lambda: registry.start(
            conversation_id=conversation.id,
            agent=agent,
            messages=messages,
            config={"configurable": {"thread_id": f"task-{task.id}-{int(datetime.now().timestamp())}"}},
            stream_msg_id=assistant_msg.id,
            skill_name="",
            debug_content_only=False,
        )
    )

    WorkspaceEventBus.push(workspace_id, {
        "type": "task_started",
        "task_id": task.id,
        "conversation_id": conversation.id,
        "employee_id": employee.id,
        "employee_name": employee.name,
        "task_name": task.task_name,
    })

    return conversation.id


def get_orchestrator_agent(
    workspace_id: int,
    db: Session,
    conversation_id: int | None = None,
):
    _set_context(db, workspace_id, conversation_id)

    settings = get_settings()
    model = ChatOpenAI(
        model=settings.deepagent_model or "qwen2.5-72b-instruct",
        temperature=0,
        api_key=settings.api_key,
        base_url=settings.base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    employee_context = _build_employee_capability_context(db, workspace_id)
    system_prompt = ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE.format(
        current_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        employee_table=employee_context,
    )

    base_dir = Path(__file__).resolve().parent
    agent_fs = FilesystemBackend(root_dir=str(base_dir), virtual_mode=True)
    backend = CompositeBackend(default=agent_fs, routes={})

    checkpointer = get_checkpointer()

    agent = create_deep_agent(
        model=model,
        tools=[list_workspace_employees, create_orchestration_plan, confirm_orchestration_plan],
        system_prompt=system_prompt,
        backend=backend,
        checkpointer=checkpointer,
        subagents=[],
        permissions=[
            FilesystemPermission(
                operations=["write"],
                paths=["/**"],
                mode="deny",
            ),
        ],
    )
    return agent
