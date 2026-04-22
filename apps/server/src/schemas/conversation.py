from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_serializer, field_validator


TargetType = Literal["employee", "group"]
MessageRole = Literal["user", "assistant", "tool"]


class ConversationCreate(BaseModel):
    workspace_id: int
    target_type: TargetType
    target_id: int
    title: str | None = Field(default=None, max_length=255)


class ConversationRead(BaseModel):
    id: int
    workspace_id: int
    target_type: TargetType
    target_id: int
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")


class ConversationMessageRead(BaseModel):
    id: int
    conversation_id: int
    role: MessageRole
    content: str | None
    chunk_json: str | None
    extra_meta: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("extra_meta", mode="before")
    @classmethod
    def parse_extra_meta(cls, v: str | dict | None) -> dict | None:
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except (json.JSONDecodeError, ValueError):
                return None
        return v

    @field_serializer("created_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")


class ConversationAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=12000)


# 定义请求体模型
class StreamConversationRequest(BaseModel):
    skill: str
    question: str
    debug_content_only: bool = False
    extra_meta: dict | None = None