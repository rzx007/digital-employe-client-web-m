"""编排计划与任务删除/取消的生命周期一致性。"""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)


def cancel_running_executions_for_task(
    db: Session,
    task_id: int,
    *,
    reason: str = "任务已删除，执行已取消",
) -> int:
    """取消 task_id 上仍在 running 的执行，并更新 TaskExecutionLog。"""
    logs = list(
        db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.task_id == task_id,
                TaskExecutionLog.run_status == "running",
            )
        ).all()
    )
    if not logs:
        return 0

    from src.service.chat_service import ChatService

    now = cst_now()
    for log in logs:
        if log.conversation_id:
            ChatService.cancel_conversation_stream(log.conversation_id)
        log.run_status = "cancelled"
        log.run_result = reason
        log.ended_at = now
        if log.started_at:
            log.duration_ms = int(
                (
                    log.ended_at.replace(tzinfo=None)
                    - log.started_at.replace(tzinfo=None)
                ).total_seconds()
                * 1000
            )

    db.commit()
    logger.info(
        "cancelled %s running execution(s) for task_id=%s",
        len(logs),
        task_id,
    )
    return len(logs)


def finalize_orchestration_plan_if_empty(db: Session, plan_id: int) -> bool:
    """若编排计划下已无子任务，则将 plan 标为 cancelled。"""
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan or plan.status == "cancelled":
        return False

    remaining = (
        db.scalar(
            select(func.count())
            .select_from(EmployeeTask)
            .where(EmployeeTask.orchestration_plan_id == plan_id)
        )
        or 0
    )
    if remaining > 0:
        return False

    plan.status = "cancelled"
    db.commit()
    logger.info("orchestration plan #%s cancelled (no remaining tasks)", plan_id)
    return True


def cancel_orchestration_plan(db: Session, plan_id: int) -> str | None:
    """取消编排计划：终止进行中执行、停用子任务、刷新调度。"""
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        return f"编排计划 #{plan_id} 不存在。"
    if plan.status not in ("pending", "confirmed"):
        return f"编排计划 #{plan_id} 当前状态为 {plan.status}，无法取消。"

    tasks = list(
        db.scalars(
            select(EmployeeTask).where(
                EmployeeTask.orchestration_plan_id == plan_id
            )
        ).all()
    )

    for task in tasks:
        cancel_running_executions_for_task(
            db,
            task.id,
            reason="编排计划已取消，执行已终止",
        )
        task.is_active = False

    plan.status = "cancelled"
    db.commit()

    from src.service.task_scheduler_service import TaskSchedulerService

    TaskSchedulerService.reload_jobs()
    logger.info(
        "orchestration plan #%s cancelled, %s task(s) deactivated",
        plan_id,
        len(tasks),
    )
    return None
