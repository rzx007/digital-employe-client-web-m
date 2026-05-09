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
from deepagents.middleware.summarization import (
    SummarizationMiddleware,
    SummarizationToolMiddleware,
)
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
    """
    main_loop = 应用主 asyncio 循环的句柄；
    call_soon_threadsafe 用来在「非 async / 可能跨线程」的 orchestrator 代码里，
    安全地把「启动流式 agent 任务」丢回主循环执行，避免 asyncio.create_task 用错循环。
    """
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
1. 先调用 `list_workspace_employees` 查看当前可用的员工及其技能
2. 分析需求，拆解为可独立执行的子任务
3. 为每个子任务指派最合适的员工（根据技能和角色匹配）
4. 调用 `create_orchestration_plan` 将编排计划落库

## 确认策略（必须遵守）
- **简单任务**（全部即时执行、无依赖、子任务数 ≤ 2）：
  → 调用 `create_orchestration_plan` 后，**立即在同一轮接着调用** `confirm_orchestration_plan(plan_id=<id>)`
  → 直接告知用户"已自动执行，无需确认"
- **其他任务**（定时、有依赖、或 ≥ 3 个子任务）：
  → 只调用 `create_orchestration_plan`
  → 等待用户回复「确认」「执行」「可以」「没问题」等后再调用 `confirm_orchestration_plan`
- **只能**通过调用 `confirm_orchestration_plan` 工具来执行，口头说"开始执行"没有效果

## 任务管理工具
- `update_task(task_id, task_name?, prompt?, cron?, employee_id?)` → 修改已有子任务
- `delete_task(task_id)` → 删除子任务（设置 is_active=false）
- `cancel_plan(plan_id)` → 取消整个编排计划

## 子任务拆解规则
- 每个子任务必须对应一个具体的数字员工，不要自己编造
- 任务 prompt 要写清楚具体做什么，输出什么，格式如何
- 如果有定时需求，cron 字段使用标准 cron 表达式（如 "30 9 * * *" 表示每天上午 9:30）
- cron 为 null 表示立即执行
- 如果用户描述了多个时间段的行为（如"周一写代码，周三review"），拆成多条独立的子任务
- 不要自己直接执行任务，你的职责只是拆解和分配

## 输出约定
- 始终用中文回复
- 简单任务自动执行后直接告知结果
- 复杂任务生成计划后展示摘要，等待用户确认
- 确认后开始执行，执行中汇报进度

重要：你所有的工具调用都会产生实际效果。如果你只回复文字而不调用工具，什么事情都不会发生。尤其是编排计划，必须通过 confirm_orchestration_plan 工具来执行。

## 上下文管理
- 你可以调用 `compact_conversation` 工具来压缩对话历史，释放上下文空间
- 以下情况适合主动压缩：
  - 一个编排计划已确认执行完毕，用户开始讨论新任务前
  - 工具返回内容很长（如任务列表、编排计划详情），且后续不再需要这些细节
  - 感觉对话轮次较多、响应变慢时
- 压缩不会丢失关键信息，旧消息会被摘要替代
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
        status="pending",
        total_tasks=len(task_list),
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
    tasks_for_event: list[dict] = []
    for t in task_list:
        emp = db.get(Employee, t["employee_id"])
        tasks_for_event.append({
            "task_id": t.get("task_name", ""),
            "task_name": t.get("task_name", ""),
            "employee_name": emp.name if emp else "",
            "cron": t.get("cron"),
            "execute_mode": "scheduled" if t.get("cron") else "immediate",
        })
    WorkspaceEventBus.push(workspace_id, {
        "type": "orchestration_plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "tasks": tasks_for_event,
    })

    plan_json_output = json.dumps({
        "type": "plan_generated",
        "plan_id": plan.id,
        "summary": summary,
        "total_tasks": len(task_list),
        "tasks": tasks_for_event,
    }, ensure_ascii=False)

    return plan_json_output + "\n\n" + f"编排计划 #{plan.id} 已生成，包含 {len(task_list)} 个子任务。\n请回复「确认」开始执行。记住：只有调用 confirm_orchestration_plan({plan.id}) 工具才能执行。"


