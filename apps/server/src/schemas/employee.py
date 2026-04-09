from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_serializer


class EmployeeRead(BaseModel):
    id: int
    workspace_id: int
    employee_code: str
    name: str | None
    description: str | None
    version: str | None
    skills: list[dict[str, Any]]
    metadata: dict[str, Any]
    shift_schedule: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")


class EmployeeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    version: str | None = Field(default=None, max_length=128)


class EmployeeSyncResult(BaseModel):
    workspace_id: int
    synced_count: int
    employees: list[EmployeeRead]

