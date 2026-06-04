from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class SkillListItem(BaseModel):
    id: int
    skillName: str
    displayNameZh: str | None = None
    description: str | None = None
    directoryId: int | None = None
    directoryName: str | None = None
    tags: list[str] = []
    source: str = "remote"
    sourceLabel: str = "远程"


class SkillRead(BaseModel):
    id: int
    skillName: str
    description: str | None = None
    prompt: str | None = None
    inputSchema: Any = None
    skillContent: str | dict[str, Any] | None = None
    directoryId: int | None = None
    directoryName: str | None = None
    status: int | None = None
    createTime: str | None = None
    updateTime: str | None = None


class SkillNameExistsRequest(BaseModel):
    skillName: str


class SkillNameExistsResult(BaseModel):
    exists: bool


class LocalSkillItem(BaseModel):
    skillName: str
    localId: int | None = None
    path: str
    hasSkillMd: bool
    importedAt: str | None = None
    description: str | None = None
    displayNameZh: str | None = None
    isBuiltin: bool = False


class LocalSkillDetail(BaseModel):
    skillName: str
    localId: int | None = None
    path: str
    importedAt: str | None = None
    skillMdContent: str | None = None
    files: list[str]
    displayNameZh: str | None = None
    isBuiltin: bool = False


class LocalSkillImportResult(BaseModel):
    skillName: str
    localId: int | None = None
    path: str
    overwritten: bool = False


class UpdateSkillDisplayNameRequest(BaseModel):
    displayNameZh: str


class UpdateSkillDisplayNameResult(BaseModel):
    skillName: str
    displayNameZh: str | None = None


class UpdateLocalSkillRequest(BaseModel):
    displayNameZh: str | None = None
    skillMdContent: str | None = None
    # 仅对内置技能有意义：
    #   "workspace" 先复制到当前工作区再写入（不改全局内置）；
    #   "builtin" 直接覆盖全局内置目录（所有工作区共享）。
    # 本地技能始终写入工作区副本，该字段被忽略。
    target: Literal["workspace", "builtin"] | None = None


class UpdateLocalSkillResult(BaseModel):
    skillName: str
    displayNameZh: str | None = None
    skillMdContent: str | None = None
    syncedEmployeeCount: int = 0
    # 保存后该技能最终所在位置是否仍为全局内置目录。
    # 当内置技能以 "workspace" 方式保存（复制另存）后会变为 False。
    isBuiltin: bool = False