@tool
def confirm_orchestration_plan(plan_id: int) -> str:
    """用户确认编排计划后调用，开始执行所有子任务。
    注意：此工具只有当用户明确说「确认」「开始执行」「没问题」「可以」等时才能调用。"""
    db = _get_db()
    workspace_id = _get_workspace_id()

    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"错误：编排计划 #{plan_id} 不存在。"

    if plan.status != "pending":
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法执行。"

    return _execute_plan(db, plan, workspace_id)


def _execute_plan(db: Session, plan: OrchestrationPlan, workspace_id: int) -> str:
    plan.status = "confirmed"
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
    """
    启动无需等待或依赖已满足的即时任务。

    该函数解析编排计划中的依赖关系，构建任务依赖图，并尝试启动所有当前可执行的任务。
    它会检查员工是否存在、是否达到并发上限，并处理任务启动过程中的异常。
    对于因依赖未满足或员工容量限制而无法启动的任务，会在最后生成相应的状态消息。

    Args:
        db (Session): 数据库会话对象，用于查询员工信息和启动任务会话。
        tasks (list[EmployeeTask]): 待处理的任务列表。
        plan (OrchestrationPlan): 编排计划对象，包含任务依赖关系的JSON描述。
        workspace_id (int): 工作空间ID，用于创建任务会话。

    Returns:
        list[str]: 任务执行结果的消息列表，包含成功启动、跳过、失败及Pending原因的描述。


    环节	                            EmployeeTask 的职责
    create_orchestration_plan Tool	    直接写 employee_tasks 表（source="orchestration"）
    _execute_plan	                    读 EmployeeTask WHERE orchestration_plan_id = plan.id 来执行
    _start_task_as_conversation	        读 task.user_prompt 作为员工 Agent 的输入，写 TaskExecutionLog（run_status="running", conversation_id）
    TaskSchedulerService.reload_jobs	读 EmployeeTask 创建 APScheduler 定时任务
    _finalize_task_stream	            曾更新 OrchestrationPlan.completed_tasks → 已移除，现状：只更新 TaskExecutionLog.run_status
    _compute_plan_progress（查询时）	 从 TaskExecutionLog 聚合 completed_tasks + 派生 status
    """
    plan_json_obj: list[dict] = json.loads(plan.plan_json or "[]")

    # 构建任务ID到任务对象的映射，以及任务ID到原始顺序索引的映射
    task_lookup: dict[int, EmployeeTask] = {t.id: t for t in tasks}
    task_order: dict[int, int] = {}
    for i, t in enumerate(tasks):
        task_order[t.id] = i

    # 解析依赖关系，构建依赖地图和每个任务的剩余依赖计数
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

    # 初始化就绪队列（无依赖的任务），以及记录已启动和已跳过的任务ID
    ready_ids: set[int] = {
        t.id for t in tasks if dep_count.get(t.id, 0) == 0
    }
    started_ids: set[int] = set()
    skipped_ids: set[int] = set()
    results: list[str] = []

    # 循环处理就绪队列中的任务，直到没有更多可立即启动的任务
    while ready_ids:
        batch: list[EmployeeTask] = []
        for tid in list(ready_ids):
            if tid in started_ids or tid in skipped_ids:
                ready_ids.discard(tid)
                continue
            t = task_lookup.get(tid)
            if not t:
                continue
            
            # 验证员工存在性，若不存在则标记为跳过
            emp = db.get(Employee, t.employee_id)
            if not emp:
                results.append(f"任务 {t.task_name}: 员工不存在，跳过")
                skipped_ids.add(tid)
                ready_ids.discard(tid)
                continue
            
            # 检查员工是否具备接收新任务的容量，若不具备则暂时不加入批次
            if not _can_assign_to_employee(db, t.employee_id):
                continue
            batch.append(t)

        if not batch:
            break

        # 批量启动当前符合条件的任务，并更新依赖状态
        for task in batch:
            employee = db.get(Employee, task.employee_id)
            try:
                conv_id = _start_task_as_conversation(db, task, employee, workspace_id)
                results.append(f"任务 {task.task_name}: 已启动（会话 #{conv_id}）")
                started_ids.add(task.id)
                ready_ids.discard(task.id)

                # 更新后续任务的依赖计数，若依赖满足则加入就绪队列
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

    # 处理最终仍处于Pending状态的任务，区分是因依赖未满足还是员工容量限制
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

    # Snapshots before commit: commit() expires instances; lazy reload can hit
    # SQLite misuse in threaded scheduler contexts. The main-loop callback must
    # not touch ORM objects from this Session on another thread.
    conversation_id = conversation.id
    assistant_msg_id = assistant_msg.id
    task_id_snap = task.id
    task_name_snap = task.task_name
    employee_id_snap = employee.id
    employee_name_snap = employee.name

    db.commit()

    thread_id = f"task-{task_id_snap}-{int(datetime.now().timestamp())}"
    main_loop = _get_main_loop()
    main_loop.call_soon_threadsafe(
        lambda: registry.start(
            conversation_id=conversation_id,
            agent=agent,
            messages=messages,
            config={"configurable": {"thread_id": thread_id}},
            stream_msg_id=assistant_msg_id,
            skill_name="",
            debug_content_only=False,
        )
    )

    WorkspaceEventBus.push(workspace_id, {
        "type": "task_started",
        "task_id": task_id_snap,
        "conversation_id": conversation_id,
        "employee_id": employee_id_snap,
        "employee_name": employee_name_snap,
        "task_name": task_name_snap,
    })

    return conversation_id


