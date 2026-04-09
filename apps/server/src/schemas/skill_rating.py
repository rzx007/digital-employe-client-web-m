from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SkillRatingBatchCreate(BaseModel):
    """对本轮助手回复涉及的技能打同一分数；技能从会话推断（chunk 中的 /skills/ 路径与上一条用户消息中的「请使用…技能」等），不传 skill_ids。"""

    message_id: int = Field(..., description="被评分的助手消息 ID（该条 assistant 消息的 chunk_json 用于推断调用了哪些技能）")
    score: int = Field(..., ge=1, le=5, description="评分 1–5")
    conversation_id: int | None = Field(None, description="可选；若填写须与 message 所属会话一致")
    comment: str | None = Field(None, max_length=2000, description="备注")


class SkillRatingRead(BaseModel):
    id: int
    workspace_id: int
    employee_id: int
    conversation_id: int | None
    message_id: int | None
    skill_id: int
    skill_name: str
    score: int
    comment: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
