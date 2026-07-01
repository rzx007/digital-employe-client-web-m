from __future__ import annotations

from pathlib import Path

from src.service.local_skill_service import LocalSkillService


def _write_skill_dir(root: Path, name: str, *, description: str = "demo") -> None:
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / LocalSkillService.SKILL_MD_NAME).write_text(
        f"---\ndescription: {description}\n---\n# {name}\n",
        encoding="utf-8",
    )


def test_seed_builtin_skills_removes_stale_local_builtin(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source_root = tmp_path / "packaged"
    local_root = tmp_path / "local-skills" / "builtin"
    source_root.mkdir()
    local_root.mkdir(parents=True)

    _write_skill_dir(source_root, "valid-skill")
    _write_skill_dir(local_root, "oa-overtime")
    _write_skill_dir(local_root, "valid-skill", description="old copy")

    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_packaged_builtin_skills_root",
        lambda: source_root,
    )
    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_builtin_root",
        lambda: local_root,
    )

    result = LocalSkillService.seed_builtin_skills()

    assert result["removed_items"] == 1
    assert result["copied_items"] == 1
    assert not (local_root / "oa-overtime").exists()
    assert (local_root / "valid-skill" / LocalSkillService.SKILL_MD_NAME).is_file()


def test_seed_builtin_skills_keeps_packaged_skills_only(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source_root = tmp_path / "packaged"
    local_root = tmp_path / "local-skills" / "builtin"
    source_root.mkdir()
    local_root.mkdir(parents=True)

    _write_skill_dir(source_root, "lark-base")
    _write_skill_dir(source_root, "docx")

    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_packaged_builtin_skills_root",
        lambda: source_root,
    )
    monkeypatch.setattr(
        LocalSkillService,
        "_resolve_builtin_root",
        lambda: local_root,
    )

    result = LocalSkillService.seed_builtin_skills()

    assert result["removed_items"] == 0
    assert result["copied_items"] == 2
    assert (local_root / "lark-base").is_dir()
    assert (local_root / "docx").is_dir()
