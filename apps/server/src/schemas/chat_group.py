from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_serializer


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    employee_ids: list[int] = Field(..., min_length=1)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    employee_ids: list[int] | None = None


class GroupRead(BaseModel):
    id: int
    workspace_id: int
    name: str
    employee_ids: list[int]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")

