from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.workspace import cst_now
from src.models.response import PageResponse, ResponseBase
from src.schemas.task import (
    EmployeeTaskRead,
    EmployeeSkillTaskScheduleRead,
    MonthlyCalendarRead,
    EmployeeTaskScheduleRead,
    TaskExecutionLogRead,
    TaskExecutionSkillRatingRead,
    TaskSyncResult,
    TodayTaskRead,
    ExecutionMetricsRead,
)
from src.service.employee_service import EmployeeService
from src.service.workspace_service import WorkspaceService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService

router = APIRouter(tags=["任务调度"])


def _loads_json(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _task_execution_log_to_read(item) -> TaskExecutionLogRead:
    summ = getattr(item, "skill_rating_summary", None)
    skill_rating = None
    if summ is not None:
        skill_rating = TaskExecutionSkillRatingRead(
            id=summ.id,
            skill_id=summ.skill_id,
            skill_name=summ.skill_name,
            score=summ.score,
            comment=summ.comment,
            created_at=summ.created_at,
        )
    return TaskExecutionLogRead(
        id=item.id,
        task_id=item.task_id,
        workspace_id=item.workspace_id,
        employee_id=item.employee_id,
        employee_name=getattr(item, "employee_name", None),
        dispatch_type=getattr(item, "dispatch_type", None),
        skill_id=item.skill_id,
        task_name=item.task_name_snapshot,
        run_status=item.run_status,
        run_result=item.run_result,
        error_message=item.error_message,
        input=_loads_json(item.input_json, {}),
        output=_loads_json(item.output_json, {}),
        started_at=item.started_at,
        ended_at=item.ended_at,
        duration_ms=item.duration_ms,
        confirm_url=item.confirm_url,
        confirm_execution_result=getattr(item, "confirm_execution_result", None),
        result_confirmed=getattr(item, "result_confirmed", False),
        is_read=getattr(item, "is_read", False),
        conversation_id=getattr(item, "conversation_id", None),
        skill_rating=skill_rating,
    )


def _to_task_read(task) -> EmployeeTaskRead:
    return EmployeeTaskRead(
        id=task.id,
        workspace_id=task.workspace_id,
        employee_id=task.employee_id,
        employee_name_snapshot=task.employee_name_snapshot,
        task_name=task.task_name,
        dispatch_type=task.dispatch_type,
        skill_id=task.skill_id,
        capability_id=getattr(task, "capability_id", None),
        priority=task.priority,
        task_type=task.task_type,
        cron_expression=task.cron_expression,
        cron_expression_type=task.cron_expression_type,
        is_active=task.is_active,
        confirm_execution_result=task.confirm_execution_result,
        user_prompt=task.user_prompt,
        source=getattr(task, "source", None) or "manual",
        task_input=_loads_json(task.task_input_json, {}),
        next_run_at=task.next_run_at,
        last_run_at=task.last_run_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.get("/workspaces/{workspace_id}/tasks/sync", response_model=ResponseBase[TaskSyncResult])
def sync_workspace_tasks(workspace_id: int, db: Session = Depends(get_db)) -> ResponseBase[TaskSyncResult]:
    """同步指定工作空间的员工任务，并刷新调度器作业。"""
    WorkspaceService.get_workspace(db, workspace_id)
    tasks = TaskService.sync_workspace_tasks(db, workspace_id)
    TaskSchedulerService.reload_jobs()
    payload = TaskSyncResult(
        workspace_id=workspace_id,
        synced_count=len(tasks),
        tasks=[_to_task_read(task) for task in tasks],
    )
    return ResponseBase(data=payload)


@router.get(
    "/employees/{employee_id}/tasks/schedule",
    response_model=ResponseBase[EmployeeSkillTaskScheduleRead],
)
def get_employee_task_schedule(
    employee_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[EmployeeSkillTaskScheduleRead]:
    """
    查询员工的 skill 任务排班信息。

    参数说明：
    - employee_id: 员工ID（路径参数），用于定位具体员工。
    - db: 数据库会话（依赖注入参数）。

    返回说明：
    - 返回员工个人信息（含 shift_schedule）、该员工的 skill 任务明细，以及当天执行时间点。
    """
    employee = EmployeeService.get_employee(db, employee_id)
    target_date = cst_now().date()
    skill_tasks = TaskService.list_active_tasks(db, workspace_id=employee.workspace_id, employee_id=employee_id)
    # schedules = TaskService.build_daily_schedule(db, employee.workspace_id, employee_id, target_date=target_date)
    payload = EmployeeSkillTaskScheduleRead(
        employee=EmployeeService.employee_detail_dict(db, employee),
        date=target_date,
        skill_tasks=[_to_task_read(task) for task in skill_tasks],
        schedules=[],
    )
    return ResponseBase(data=payload)


@router.get("/tasks/calendar/monthly", response_model=ResponseBase[MonthlyCalendarRead])
def get_monthly_task_calendar(
    employee_id: int | None = Query(default=None),
    year: int | None = Query(default=None, ge=1970, le=9999),
    month: int | None = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db),
) -> ResponseBase[MonthlyCalendarRead]:
    """
    获取月度日历视图，展示每天的排班和任务情况。

    参数说明：
    - employee_id: 员工ID（可选），不传则查询所有员工。
    - year: 年份（可选），不传默认当前年。
    - month: 月份（可选），不传默认当前月。
    """
    payload = TaskService.build_monthly_calendar(
        db=db,
        year=year,
        month=month,
        employee_id=employee_id,
    )
    return ResponseBase(data=MonthlyCalendarRead(**payload))


@router.get("/workspaces/{workspace_id}/tasks/today", response_model=ResponseBase[list[TodayTaskRead]])
def list_today_tasks(
    workspace_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[list[TodayTaskRead]]:
    """获取今日所有任务统一视图：包含待执行(pending)和已执行的各种状态。"""
    items = TaskService.list_today_tasks(db, workspace_id)
    return ResponseBase(data=[TodayTaskRead(**item) for item in items])


@router.get(
    "/workspaces/{workspace_id}/employees/{employee_id}/tasks/execution-metrics",
    response_model=ResponseBase[ExecutionMetricsRead],
)
def get_employee_execution_metrics(
    workspace_id: int,
    employee_id: int,
    days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
) -> ResponseBase[ExecutionMetricsRead]:
    """近 N 日执行失败率等指标（聚合 task_execution_logs）。"""
    EmployeeService.get_employee(db, employee_id)
    payload = TaskService.get_execution_metrics(
        db=db,
        workspace_id=workspace_id,
        employee_id=employee_id,
        days=days,
    )
    return ResponseBase(data=ExecutionMetricsRead(**payload))


@router.get("/workspaces/{workspace_id}/tasks/executions", response_model=PageResponse[list[TaskExecutionLogRead]])
def list_task_executions(
    workspace_id: int,
    employee_id: int | None = Query(default=None),
    task_id: int | None = Query(default=None),
    run_status: str | None = Query(default=None),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    orchestrator_conversation_id: int | None = Query(default=None),
    orchestration_plan_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> PageResponse[list[TaskExecutionLogRead]]:
    """
    分页查询任务执行日志。

    支持按员工、任务、状态和时间范围过滤。
    orchestrator_conversation_id：按总管会话过滤（经编排计划 JOIN）。
    """
    items, total = TaskService.list_execution_logs(
        db=db,
        workspace_id=workspace_id,
        employee_id=employee_id,
        task_id=task_id,
        run_status=run_status,
        start_time=start_time,
        end_time=end_time,
        orchestrator_conversation_id=orchestrator_conversation_id,
        orchestration_plan_id=orchestration_plan_id,
        page=page,
        page_size=page_size,
    )
    payload = [_task_execution_log_to_read(item) for item in items]
    return PageResponse(data=payload, total=total, page=page, page_size=page_size)


@router.delete(
    "/workspaces/{workspace_id}/tasks/executions",
    response_model=ResponseBase[dict],
    summary="清空所有任务执行日志",
)
def delete_all_task_executions(
    workspace_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[dict]:
    """清空指定工作空间的所有任务执行日志。"""
    count = TaskService.delete_all_execution_logs(db, workspace_id)
    return ResponseBase(data={"deleted": count})


@router.post(
    "/workspaces/{workspace_id}/tasks/executions/{task_execution_log_id}/confirm",
    response_model=ResponseBase[TaskExecutionLogRead],
    summary="确认任务执行结果",
)
def confirm_task_execution_result(
    workspace_id: int,
    task_execution_log_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[TaskExecutionLogRead]:
    """将指定执行日志标记为已确认（result_confirmed=true）。"""
    log = TaskService.confirm_task_execution_log(
        db, workspace_id=workspace_id, execution_log_id=task_execution_log_id
    )
    return ResponseBase(data=_task_execution_log_to_read(log))


@router.post(
    "/workspaces/{workspace_id}/tasks/executions/{task_execution_log_id}/read",
    response_model=ResponseBase[TaskExecutionLogRead],
    summary="确认任务日志已读",
)
def mark_task_execution_read(
    workspace_id: int,
    task_execution_log_id: int,
    db: Session = Depends(get_db),
) -> ResponseBase[TaskExecutionLogRead]:
    """将指定执行日志标记为已读（is_read=true）。"""
    log = TaskService.mark_task_execution_log_read(
        db, workspace_id=workspace_id, execution_log_id=task_execution_log_id
    )
    return ResponseBase(data=_task_execution_log_to_read(log))

