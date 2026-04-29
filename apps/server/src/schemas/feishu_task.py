from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_serializer


class FeishuTaskRead(BaseModel):
    id: int
    task_id: str
    task_content: str
    executor: str
    start_time: datetime | None
    end_time: datetime | None
    is_schedule_created: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("start_time", "end_time", "created_at", "updated_at")
    def serialize_datetime(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.strftime("%Y-%m-%d %H:%M:%S")
