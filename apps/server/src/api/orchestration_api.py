from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.orchestration import OrchestrationPlanDetail, OrchestrationPlanRead, OrchestrationTaskItem

router = APIRouter(tags=["编排"])
logger = logging.getLogger(__name__)


def _compute_plan_progress(db: Session, plan: OrchestrationPlan) -> tuple[int, int, str]:
    """从 TaskExecutionLog 计算 completed_tasks 和派生 status。"""
    completed = db.scalar(
        select(func.count(func.distinct(TaskExecutionLog.task_id)))
        .select_from(EmployeeTask)
        .join(TaskExecutionLog, TaskExecutionLog.task_id == EmployeeTask.id)
        .where(
            EmployeeTask.orchestration_plan_id == plan.id,
            TaskExecutionLog.run_status != "running",
        )
    ) or 0

    failed = db.scalar(
        select(func.count(func.distinct(TaskExecutionLog.task_id)))
        .select_from(EmployeeTask)
        .join(TaskExecutionLog, TaskExecutionLog.task_id == EmployeeTask.id)
        .where(
            EmployeeTask.orchestration_plan_id == plan.id,
            TaskExecutionLog.run_status.in_(["failed", "timeout", "cancelled"]),
        )
    ) or 0

    total = db.scalar(
        select(func.count())
        .select_from(EmployeeTask)
        .where(EmployeeTask.orchestration_plan_id == plan.id)
    ) or 0

    status = plan.status
    if status == "executing" and completed >= total:
        status = "completed" if failed == 0 else "partially_failed"

    return completed, total, status


def _build_task_items(db: Session, plan: OrchestrationPlan) -> list[OrchestrationTaskItem]:
    tasks = list(
        db.scalars(
            select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan.id).order_by(EmployeeTask.id.asc())
        ).all()
    )
    items: list[OrchestrationTaskItem] = []
    for t in tasks:
        status: str = "pending"
        if t.execute_mode == "scheduled":
            status = "pending"
        else:
            from src.models.task_execution_log import TaskExecutionLog
            log = db.scalars(
                select(TaskExecutionLog).where(
                    TaskExecutionLog.task_id == t.id,
                ).order_by(TaskExecutionLog.id.desc()).limit(1)
            ).first()
            if log:
                if log.run_status == "success":
                    status = "success"
                elif log.run_status in ("failed", "cancelled"):
                    status = log.run_status
                elif log.run_status == "running":
                    status = "running"

        items.append(OrchestrationTaskItem(
            task_id=t.id,
            employee_id=t.employee_id,
            employee_name=t.employee_name_snapshot or "",
            task_name=t.task_name,
            prompt=t.user_prompt or "",
            dispatch_type=t.dispatch_type,
            skill_id=t.skill_id,
            cron=t.cron_expression,
            execute_mode=t.execute_mode,
            priority=t.priority,
            status=status,
        ))
    return items


@router.get("/orchestration/plans", response_model=ListResponse[OrchestrationPlanRead])
def list_plans(
    workspace_id: int,
    db: Session = Depends(get_db),
) -> ListResponse[OrchestrationPlanRead]:
    plans = list(
        db.scalars(
            select(OrchestrationPlan)
            .where(OrchestrationPlan.workspace_id == workspace_id)
            .order_by(OrchestrationPlan.id.desc())
            .limit(50)
        ).all()
    )
    result: list[OrchestrationPlanRead] = []
    for p in plans:
        plan_data = OrchestrationPlanRead.model_validate(p)
        completed, total, status = _compute_plan_progress(db, p)
        plan_data.completed_tasks = completed
        plan_data.total_tasks = max(total, p.total_tasks)
        plan_data.status = status
        result.append(plan_data)
    return ListResponse(data=result)


@router.get("/orchestration/plans/{plan_id}", response_model=ResponseBase[OrchestrationPlanDetail])
def get_plan(plan_id: int, db: Session = Depends(get_db)) -> ResponseBase[OrchestrationPlanDetail]:
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="编排计划不存在")
    plan_data = OrchestrationPlanRead.model_validate(plan)
    completed, total, status = _compute_plan_progress(db, plan)
    plan_data.completed_tasks = completed
    plan_data.total_tasks = max(total, plan.total_tasks)
    plan_data.status = status
    return ResponseBase(data=OrchestrationPlanDetail(
        plan=plan_data,
        tasks=_build_task_items(db, plan),
    ))


@router.put("/orchestration/plans/{plan_id}/confirm", response_model=BaseResponse)
def confirm_plan(plan_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="编排计划不存在")
    if plan.status != "pending_confirmation":
        return BaseResponse(code=400, msg=f"计划当前状态为 {plan.status}，无法确认", data=None)

    from src.service.orchestrator_agent import _execute_plan
    result = _execute_plan(db, plan, plan.workspace_id)

    from src.service.workspace_events import WorkspaceEventBus
    WorkspaceEventBus.push(plan.workspace_id, {
        "type": "orchestration_plan_generated",
        "plan_id": plan.id,
        "status": "executing",
    })

    return BaseResponse(data={
        "plan_id": plan_id,
        "status": "executing",
        "result": result,
    })


@router.put("/orchestration/plans/{plan_id}/cancel", response_model=BaseResponse)
def cancel_plan(plan_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    plan = db.get(OrchestrationPlan, plan_id)
    if not plan:
        from fastapi import HTTPException
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="编排计划不存在")
    if plan.status not in ("pending_confirmation", "executing"):
        return BaseResponse(code=400, msg=f"计划当前状态为 {plan.status}，无法取消", data=None)

    plan.status = "cancelled"
    db.commit()
    return BaseResponse(data={"plan_id": plan_id, "status": "cancelled"})
