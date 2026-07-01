"""Tool for reliably updating /memories/AGENTS.md without edit_file string matching."""

from __future__ import annotations

from pathlib import Path

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field, field_validator

from src.service.agent.memory_file import (
    append_memory_entry,
    normalize_memory_section,
)


class RememberMemoryInput(BaseModel):
    text: str = Field(
        description="要记住的内容，一条简洁中文事实或偏好（会自动写成列表项）"
    )
    section: str = Field(
        default="已知事实与约定",
        description=(
            "写入小节：用户偏好 / 已知事实与约定（也可写 preference / fact）"
        ),
    )

    @field_validator("text")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("text 不能为空")
        return trimmed


def create_remember_memory_tool(memories_dir: Path) -> BaseTool:
    memory_file = memories_dir / "AGENTS.md"

    def _remember(text: str, section: str = "已知事实与约定") -> str:
        normalized = normalize_memory_section(section)
        if normalized is None:
            return (
                "错误：section 须为「用户偏好」或「已知事实与约定」"
                "（或 preference / fact）"
            )
        changed, message = append_memory_entry(
            memory_file,
            section=normalized,
            text=text,
        )
        if changed:
            return f"成功。{message}"
        return message

    return StructuredTool.from_function(
        func=_remember,
        name="remember_memory",
        description=(
            "【更新长期记忆的唯一工具】将用户要求「记住 / 更新记忆」的信息写入 "
            "/memories/AGENTS.md。"
            "禁止用 edit_file、write_file、shell 修改该文件（会被拒绝）。"
            "一次调用即可：自动追加到指定小节并移除「（暂无）」占位。"
            "环境/OS/路径/约定 → section=已知事实与约定；"
            "沟通/格式偏好 → section=用户偏好。"
            "例：remember_memory(text='运行环境: Windows', section='已知事实与约定')"
        ),
        args_schema=RememberMemoryInput,
    )
