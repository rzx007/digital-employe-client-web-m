from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

OrchestrationTaskStatus = Literal["pending", "running", "success", "failed", "queued"]


class OrchestrationTaskEdit(BaseModel):
    """编辑待确认计划子任务的可选字段（inline-edit，仅 prompt / 换员工）。"""
    prompt: str | None = None
    employee_id: int | None = None


class OrchestrationTaskItem(BaseModel):
    task_id: int
    employee_id: int
    employee_name: str
    task_name: str
    prompt: str
    dispatch_type: str = "skill"
    skill_id: int | None = None
    cron: str | None = None
    execute_mode: str = "immediate"
    priority: int = 0
    depends_on: int | list[int] | None = None
    status: OrchestrationTaskStatus = "pending"
    conversation_id: int | None = None
    orchestrator_conversation_id: int | None = None


class OrchestrationPlanRead(BaseModel):
    id: int
    workspace_id: int
    conversation_id: int
    message_id: int | None
    user_input: str
    plan_json: str | None = None
    status: str
    total_tasks: int
    completed_tasks: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrchestrationPlanDetail(BaseModel):
    plan: OrchestrationPlanRead
    tasks: list[OrchestrationTaskItem] = Field(default_factory=list)
