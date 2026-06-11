from __future__ import annotations

from pydantic import BaseModel


class ResourceEntry(BaseModel):
    name: str
    # 去虚拟前缀后 path 为真实磁盘绝对路径；bucket 为前端分桶 key（取代旧的前缀解析）。
    path: str
    bucket: str | None = None  # "artifacts" | "uploads" | "skills_draft"
    entry_type: str
    artifact_type: str | None = None
    size: int = 0
    modified_at: float | None = None
    children: list[ResourceEntry] | None = None


class ResourceList(BaseModel):
    artifacts: list[ResourceEntry]
    uploads: list[ResourceEntry] = []
    skills_draft: list[ResourceEntry]


class ResourceContent(BaseModel):
    path: str  # 真实磁盘绝对路径
    content: str
    artifact_type: str
    language: str | None = None


class ResourceUploadResult(BaseModel):
    name: str
    path: str  # 真实磁盘绝对路径
    bucket: str | None = None
    size: int
