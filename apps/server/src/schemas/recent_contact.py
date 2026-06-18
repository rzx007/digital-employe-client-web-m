from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_serializer

from src.schemas.conversation import TargetType


class RecentContactTouch(BaseModel):
    target_type: TargetType
    target_id: int


class RecentContactPinUpdate(BaseModel):
    is_pinned: bool


class RecentContactImportItem(BaseModel):
    target_type: TargetType
    target_id: int
    is_pinned: bool = False
    last_accessed_at: datetime | None = None


class RecentContactImportRequest(BaseModel):
    items: list[RecentContactImportItem] = Field(default_factory=list)


class RecentContactRead(BaseModel):
    target_type: TargetType
    target_id: int
    contact_id: str
    contact_name: str
    title: str = ""
    last_message: str | None = None
    last_message_time: datetime | None = None
    unread_count: int = 0
    updated_at: datetime
    is_curator: bool = False
    is_pinned: bool = False
    latest_conversation_id: int | None = None
    status: str | None = None

    @field_serializer("last_message_time", "updated_at")
    def serialize_datetime(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.strftime("%Y-%m-%d %H:%M:%S")
