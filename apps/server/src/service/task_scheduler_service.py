from __future__ import annotations

import json
import logging
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler  # pylint: disable=import-error
from apscheduler.triggers.cron import CronTrigger  # pylint: disable=import-error
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.agent_runtime_policy import SCHEDULED_PRIORITY
from src.core.request_utils import DEFAULT_USER_ID
from src.db.session import get_session_local
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import CST, Workspace, cst_now
from src.service.task_service import TaskService

logger = logging.getLogger(__name__)


class TaskSchedulerService:
    _scheduler: BackgroundScheduler | None = None
    _job_prefix = "employee_task:"
    _dispatch_order_sync_job_id = "system:dispatch_order_sync"

    @classmethod
    def _get_scheduler(cls) -> BackgroundScheduler:
        if cls._scheduler is None:
            cls._scheduler = BackgroundScheduler(timezone=CST)
        return cls._scheduler

    @classmethod
    def start(cls) -> None:
        scheduler = cls._get_scheduler()
        if not scheduler.running:
            scheduler.start()
        cls.reload_jobs()
        cls._register_system_jobs()

    @classmethod
    def shutdown(cls) -> None:
        if cls._scheduler and cls._scheduler.running:
            cls._scheduler.shutdown(wait=False)

    @classmethod
    def reload_jobs(cls) -> None:
        scheduler = cls._get_scheduler()
        if not scheduler.running:
            return

        for job in scheduler.get_jobs():
            if job.id.startswith(cls._job_prefix) or job.id.startswith("plan:"):
                scheduler.remove_job(job.id)

        with get_session_local()() as db:
            from src.models.orchestration_plan import OrchestrationPlan
            now = cst_now()
            # task 级 cron 扫描：仅挂独立任务（无 orchestration_plan_id）。
            # 编排子任务统一由 plan 级调度（schedule_kind）驱动，绝不走 task 级双重调度。
            tasks = list(
                db.scalars(
                    select(EmployeeTask).where(
                        EmployeeTask.is_active.is_(True),
                        EmployeeTask.dispatch_type == "skill",
                        (EmployeeTask.valid_until.is_(None))
                        | (EmployeeTask.valid_until >= now),
                        EmployeeTask.cron_expression.isnot(None),
                        func.trim(EmployeeTask.cron_expression) != "",
                        EmployeeTask.orchestration_plan_id.is_(None),
                    ).order_by(
                        EmployeeTask.priority.desc(),
                        EmployeeTask.id.desc(),
                    )
                ).all()
            )

            expired_tasks = [
                t for t in list(
                    db.scalars(
                        select(EmployeeTask).where(
                            EmployeeTask.is_active.is_(True),
                            EmployeeTask.valid_until.isnot(None),
                            EmployeeTask.valid_until < now,
                        )
                    ).all()
                )
            ]
            for t in expired_tasks:
                t.is_active = False
                logger.info("任务已过期，自动停用 task_id=%s task_name=%s", t.id, t.task_name)
            if expired_tasks:
                db.commit()

            for task in tasks:
                cron = (task.cron_expression or "").strip()
                if TaskService.compute_next_run(cron, now=now) is None:
                    logger.warning(
                        "跳过无法解析的 cron 任务 task_id=%s cron=%r",
                        task.id,
                        cron,
                    )
                    continue

                trigger = CronTrigger.from_crontab(cron, timezone=CST)
                job_id = f"{cls._job_prefix}{task.id}"
                scheduler.add_job(
                    cls.run_task_job,
                    trigger=trigger,
                    id=job_id,
                    args=[task.id],
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                    misfire_grace_time=120,
                )
                job = scheduler.get_job(job_id)
                task.next_run_at = job.next_run_time if job else TaskService.compute_next_run(cron)
                db.add(task)
            db.commit()

            # 计划级调度：按 schedule_kind 分派 —— recurring→CronTrigger，once→DateTrigger（未跑且未来）
            from apscheduler.triggers.date import DateTrigger
            plans = list(db.scalars(
                select(OrchestrationPlan).where(
                    OrchestrationPlan.status == "confirmed",
                    OrchestrationPlan.schedule_kind.isnot(None),
                )
            ).all())
            for plan in plans:
                job_id = f"plan:{plan.id}"
                if plan.schedule_kind == "recurring":
                    cron = (plan.cron or "").strip()
                    if not cron or TaskService.compute_next_run(cron, now=now) is None:
                        logger.warning("跳过无法解析的 recurring cron plan_id=%s cron=%r", plan.id, cron)
                        continue
                    trigger = CronTrigger.from_crontab(cron, timezone=CST)
                elif plan.schedule_kind == "once":
                    if plan.last_run_at is None and plan.run_at is not None and plan.run_at <= now:
                        # 一次性任务错过触发窗口（如后端宕机）：过期即失效，标 done 离开活跃集
                        logger.warning("一次性计划已过期未触发，标记失效 plan_id=%s run_at=%s", plan.id, plan.run_at)
                        plan.status = "done"
                        continue
                    if plan.last_run_at is not None or plan.run_at is None:
                        continue
                    trigger = DateTrigger(run_date=plan.run_at, timezone=CST)
                else:
                    continue
                scheduler.add_job(
                    cls.run_plan_job, trigger=trigger, id=job_id, args=[plan.id],
                    replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=120,
                )
                job = scheduler.get_job(job_id)
                plan.next_run_at = job.next_run_time if job else (
                    TaskService.compute_next_run(plan.cron) if plan.schedule_kind == "recurring" else plan.run_at
                )
            db.commit()
        cls._register_system_jobs()

    @classmethod
    def _register_system_jobs(cls) -> None:
        scheduler = cls._get_scheduler()
        if not scheduler.running:
            return
        
        from src.core.runtime_capabilities import get_capabilities
        caps = get_capabilities()
        
        SYSTEM_JOBS = [
            (
                "dispatch_order_sync",
                cls.run_dispatch_order_sync_job,
                "*/5 * * * *",
                cls._dispatch_order_sync_job_id
            )
        ]
        
        for capability, fn, cron, job_id in SYSTEM_JOBS:
            if not getattr(caps, capability, False):
                if scheduler.get_job(job_id):
                    scheduler.remove_job(job_id)
                    logger.info("已移除系统任务（能力已禁用） job_id=%s", job_id)
                continue
            scheduler.add_job(
                fn,
                trigger=CronTrigger.from_crontab(cron, timezone=CST),
                id=job_id,
                replace_existing=True,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=120,
            )

    @staticmethod
    def run_dispatch_order_sync_job() -> None:
        from src.core.runtime_capabilities import get_capabilities
        from src.service.dispatch_order_sync_service import DispatchOrderSyncService

        if not get_capabilities().dispatch_order_sync:
            logger.debug("跳过派单同步：dispatch_order_sync 能力已禁用")
            return

        try:
            result = DispatchOrderSyncService.sync_and_trigger()
        except Exception as exc:
            logger.warning("派单同步失败（已忽略，不影响调度器）: %s", exc)
            return

        logger.info(
            "派单同步完成 synced=%s inserted=%s updated=%s triggered=%s",
            result.get("synced_count"),
            result.get("inserted_count"),
            result.get("updated_count"),
            result.get("triggered_count"),
        )

    @staticmethod
    def _loads_json(raw: str | None, default: Any) -> Any:
        if not raw:
            return default
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return default

    @staticmethod
    def _to_int(value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _to_json_string(payload: Any) -> str:
        try:
            return json.dumps(payload, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return json.dumps({"raw": str(payload)}, ensure_ascii=False)

    @staticmethod
    def _stringify_lc_message_content(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict):
                    if block.get("type") == "text" and "text" in block:
                        parts.append(str(block.get("text", "")))
                    elif "text" in block:
                        parts.append(str(block["text"]))
            return "".join(parts)
        return str(content)

    @staticmethod
    def _extract_final_agent_text(invoke_result: Any) -> str:
        """从 agent.invoke 的返回状态中提取最后一条 AI 可见文本（用于定时任务 output_json）。"""
        if invoke_result is None:
            return ""
        if isinstance(invoke_result, str):
            return invoke_result.strip()

        messages = None
        if isinstance(invoke_result, dict):
            messages = invoke_result.get("messages")
        if messages is None:
            messages = getattr(invoke_result, "messages", None)
        if not isinstance(messages, (list, tuple)) or not messages:
            return ""

        try:
            from langchain_core.messages import AIMessage as _AIMessage
        except ImportError:
            _AIMessage = None

        for msg in reversed(messages):
            if _AIMessage is not None and isinstance(msg, _AIMessage):
                return TaskSchedulerService._stringify_lc_message_content(
                    msg.content
                ).strip()
            if type(msg).__name__ == "AIMessage":
                return TaskSchedulerService._stringify_lc_message_content(
                    getattr(msg, "content", "")
                ).strip()
            if isinstance(msg, dict):
                t = msg.get("type")
                if t in ("ai", "assistant"):
                    return TaskSchedulerService._stringify_lc_message_content(
                        msg.get("content")
                    ).strip()

        last = messages[-1]
        if isinstance(last, dict):
            return TaskSchedulerService._stringify_lc_message_content(
                last.get("content")
            ).strip()
        return TaskSchedulerService._stringify_lc_message_content(
            getattr(last, "content", "")
        ).strip()

    @classmethod
    def _start_curator_task(cls, db: Session, task: EmployeeTask, employee: Employee) -> None:
        """总管员工的定时任务：投递到 curator 会话，由 orchestrator agent 执行。"""
        from src.core.agent_runtime_policy import get_agent_runtime_policy
        from src.models.conversation import Conversation, ConversationMessage
        from src.service.agent.orchestrator import get_orchestrator_agent, _get_main_loop
        from src.service.stream_registry import registry as _stream_registry
        from src.service.workspace_events import WorkspaceEventBus

        workspace_id = task.workspace_id
        policy = get_agent_runtime_policy()
        # 与 _can_start_now 同源：按生效并发上限判断初始日志状态。
        _cap = policy.effective_max_inflight()
        slot_busy = (
            _cap > 0 and _stream_registry.count_active_streams() >= _cap
        )
        initial_log_status = "queued" if slot_busy else "running"
        initial_log_result = "排队中，等待执行" if slot_busy else "执行中"
        initial_msg_state = "queued" if slot_busy else "streaming"

        # 1. 解析总管会话：优先任务绑定的 source_conversation_id，否则 ensure 默认会话
        from src.service.chat_service import ChatService

        conv: Conversation | None = None
        if task.source_conversation_id is not None:
            candidate = db.get(Conversation, task.source_conversation_id)
            if (
                candidate is not None
                and candidate.workspace_id == workspace_id
                and candidate.target_type == "curator"
            ):
                conv = candidate
            else:
                logger.warning(
                    "总管定时任务 task_id=%s source_conversation_id=%s 无效，回退默认总管会话",
                    task.id,
                    task.source_conversation_id,
                )

        if conv is None:
            ws = db.get(Workspace, workspace_id)
            _uid = ws.user_id if ws is not None else DEFAULT_USER_ID
            curator_read = ChatService.ensure_curator_conversation(
                db, _uid, workspace_id
            )
            conv = db.get(Conversation, curator_read.id)
            if conv is None:
                raise RuntimeError(
                    f"ensure_curator_conversation 返回 id={curator_read.id} 但会话不存在"
                )

        if task.source_conversation_id is None:
            task.source_conversation_id = conv.id

        # 2. 创建 TaskExecutionLog

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
            conversation_id=conv.id,
            orchestrator_conversation_id=conv.id,
            started_at=cst_now(),
        )
        db.add(run_log)
        db.flush()

        # 3. 用户消息
        user_msg = ConversationMessage(
            conversation_id=conv.id,
            role="user",
            content=task.user_prompt or task.task_name,
            stream_state="completed",
        )
        db.add(user_msg)

        # 4. 助手消息
        assistant_msg = ConversationMessage(
            conversation_id=conv.id,
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

        conv_id = conv.id
        asst_msg_id = assistant_msg.id
        task_name_snap = task.task_name
        workspace_id_snap = workspace_id
        employee_id_snap = employee.id
        messages = [
            {"role": "user", "content": task.user_prompt or ""},
        ]

        db.commit()

        # 在主事件循环上创建 agent 并启动流，确保总管 Tool 的 ContextVar 与 astream 同线程
        def _start_on_main() -> None:
            from src.db.session import get_session_local
            from src.service.agent.orchestrator.runtime import reset_context

            orch_db = get_session_local()()
            try:
                # user_id 由 runtime 兜底从激活 workspace 所有者解析（见 resolve_user_id），
                # 此处 bind_context=False 不绑定。
                agent = get_orchestrator_agent(
                    workspace_id_snap,
                    orch_db,
                    conv_id,
                    employee_id=employee_id_snap,
                    bind_context=False,
                )
                from src.service.agent_stream_queue import StartResult

                result = _stream_registry.start(
                    conversation_id=conv_id,
                    agent=agent,
                    messages=messages,
                    config={"configurable": {"thread_id": conv_id}},
                    stream_msg_id=asst_msg_id,
                    skill_name="",
                    debug_content_only=False,
                    orchestrator_owned_db=orch_db,
                    orchestrator_workspace_id=workspace_id_snap,
                    orchestrator_conversation_id=conv_id,
                    priority=SCHEDULED_PRIORITY,
                    source="scheduled",
                )
                if result == StartResult.REJECTED:
                    reset_context(conv_id)
                    orch_db.close()
            except Exception:
                reset_context(conv_id)
                orch_db.close()
                logger.error(
                    "总管定时任务启动流失败 task_id=%s conv_id=%s",
                    task.id,
                    conv_id,
                    exc_info=True,
                )

        main_loop = _get_main_loop()
        main_loop.call_soon_threadsafe(_start_on_main)

        WorkspaceEventBus.push(workspace_id, {
            "type": "task_started",
            "task_id": task.id,
            "conversation_id": conv_id,
            "employee_id": employee.id,
            "employee_name": employee.name,
            "task_name": task_name_snap,
        })

    @classmethod
    def run_plan_job(cls, plan_id: int) -> None:
        """计划级定时触发：走唯一原语 execute_plan_run；once 跑完自停。
        绝不调 _start_curator_task / 不重发总管消息 / 不重新分析分单。"""
        from src.models.orchestration_plan import OrchestrationPlan
        from src.service.agent.orchestrator.execution import execute_plan_run

        with get_session_local()() as db:
            plan = db.get(OrchestrationPlan, plan_id)
            if plan is None or plan.status != "confirmed" or not (plan.schedule_kind or "").strip():
                return
            run = None
            try:
                run = execute_plan_run(db, plan, trigger="scheduled", auto_accept=True)
            except Exception:
                logger.error("run_plan_job 触发失败 plan=%s", plan_id, exc_info=True)
                if run is not None:
                    run.status = "failed"
                    run.ended_at = cst_now()
            # once：跑完自停（status=done → reload_jobs 不再挂）
            if plan.schedule_kind == "once":
                plan.last_run_at = cst_now()
                plan.next_run_at = None
                plan.status = "done"
            else:  # recurring
                plan.last_run_at = cst_now()
                plan.next_run_at = TaskService.compute_next_run(plan.cron, now=plan.last_run_at)
            db.commit()
            logger.info("计划级定时触发 plan=%s kind=%s（绕开总管重分析）", plan_id, plan.schedule_kind)

    @classmethod
    def run_task_job(cls, task_id: int) -> None:
        with get_session_local()() as db:
            task = db.scalar(
                select(EmployeeTask).where(
                    EmployeeTask.id == task_id,
                    EmployeeTask.is_active.is_(True),
                    EmployeeTask.dispatch_type == "skill",
                )
            )
            if not task:
                return

            if task.orchestration_plan_id is not None:
                logger.warning(
                    "run_task_job 收到编排子任务（不应发生，reload_jobs 应已排除）task_id=%s plan_id=%s，按独立任务处理",
                    task_id, task.orchestration_plan_id,
                )

            employee = db.get(Employee, task.employee_id)

            try:
                if employee and employee.is_curator:
                    cls._start_curator_task(db, task, employee)
                else:
                    from src.service.agent.orchestrator import _start_task_as_conversation
                    _start_task_as_conversation(
                        db, task, employee, task.workspace_id,
                        priority=SCHEDULED_PRIORITY, source="scheduled",
                    )
                task.last_run_at = cst_now()
                task.next_run_at = TaskService.compute_next_run(task.cron_expression, now=task.last_run_at)
                db.add(task); db.commit()
                logger.info(
                    "定时任务启动 task_id=%s task_name=%s employee_id=%s is_curator=%s",
                    task_id, task.task_name, task.employee_id,
                    bool(employee and employee.is_curator),
                )
                return
            except Exception as exc:  # pylint: disable=broad-exception-caught
                logger.error("定时任务执行失败 task_id=%s", task_id, exc_info=True)
                task.last_run_at = cst_now()
                task.next_run_at = TaskService.compute_next_run(
                    task.cron_expression, now=task.last_run_at
                )
                db.add(task)
                db.commit()

