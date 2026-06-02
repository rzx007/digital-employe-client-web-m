from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.core.agent_runtime_policy import (
    ORCHESTRATION_PRIORITY,
    get_agent_runtime_policy,
)
from src.service.agent_stream_queue import StartResult
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.workspace import cst_now
from src.service.agent.orchestrator.runtime import (
    MAX_CONCURRENT_PER_EMPLOYEE,
    can_assign_to_employee,
    get_employee_name,
    get_main_loop,
)
from src.service.orchestrator_conversation_links import (
    resolve_orchestrator_conversation_id,
)

logger = logging.getLogger(__name__)

# 避免总管 astream 未结束时启动员工 astream（LangGraph messages 并发串流）
_ORCH_STREAM_IDLE_POLL_SECONDS = 0.5
_ORCH_STREAM_IDLE_MAX_POLLS = 600  # 最多等待 5 分钟


async def _start_employee_stream_when_orchestrator_idle(
    *,
    orchestrator_conversation_id: int | None,
    conversation_id: int,
    agent: Any,
    messages: list[dict],
    assistant_msg_id: int,
    priority: int = ORCHESTRATION_PRIORITY,
    source: str = "orchestration",
) -> None:
    from src.service.stream_registry import registry

    if orchestrator_conversation_id is not None:
        polls = 0
        while registry.is_busy(orchestrator_conversation_id):
            polls += 1
            if polls > _ORCH_STREAM_IDLE_MAX_POLLS:
                logger.warning(
                    "orchestrator conv=%s still active after %ss, "
                    "starting employee conv=%s anyway",
                    orchestrator_conversation_id,
                    int(_ORCH_STREAM_IDLE_POLL_SECONDS * _ORCH_STREAM_IDLE_MAX_POLLS),
                    conversation_id,
                )
                break
            if polls == 1:
                logger.info(
                    "defer employee conv=%s until orchestrator conv=%s stream ends",
                    conversation_id,
                    orchestrator_conversation_id,
                )
            await asyncio.sleep(_ORCH_STREAM_IDLE_POLL_SECONDS)
        if polls > 0:
            logger.info(
                "orchestrator conv=%s idle after %s polls, starting employee conv=%s",
                orchestrator_conversation_id,
                polls,
                conversation_id,
            )

    result = registry.start(
        conversation_id=conversation_id,
        agent=agent,
        messages=messages,
        config={"configurable": {"thread_id": conversation_id}},
        stream_msg_id=assistant_msg_id,
        skill_name="",
        debug_content_only=False,
        orchestrator_conversation_id=orchestrator_conversation_id,
        priority=priority,
        source=source,
    )
    if result == StartResult.REJECTED:
        logger.warning(
            "employee stream start refused conv=%s (orchestrator=%s)",
            conversation_id,
            orchestrator_conversation_id,
        )
        from src.service.agent.orchestrator.runtime import (
            notify_task_failed_for_conversation,
        )
        from src.service.stream_registry import _mark_stream_state_sync

        error_text = "启动被拒绝：会话已有活跃或排队中的流"
        _mark_stream_state_sync(
            assistant_msg_id,
            conversation_id,
            "error",
            error_message=error_text,
        )
        notify_task_failed_for_conversation(conversation_id, error_text)
    elif result == StartResult.QUEUED:
        logger.info(
            "employee stream queued conv=%s (orchestrator=%s)",
            conversation_id,
            orchestrator_conversation_id,
        )


def execute_plan(db: Session, plan: OrchestrationPlan, workspace_id: int) -> str:
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
        results += start_immediate_tasks(db, immediate_tasks, plan, workspace_id)

    return "\n".join([f"编排计划 #{plan.id} 执行中："] + results)


# 兼容 orchestration_api 等既有 import
_execute_plan = execute_plan


