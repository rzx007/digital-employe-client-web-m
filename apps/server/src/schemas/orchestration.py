from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# run_status 透传：失败/取消 子任务会带 "cancelled"（见 orchestration_api._build_task_items）。
# 缺它 → 含已取消子任务的计划在「总管会话加载」时 OrchestrationTaskItem 校验失败 → 500。
OrchestrationTaskStatus = Literal[
    "pending", "running", "success", "failed", "queued", "cancelled"
]


class OrchestrationTaskEdit(BaseModel):
    """编辑待确认计划子任务的可选字段（inline-edit，仅 prompt / 换员工）。"""
    prompt: str | None = None
    employee_id: int | None = None


class OrchestrationTaskRework(BaseModel):
    """用户对已交付/失败子任务发起返修（#3/#7）：可选返修说明。"""
    note: str | None = None


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


class OrchestrationDeliverable(BaseModel):
    """子任务产出的文件（归属到任务），供主对话「团队交付物」聚合卡展示。"""
    path: str
    basename: str
    task_id: int
    task_name: str
    action: str = "created"
    size: int | None = None


class OrchestrationPlanDetail(BaseModel):
    plan: OrchestrationPlanRead
    tasks: list[OrchestrationTaskItem] = Field(default_factory=list)
    artifacts: list[OrchestrationDeliverable] = Field(default_factory=list)
