from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_serializer, field_validator
from pydantic_core.core_schema import NoneSchema


TargetType = Literal["employee", "curator"]
MessageRole = Literal["user", "assistant", "tool"]


class ConversationCreate(BaseModel):
    target_type: TargetType
    target_id: int
    title: str | None = Field(default=NoneSchema)


class ConversationUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class ConversationTitleSuggestRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=12000)


class ConversationTitleSuggestResponse(BaseModel):
    title: str
    source: Literal["rule", "llm", "fallback"]


class ConversationRead(BaseModel):
    id: int
    workspace_id: int
    user_id: str | None = None
    target_type: TargetType
    target_id: int
    title: str | None
    status: str = "idle"
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")


class ConversationsBulkDeleteResult(BaseModel):
    deleted_count: int
    deleted_ids: list[int]


class ConversationMessageRead(BaseModel):
    id: int
    conversation_id: int
    role: MessageRole
    content: str | None
    chunk_json: str | None
    stream_state: str | None = None
    stream_cursor: int | None = None
    extra_meta: dict | None = None
    message_parts: list[dict] | None = None
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

    @field_validator("message_parts", mode="before")
    @classmethod
    def parse_message_parts(cls, v: str | list | None) -> list | None:
        """DB 存储为 JSON 字符串，自动反序列化为 list[dict]"""
        if v is None:
            return None
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            import json
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except (json.JSONDecodeError, ValueError):
                pass
        return None

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


class ApproveRequest(BaseModel):
    message_id: int
    decisions: list[dict]
    destructive_hitl: dict | None = None