def start_immediate_tasks(
    db: Session,
    tasks: list[EmployeeTask],
    plan: OrchestrationPlan,
    workspace_id: int,
) -> list[str]:
    plan_json_obj: list[dict] = json.loads(plan.plan_json or "[]")

    task_lookup: dict[int, EmployeeTask] = {t.id: t for t in tasks}
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

            if not can_assign_to_employee(db, t.employee_id):
                continue
            batch.append(t)

        if not batch:
            break

        for task in batch:
            employee = db.get(Employee, task.employee_id)
            try:
                conv_id = start_task_as_conversation(db, task, employee, workspace_id)
                results.append(f"任务 {task.task_name}: 已创建会话 #{conv_id}")
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
            elif not can_assign_to_employee(db, t.employee_id):
                at_capacity.append(
                    f"任务 {t.task_name}: 员工 {get_employee_name(db, t.employee_id)} 达到并发上限({MAX_CONCURRENT_PER_EMPLOYEE})"
                )
        results.extend(unreachable)
        results.extend(at_capacity)

    return results


def start_task_as_conversation(
    db: Session,
    task: EmployeeTask,
    employee: Employee,
    workspace_id: int,
    *,
    priority: int = ORCHESTRATION_PRIORITY,
    source: str = "orchestration",
) -> int:
    from src.models.conversation import Conversation, ConversationMessage
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.agent.employee import get_agent
    from src.service.chat_service import ChatService
    from src.service.stream_registry import registry
    from src.service.workspace_events import WorkspaceEventBus

    policy = get_agent_runtime_policy()
    slot_busy = (
        policy.serial_mode
        and registry.count_active_streams() >= policy.max_concurrent_streams
    )
    initial_log_status = "queued" if slot_busy else "running"
    initial_log_result = "排队中，等待执行" if slot_busy else "执行中"
    initial_msg_state = "queued" if slot_busy else "streaming"

    conversation = Conversation(
        workspace_id=workspace_id,
        target_type="employee",
        target_id=employee.id,
        title=task.task_name,
    )
    db.add(conversation)
    db.flush()

    orch_conv_id = resolve_orchestrator_conversation_id(db, task)
    if task.source_conversation_id is None and orch_conv_id is not None:
        task.source_conversation_id = orch_conv_id

    run_log = TaskExecutionLog(
        task_id=task.id,
        workspace_id=workspace_id,
        employee_id=employee.id,
        skill_id=task.skill_id,
        task_name_snapshot=task.task_name,
        run_status=initial_log_status,
        run_result=initial_log_result,
        input_json=task.task_input_json or "{}",
        output_json="{}",
        conversation_id=conversation.id,
        orchestrator_conversation_id=orch_conv_id,
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
        stream_state=initial_msg_state,
    )
    db.add(assistant_msg)
    db.flush()

    if initial_msg_state == "queued":
        assistant_msg.content = (
            assistant_msg.content or "已加入执行队列，等待其他对话完成"
        )

    conversation_id = conversation.id
    assistant_msg_id = assistant_msg.id
    task_id = task.id
    employee_id = employee.id
    employee_name = employee.name
    task_name = task.task_name

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

    agent = get_agent(
        skills_path,
        root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        enable_hitl=False,
    )

    dispatch_directive = (
        "【系统指令】你正在被总管自动派单执行，没有真人坐在对面。"
        "请按下方任务描述直接产出最终结果，"
        "不要请求澄清、不要让用户填写表单、不要等待确认。"
        "信息不足时用合理默认值或在产出中说明假设即可。"
    )
    messages: list[dict] = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in [
            {
                "role": "user",
                "content": f"{dispatch_directive}\n\n{task.user_prompt or ''}",
            },
        ]
    ]

    conversation_id = conversation.id
    assistant_msg_id = assistant_msg.id

    db.commit()

    main_loop = get_main_loop()

    def _schedule_employee_stream() -> None:
        asyncio.create_task(
            _start_employee_stream_when_orchestrator_idle(
                orchestrator_conversation_id=orch_conv_id,
                conversation_id=conversation_id,
                agent=agent,
                messages=messages,
                assistant_msg_id=assistant_msg_id,
                priority=priority,
                source=source,
            )
        )

    main_loop.call_soon_threadsafe(_schedule_employee_stream)

    WorkspaceEventBus.push(workspace_id, {
        "type": "task_started",
        "task_id": task_id,
        "conversation_id": conversation_id,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "task_name": task_name,
    })

    return conversation_id


_start_task_as_conversation = start_task_as_conversation
