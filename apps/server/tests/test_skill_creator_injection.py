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
