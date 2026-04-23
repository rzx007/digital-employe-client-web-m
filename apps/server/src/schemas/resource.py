from __future__ import annotations

from pydantic import BaseModel


class ResourceEntry(BaseModel):
    name: str
    path: str
    entry_type: str
    artifact_type: str | None = None
    size: int = 0
    modified_at: float | None = None
    children: list[ResourceEntry] | None = None


class ResourceList(BaseModel):
    artifacts: list[ResourceEntry]
    skills_draft: list[ResourceEntry]


class ResourceContent(BaseModel):
    path: str
    content: str
    artifact_type: str
    language: str | None = None
