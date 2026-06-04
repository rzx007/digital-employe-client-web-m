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


def _resolve_room_shared_artifacts_dir(
    db: Session, orchestrator_conversation_id: int | None, root_path: str
) -> str | None:
    """若该编排会话是某群房间的组长会话，返回房间共享产物目录，否则 None。

    群协作时所有成员共享 `<root_path>/room-<room_id>/artifacts`，
    上游产出对下游可见。非群编排返回 None（保持原有按会话隔离）。
    """
    if orchestrator_conversation_id is None:
        return None
    try:
        from pathlib import Path

        from src.models.group_room import GroupRoom

        room = db.scalars(
            select(GroupRoom).where(
                GroupRoom.leader_conversation_id == orchestrator_conversation_id
            )
        ).first()
        if room is None:
            return None
        shared = Path(root_path) / f"room-{room.id}" / "artifacts"
        shared.mkdir(parents=True, exist_ok=True)
        return str(shared)
    except Exception:
        logger.warning(
            "resolve room shared artifacts dir failed orch_conv=%s",
            orchestrator_conversation_id,
            exc_info=True,
        )
        return None


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

    from src.service.agent.orchestrator.dependency_scheduler import (
        build_dependency_maps,
    )

    task_lookup: dict[int, EmployeeTask] = {t.id: t for t in tasks}
    # 真·DAG：依赖映射统一由 dependency_scheduler 构造，支持 int / int[] 多依赖。
    # 注意 build_dependency_maps 按 tasks 的传入顺序对应 plan_json 下标，
    # 这里 tasks 已按 priority/id 排序，须用与 plan_json 一致的"创建顺序"。
    plan_tasks = sorted(tasks, key=lambda t: t.id)
    dep_map, _successors = build_dependency_maps(plan_tasks, plan_json_obj)
    dep_count: dict[int, int] = {t.id: len(dep_map.get(t.id, [])) for t in tasks}

    # 完成驱动：这里**只派根任务**（无前置）。有前置的任务由
    # dependency_scheduler.on_employee_task_completed 在前置真正完成后再派，
    # 从而实现"A 干完才起 B"的真·串行（修复历史的"启动即递减"伪 DAG）。
    root_ids: list[int] = [t.id for t in tasks if dep_count.get(t.id, 0) == 0]
    started_ids: set[int] = set()
    skipped_ids: set[int] = set()
    results: list[str] = []

    for tid in root_ids:
        task = task_lookup.get(tid)
        if not task:
            continue
        employee = db.get(Employee, task.employee_id)
        if not employee:
            results.append(f"任务 {task.task_name}: 员工不存在，跳过")
            skipped_ids.add(tid)
            continue
        if not can_assign_to_employee(db, task.employee_id):
            results.append(
                f"任务 {task.task_name}: 员工 {get_employee_name(db, task.employee_id)} "
                f"达到并发上限({MAX_CONCURRENT_PER_EMPLOYEE})，稍后由调度器重试"
            )
            continue
        try:
            conv_id = start_task_as_conversation(db, task, employee, workspace_id)
            results.append(f"任务 {task.task_name}: 已创建会话 #{conv_id}")
            started_ids.add(tid)
        except Exception as exc:
            logger.error(
                "启动即时任务失败 task_id=%s: %s", task.id, exc, exc_info=True
            )
            results.append(f"任务 {task.task_name}: 启动失败 - {exc}")
            skipped_ids.add(tid)

    waiting = [
        t for t in tasks
        if dep_count.get(t.id, 0) > 0 and t.id not in skipped_ids
    ]
    if waiting:
        results.append(
            f"{len(waiting)} 个任务等待前置完成后由调度器自动派发"
        )

    return results


def start_task_as_conversation(
    db: Session,
    task: EmployeeTask,
    employee: Employee,
    workspace_id: int,
    *,
    priority: int = ORCHESTRATION_PRIORITY,
    source: str = "orchestration",
    prereq_briefing: str = "",
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

    # 群协作：若本任务属于某房间（组长派的活），让它用房间共享产物目录，
    # 这样上游成员产出的文件对下游成员可见（解决"下游找不到上游产物"）。
    shared_artifacts_dir = _resolve_room_shared_artifacts_dir(db, orch_conv_id, root_path)

    agent = get_agent(
        skills_path,
        root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        enable_hitl=False,
        shared_artifacts_dir=shared_artifacts_dir,
    )

    dispatch_directive = (
        "【系统指令】你正在被总管自动派单执行，没有真人坐在对面。"
        "请按下方任务描述直接产出最终结果，"
        "不要请求澄清、不要让用户填写表单、不要等待确认。"
        "信息不足时用合理默认值或在产出中说明假设即可。"
    )
    dispatch_body = f"{dispatch_directive}\n\n{task.user_prompt or ''}"
    if prereq_briefing:
        dispatch_body = f"{dispatch_body}\n{prereq_briefing}"
    messages: list[dict] = [
        {
            "role": "user",
            "content": dispatch_body,
        },
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
