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
    # SP2 Phase3：产物已拍平为项目级单一共享区（artifacts 即全部）；
    # workspace/public 两桶保留供前端契约兼容，恒空。
    workspace: list[ResourceEntry] = []
    public: list[ResourceEntry] = []


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


class VoiceUploadResult(BaseModel):
    audio_path: str


class ResourceBatchDeleteRequest(BaseModel):
    paths: list[str]  # 一组真实磁盘绝对路径


class ResourceBatchDeleteResult(BaseModel):
    deleted: list[str] = []
    skipped: list[str] = []