@tool
def update_task(task_id: int, task_name: str | None = None, prompt: str | None = None, cron: str | None = None, employee_id: int | None = None) -> str:
    """修改已存在的子任务。参数均可选，只更新传入的非 None 字段。
    - task_name: 修改任务名称
    - prompt: 修改执行指令文字
    - cron: 修改调度时间（标准 cron 表达式，null 表示改为立即执行）
    - employee_id: 重新分配给指定员工
    """
    db = _get_db()
    task = db.get(EmployeeTask, task_id)
    if not task:
        return f"错误：任务 #{task_id} 不存在。"

    changed: list[str] = []
    if task_name is not None:
        task.task_name = task_name
        changed.append("任务名称")
    if prompt is not None:
        task.user_prompt = prompt
        changed.append("执行指令")
    if cron is not None:
        task.cron_expression = cron if cron else ""
        task.execute_mode = "scheduled" if cron else "immediate"
        changed.append("调度时间")
    if employee_id is not None:
        emp = db.get(Employee, employee_id)
        if not emp:
            return f"错误：员工 ID={employee_id} 不存在。"
        task.employee_id = employee_id
        task.employee_name_snapshot = emp.name or ""
        changed.append("执行员工")

    if changed:
        db.commit()
        if "调度时间" in changed:
            from src.service.task_scheduler_service import TaskSchedulerService

            TaskSchedulerService.reload_jobs()
        return f"任务 #{task_id} ({task.task_name}) 已更新：{'、'.join(changed)}。"
    return "未做任何修改。"


@tool
def delete_task(task_id: int) -> str:
    """删除子任务（物理删除，关联的执行记录会保留但 task_id 置空）。"""
    db = _get_db()
    task = db.get(EmployeeTask, task_id)
    if not task:
        return f"错误：任务 #{task_id} 不存在。"

    db.delete(task)
    db.commit()
    from src.service.task_scheduler_service import TaskSchedulerService

    TaskSchedulerService.reload_jobs()
    return f"任务 #{task_id} ({task.task_name}) 已删除。"


@tool
def cancel_plan(plan_id: int) -> str:
    """取消整个编排计划（设置 status=cancelled）。"""
    db = _get_db()
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"错误：编排计划 #{plan_id} 不存在。"

    if plan.status not in ("pending", "confirmed"):
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法取消。"

    plan.status = "cancelled"
    db.commit()
    return f"编排计划 #{plan_id} 已取消。"


