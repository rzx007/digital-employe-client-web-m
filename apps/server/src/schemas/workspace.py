from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_serializer


class WorkspaceCreate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    root_path: str | None = Field(default=None, max_length=1024)


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    root_path: str | None = Field(default=None, max_length=1024)


class WorkspaceRead(BaseModel):
    id: int
    name: str
    root_path: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")


class FileEntry(BaseModel):
    name: str
    path: str
    entry_type: str
    size: int
    modified_at: float

