from __future__ import annotations

from pathlib import Path

from src.service.agent.paths import (
    list_available_skills,
    resolve_orchestrator_skills_root,
)
from src.service.local_skill_service import LocalSkillService


def list_orchestrator_skills(skills_root: Path | None = None) -> list[dict]:
    """列出总管固定技能目录（orchestrator_skills/）的 name + description。

    仅含有 SKILL.md 的子目录入选（list_available_skills 已过滤）。
    描述读 SKILL.md frontmatter，解析失败降级为空串。
    """
    root = skills_root or resolve_orchestrator_skills_root()
    items: list[dict] = []
    for name in list_available_skills(root):
        skill_md = root / name / "SKILL.md"
        try:
            description = LocalSkillService._extract_description_from_skill_md(skill_md)
        except Exception:  # noqa: BLE001 - 单个技能解析失败不致命
            description = ""
        items.append({"name": name, "description": description or ""})
    return items