@tool
def list_tasks(status: str | None = None, plan_id: int | None = None, employee_id: int | None = None, limit: int = 20) -> str:
    """查询任务列表。查询当前工作空间下的 EmployeeTask。
    - status: 过滤执行状态（executing/completed/failed/cancelled），null=全部
    - plan_id: 过滤指定编排计划的任务，null=全部计划
    - employee_id: 过滤指定员工的任务，null=全部员工
    - limit: 最多返回条数（默认20）
    """
    db = _get_db()
    workspace_id = _get_workspace_id()

    query = select(EmployeeTask).where(
        EmployeeTask.workspace_id == workspace_id,
        EmployeeTask.is_active.is_(True),
    )

    if plan_id is not None:
        query = query.where(EmployeeTask.orchestration_plan_id == plan_id)
    if employee_id is not None:
        query = query.where(EmployeeTask.employee_id == employee_id)
    if status is not None:
        if status in ("executing", ):
            from src.models.task_execution_log import TaskExecutionLog
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "running"
            ).distinct()
            query = query.where(
                (EmployeeTask.execute_mode == "scheduled")
                | (EmployeeTask.id.in_(sub))
            )
        elif status in ("completed", "success"):
            from src.models.task_execution_log import TaskExecutionLog
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status == "success"
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status in ("failed", "timeout", "cancelled"):
            from src.models.task_execution_log import TaskExecutionLog
            sub = select(TaskExecutionLog.task_id).where(
                TaskExecutionLog.run_status.in_(["failed", "timeout", "cancelled"])
            ).distinct()
            query = query.where(EmployeeTask.id.in_(sub))
        elif status == "pending":
            query = query.where(
                EmployeeTask.execute_mode == "scheduled",
                ~EmployeeTask.id.in_(
                    select(TaskExecutionLog.task_id).distinct()
                ),
            )

    tasks = list(db.scalars(query.order_by(EmployeeTask.priority.desc(), EmployeeTask.id.desc()).limit(limit)).all())

    if not tasks:
        return "没有找到匹配的任务。"

    lines = ["| ID | 任务名 | 员工 | 执行模式 | 状态 |", "|---|---|---|---|---|"]
    from src.models.task_execution_log import TaskExecutionLog
    for t in tasks:
        emp = db.get(Employee, t.employee_id)
        emp_name = emp.name if emp else (t.employee_name_snapshot or str(t.employee_id))
        mode = "定时" if t.execute_mode == "scheduled" else "即时"
        latest_log = db.scalars(
            select(TaskExecutionLog.run_status).where(
                TaskExecutionLog.task_id == t.id
            ).order_by(TaskExecutionLog.id.desc()).limit(1)
        ).first()
        task_status = latest_log or ("运行中" if t.execute_mode == "scheduled" else "未执行")
        lines.append(f"| {t.id} | {t.task_name} | {emp_name} | {mode} | {task_status} |")

    return "\n".join(lines)


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
    model.profile = {"max_input_tokens": 131072}

    employee_context = _build_employee_capability_context(db, workspace_id)
    system_prompt = ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE.format(
        current_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        employee_table=employee_context,
    )

    history_root = Path(settings.artifacts_path)
    history_root.mkdir(parents=True, exist_ok=True)
    agent_fs = FilesystemBackend(root_dir=str(history_root), virtual_mode=True)
    backend = CompositeBackend(default=agent_fs, routes={})

    checkpointer = get_checkpointer()

    summarization_ref = SummarizationMiddleware(
        model=model,
        backend=backend,
        trigger=("fraction", 0.85),
        keep=("fraction", 0.10),
    )
    summarization_tool_mw = SummarizationToolMiddleware(summarization_ref)

    agent = create_deep_agent(
        model=model,
        tools=[list_workspace_employees, create_orchestration_plan, confirm_orchestration_plan, update_task, delete_task, cancel_plan, list_tasks],
        system_prompt=system_prompt,
        backend=backend,
        checkpointer=checkpointer,
        middleware=[summarization_tool_mw],
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
