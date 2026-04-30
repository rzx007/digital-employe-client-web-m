from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

OrchestrationTaskStatus = Literal["pending", "running", "success", "failed", "queued"]


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
    depends_on: int | None = None
    status: OrchestrationTaskStatus = "pending"
    conversation_id: int | None = None


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
