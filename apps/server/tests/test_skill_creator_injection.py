from pathlib import Path

from src.service.agent.skill_sources import resolve_builtin_skill_creator_source


def test_resolve_skill_creator_source_returns_existing_dir():
    src = resolve_builtin_skill_creator_source()
    # 仓库内 build-in-skills/skill-creator 必然存在
    assert src is not None
    assert src.name == "skill-creator"
    assert (src / "SKILL.md").is_file()


def test_resolve_skill_creator_source_missing_returns_none(monkeypatch):
    import src.service.agent.skill_sources as mod

    monkeypatch.setattr(mod, "_candidate_skill_creator_dirs", lambda: [Path("/no/such/dir/skill-creator")])
    assert mod.resolve_builtin_skill_creator_source() is None


def test_inject_skill_creator_appends_source_and_name():
    from src.service.agent.employee import _augment_skills_with_skill_creator

    sources = ["/emp/skills"]
    available = ["docx"]
    new_sources, new_available = _augment_skills_with_skill_creator(sources, available)
    assert any(s.endswith("skill-creator") for s in new_sources)
    assert "skill-creator" in new_available


def test_inject_skill_creator_dedupes_when_employee_already_has_it():
    from src.service.agent.employee import _augment_skills_with_skill_creator

    sources = ["/emp/skills"]
    available = ["skill-creator", "docx"]
    new_sources, new_available = _augment_skills_with_skill_creator(sources, available)
    # 已自有：available 不重复，且不追加内置源（保留员工自有那份）
    assert new_available.count("skill-creator") == 1
    assert not any(s.endswith("skill-creator") for s in new_sources)
