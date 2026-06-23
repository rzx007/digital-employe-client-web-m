"""workbench-builder 内置技能存在且内容指向 arrange_workbench。"""
from __future__ import annotations

from src.service.agent.paths import BUILD_IN_SKILLS_DIR


def test_workbench_builder_skill_md_exists_and_mentions_tool():
    skill_md = BUILD_IN_SKILLS_DIR / "workbench-builder" / "SKILL.md"
    assert skill_md.is_file(), f"missing {skill_md}"
    text = skill_md.read_text(encoding="utf-8")
    assert "arrange_workbench" in text
    assert "write_file" in text
