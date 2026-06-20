"""测试 skill_improvement_service Part 1：改进线索写入持久 brain 目录（A-3）。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock


def test_trigger_improvement_review_writes_to_brain(tmp_path, monkeypatch):
    """score<3 且有 comment 时，线索写入 <brain>/skill_hints/<skill_name>.md。"""
    skill_name = "pptx"
    employee_id = 42

    # 构造 brain root（即 employee root）
    brain_root = tmp_path / "brain"
    brain_root.mkdir()

    # 构造员工 copy 下的 SKILL.md（service 从这里读原文）
    skill_copy_dir = tmp_path / "skills_copy" / skill_name
    skill_copy_dir.mkdir(parents=True)
    skill_md = skill_copy_dir / "SKILL.md"
    skill_md.write_text("# pptx 技能\n这是技能内容。", encoding="utf-8")

    # 让 settings.skill_path 指向 skills_copy，使 skill_root 定位到正确位置
    # skill_root = Path(settings.skill_path) / str(employee_id) / "skills" / skill_name
    skills_path_parent = tmp_path / "skills_copy"
    # 建造路径: skills_copy/42/skills/pptx/SKILL.md
    real_skill_dir = skills_path_parent / str(employee_id) / "skills" / skill_name
    real_skill_dir.mkdir(parents=True)
    (real_skill_dir / "SKILL.md").write_text("# pptx 技能\n这是技能内容。", encoding="utf-8")

    # mock settings.skill_path
    fake_settings = MagicMock()
    fake_settings.skill_path = str(skills_path_parent)
    monkeypatch.setattr(
        "src.service.skill_improvement_service.get_settings",
        lambda: fake_settings,
    )

    # mock _growth_brain_root_for → tmp brain
    monkeypatch.setattr(
        "src.service.skill_improvement_service._growth_brain_root_for",
        lambda eid: brain_root,
    )

    # mock LLM 不真实调用
    fake_llm = MagicMock()
    fake_llm.invoke.return_value = MagicMock(content="reason: 太啰嗦\nimprovements: 精简步骤")
    monkeypatch.setattr(
        "src.service.skill_improvement_service._build_llm",
        lambda: fake_llm,
    )

    from src.service.skill_improvement_service import trigger_improvement_review

    trigger_improvement_review(
        skill_name=skill_name,
        employee_id=employee_id,
        score=1,
        comment="太啰嗦",
        conversation_id=None,
    )

    # 断言：brain/skill_hints/pptx.md 已写入
    hint_file = brain_root / "skill_hints" / f"{skill_name}.md"
    assert hint_file.exists(), f"期望的线索文件不存在: {hint_file}"
    content = hint_file.read_text(encoding="utf-8")
    assert "改进建议" in content
    assert "太啰嗦" in content

    # 断言：旧路径（volatile copy 下 improvement-suggestion.md）不应写入
    old_path = real_skill_dir / "improvement-suggestion.md"
    assert not old_path.exists(), "旧的 volatile 路径不应再被写入"


def test_trigger_improvement_review_skips_high_score(tmp_path, monkeypatch):
    """score>=3 时直接返回，不写任何文件。"""
    brain_root = tmp_path / "brain"

    monkeypatch.setattr(
        "src.service.skill_improvement_service._growth_brain_root_for",
        lambda eid: brain_root,
    )

    from src.service.skill_improvement_service import trigger_improvement_review

    trigger_improvement_review(
        skill_name="pptx",
        employee_id=1,
        score=4,
        comment="不错",
        conversation_id=None,
    )

    assert not (brain_root / "skill_hints").exists()


def test_trigger_improvement_review_skips_no_comment(tmp_path, monkeypatch):
    """无 comment 时直接返回，不写任何文件。"""
    brain_root = tmp_path / "brain"

    monkeypatch.setattr(
        "src.service.skill_improvement_service._growth_brain_root_for",
        lambda eid: brain_root,
    )

    from src.service.skill_improvement_service import trigger_improvement_review

    trigger_improvement_review(
        skill_name="pptx",
        employee_id=1,
        score=2,
        comment="",
        conversation_id=None,
    )

    assert not (brain_root / "skill_hints").exists()
