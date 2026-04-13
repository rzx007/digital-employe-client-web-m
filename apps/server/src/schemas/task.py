from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, field_serializer
from src.schemas.employee import EmployeeRead


class EmployeeTaskRead(BaseModel):
    id: int
    workspace_id: int
    employee_id: int
    employee_name_snapshot: str | None
    task_name: str
    dispatch_type: str
    skill_id: int | None
    priority: int
    task_type: int | None
    cron_expression: str
    cron_expression_type: str
    is_active: bool
    confirm_execution_result: bool = False
    user_prompt: str | None = None
    task_input: dict[str, Any]
    next_run_at: datetime | None
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @field_serializer("next_run_at", "last_run_at", "created_at", "updated_at")
    def serialize_datetime(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.strftime("%Y-%m-%d %H:%M:%S")


class TaskSyncResult(BaseModel):
    workspace_id: int
    synced_count: int
    tasks: list[EmployeeTaskRead]


class EmployeeTaskScheduleRead(BaseModel):
    task_id: int
    task_name: str
    skill_id: int | None
    cron_expression: str
    execution_points: list[str]


class EmployeeTaskScheduleDayRead(BaseModel):
    workspace_id: int
    employee_id: int
    date: date
    schedules: list[EmployeeTaskScheduleRead]


class EmployeeSkillTaskScheduleRead(BaseModel):
    employee: EmployeeRead
    date: date
    skill_tasks: list[EmployeeTaskRead]
    # schedules: list[EmployeeTaskScheduleRead]


class TaskExecutionLogRead(BaseModel):
    id: int
    task_id: int
    workspace_id: int
    employee_id: int
    employee_name: str | None
    skill_id: int | None
    task_name: str
    run_status: str
    run_result: str | None
    error_message: str | None
    input: dict[str, Any]
    output: dict[str, Any]
    started_at: datetime
    ended_at: datetime | None
    duration_ms: int | None
    confirm_url: str | None = None
    result_confirmed: bool = False

    @field_serializer("started_at", "ended_at")
    def serialize_datetime(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.strftime("%Y-%m-%d %H:%M:%S")


class MonthlyCalendarTaskRead(BaseModel):
    is_active: bool
    task_type: int | None
    task_id: int
    task_name: str
    employee_id: int
    employee_name: str | None
    cron_expression: str
    cron_description: str
    cron_expression_type: str


class MonthlyCalendarEmployeeRead(BaseModel):
    employee_id: int
    employee_name: str | None
    tasks: list[MonthlyCalendarTaskRead]
    shift_id: int | None
    shift_name: str | None
    shift_schedule: dict[str, Any]


class MonthlyCalendarDayRead(BaseModel):
    day: int
    date: str
    employees: list[MonthlyCalendarEmployeeRead]


class MonthlyCalendarRead(BaseModel):
    year: int
    month: int
    days: dict[str, MonthlyCalendarDayRead]

