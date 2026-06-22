from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class WorkbenchResourceRead(BaseModel):
    id: int
    workspace_id: int
    source: str
    src_path: str
    title: str
    added_by: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkbenchResourceAddArtifact(BaseModel):
    workspace_id: int
    src_path: str
    title: str | None = None
