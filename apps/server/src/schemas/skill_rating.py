from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SkillRatingBatchCreate(BaseModel):
    """根据单条任务执行日志解析 skill_id 并写入一条评分。"""

    task_execution_log_id: int = Field(
        ...,
        description="任务执行日志 ID（task_execution_logs.id），用于解析 skill_id",
    )
    score: int = Field(..., ge=0, le=10, description="评分 0–10")
    comment: str | None = Field(None, max_length=2000, description="备注")


class SkillRatingRead(BaseModel):
    id: int
    workspace_id: int
    employee_id: int
    conversation_id: int | None
    message_id: int | None
    task_execution_log_id: int | None = None
    skill_id: int
    skill_name: str
    score: int
    comment: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
