from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_serializer


class ConfigKvCreate(BaseModel):
    config_key: str = Field(..., min_length=1, max_length=255)
    config_value: str = Field(default="")


class ConfigKvUpdate(BaseModel):
    config_value: str = Field(default="")


class ConfigKvRead(BaseModel):
    id: int
    config_key: str
    config_value: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S")
