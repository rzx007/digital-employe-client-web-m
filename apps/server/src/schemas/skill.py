from __future__ import annotations

from typing import Any

from pydantic import BaseModel


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
