from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.agent_runtime_policy import (
    ORCHESTRATION_PRIORITY,
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


def build_dispatch_extra_meta(*, task_id: int) -> dict[str, Any]:
    """派单 user 消息的 extra_meta（前端邮戳：总管派单）。"""
    return {
        "dispatchedByOrchestrator": True,
        "sourceTaskId": task_id,
    }


async def _start_employee_stream_when_orchestrator_idle(
    *,
    orchestrator_conversation_id: int | None,
    conversation_id: int,
    agent: Any,
    messages: list[dict],
    assistant_msg_id: int,
    priority: int = ORCHESTRATION_PRIORITY,
    source: str = "orchestration",
    stream_class: str | None = None,
    skip_orchestrator_wait: bool = False,
) -> None:
    from src.service.stream_registry import registry

    if orchestrator_conversation_id is not None and not skip_orchestrator_wait:
        polls = 0
        # 只等总管「正在流式输出」，不等 queued（排队不占 astream，白等会拖死派单）
        while registry.is_active(orchestrator_conversation_id):
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
        stream_class=stream_class,
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

    # 递归计划（计划级 cron）：只注册调度，不立即执行，等第一次 cron 触发
    if (plan.cron or "").strip():
        from src.service.task_scheduler_service import TaskSchedulerService
        plan.is_recurring = True
        db.commit()
        TaskSchedulerService.reload_jobs()
        return f"编排计划 #{plan.id} 已设为定时（{plan.cron}），将在每个节拍自动执行。"

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
        from src.service.agent.orchestrator.plan_run_service import open_plan_run
        run = open_plan_run(db, plan.id, workspace_id, trigger="manual", auto_accept=False)
        db.commit()
        results += start_immediate_tasks(db, immediate_tasks, plan, workspace_id, run_id=run.id)

    return "\n".join([f"编排计划 #{plan.id} 执行中："] + results)


# 兼容 orchestration_api 等既有 import
_execute_plan = execute_plan


def start_immediate_tasks(
    db: Session,
    tasks: list[EmployeeTask],
    plan: OrchestrationPlan,
    workspace_id: int,
    run_id: int | None = None,
) -> list[str]:
    plan_json_obj: list[dict] = json.loads(plan.plan_json or "[]")

    from src.service.agent.orchestrator.dependency_scheduler import (
        build_class_map,
        build_dependency_maps,
    )

    task_lookup: dict[int, EmployeeTask] = {t.id: t for t in tasks}
    # 真·DAG：依赖映射统一由 dependency_scheduler 构造，支持 int / int[] 多依赖。
    # 注意 build_dependency_maps 按 tasks 的传入顺序对应 plan_json 下标，
    # 这里 tasks 已按 priority/id 排序，须用与 plan_json 一致的"创建顺序"。
    plan_tasks = sorted(tasks, key=lambda t: t.id)
    dep_map, _successors = build_dependency_maps(plan_tasks, plan_json_obj)
    dep_count: dict[int, int] = {t.id: len(dep_map.get(t.id, [])) for t in tasks}
    cls_by_id = build_class_map(plan_tasks, plan_json_obj)  # 总管显式 heavy/light

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
            conv_id = start_task_as_conversation(
                db, task, employee, workspace_id,
                stream_class=cls_by_id.get(tid),
                run_id=run_id,
            )
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
    stream_class: str | None = None,
    run_id: int | None = None,
) -> int:
    from src.models.conversation import Conversation, ConversationMessage
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.agent.employee import get_agent
    from src.service.chat_service import ChatService
    from src.service.stream_registry import registry
    from src.service.workspace_events import WorkspaceEventBus

    from src.core.agent_runtime_policy import resolve_stream_class

    resolved_class = resolve_stream_class(stream_class, source)
    # 与资源阀门同源：按该任务类别判断初始日志状态(running/queued)，
    # 避免阀门已满却把日志记成"执行中"。
    slot_busy = not registry.can_admit(resolved_class)
    # 编排派单异步拉起（registry.start 在协程里）：在真正占槽前勿标 streaming，
    # 否则前端长时间「正在生成…」却无 token（等总管结束 / 排队 drain）。
    initial_log_status = "queued" if slot_busy else "running"
    initial_log_result = "排队中，等待执行" if slot_busy else "执行中"
    initial_msg_state = (
        "queued" if (slot_busy or source == "orchestration") else "streaming"
    )

    conversation = Conversation(
        workspace_id=workspace_id,
        user_id=employee.user_id,
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
        run_id=run_id,
    )
    db.add(run_log)

    user_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=task.user_prompt,
        stream_state="completed",
        # 标记派单来源：总管 1:1 编排 vs 群协作组长编排（前端邮戳区分）。
        extra_meta=json.dumps(
            build_dispatch_extra_meta(task_id=task.id),
            ensure_ascii=False,
        ),
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
        if slot_busy:
            queue_hint = "已加入执行队列，等待其他对话完成"
        elif source == "orchestration":
            queue_hint = "等待总管会话结束，即将开始执行…"
        else:
            queue_hint = "已加入执行队列，等待其他对话完成"
        assistant_msg.content = assistant_msg.content or queue_hint

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
    # SP2: 派单产物根改为该任务所属（被派员工）会话的 per-project 项目根，而非全局产物目录。
    # conversation 已 flush，按会话解析最直接（同一项目下与总管同写同一 artifacts 桶）。
    from src.service.product_paths import resolve_conversation_product_root

    root_path = str(resolve_conversation_product_root(db, conversation))

    # SP2 3.2a：共享桌已消解——被派员工用自己会话的项目根，得 <root>/artifacts，
    # 与同项目的总管同写同读，无需 desk override。

    # 输出档位：组长/总管派单时为该子任务指定的 output_tier（存在 task_input_json），
    # 决定该成员单次最多生成多少 token（small≈1k / standard≈16k / large≈64k）。
    from src.llm.factory import resolve_output_tokens

    _task_output_tier = "standard"
    try:
        _ti = json.loads(task.task_input_json or "{}")
        if isinstance(_ti, dict) and _ti.get("output_tier"):
            _task_output_tier = str(_ti["output_tier"])
    except (json.JSONDecodeError, TypeError):
        pass

    agent = get_agent(
        skills_path,
        root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        workspace_id=workspace_id,
        enable_hitl=False,
        max_output_tokens=resolve_output_tokens(_task_output_tier),
    )

    dispatch_directive = "【系统指令】你正在被总管自动派单执行，没有真人坐在对面。" + (
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
        skip_orch_wait = should_skip_orchestrator_wait(
            prereq_briefing=prereq_briefing,
        )
        asyncio.create_task(
            _start_employee_stream_when_orchestrator_idle(
                orchestrator_conversation_id=orch_conv_id,
                conversation_id=conversation_id,
                agent=agent,
                messages=messages,
                assistant_msg_id=assistant_msg_id,
                priority=priority,
                source=source,
                stream_class=resolved_class,
                skip_orchestrator_wait=skip_orch_wait,
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


def should_skip_orchestrator_wait(*, prereq_briefing: str = "") -> bool:
    """是否跳过「等编排会话 astream 结束再启员工流」。

    仅依赖调度器派发的后继任务（带前置产物简报）可跳过——此时总管流通常已结束。
    首轮派活须等总管 create/confirm 流结束，否则 orchestration 双 heavy 并行
    占满 GPU 槽（观测到 385s/6tok 僵死）。
    """
    return bool(prereq_briefing and prereq_briefing.strip())


_start_task_as_conversation = start_task_as_conversation
