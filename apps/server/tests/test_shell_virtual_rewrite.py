"""shell 命令虚拟前缀 rewrite（含 /artifacts/、/uploads/）。"""

from pathlib import Path

from src.service.skill_shell_backend import SkillAwareShellBackend


def _make_backend(
    tmp_path: Path,
    *,
    virtual_mode: bool,
    with_uploads: bool = False,
) -> SkillAwareShellBackend:
    skills = tmp_path / "skills"
    skills.mkdir()
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    uploads = tmp_path / "uploads" if with_uploads else None
    if uploads is not None:
        uploads.mkdir()
    return SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=skills,
        draft_root=None,
        uploads_root=uploads,
        virtual_mode=virtual_mode,
    )


def test_rewrites_skills_in_physical_mode(tmp_path: Path) -> None:
    backend = _make_backend(tmp_path, virtual_mode=False)
    skills_target = str((tmp_path / "skills" / "foo" / "SKILL.md").resolve())

    out = backend._rewrite_command_virtual_paths("cat /skills/foo/SKILL.md")

    assert skills_target in out
    assert "/skills/foo" not in out


def test_rewrites_artifacts_and_uploads(tmp_path: Path) -> None:
    backend = _make_backend(tmp_path, virtual_mode=False, with_uploads=True)
    artifacts_target = str((tmp_path / "artifacts" / "script.py").resolve())
    uploads_target = str((tmp_path / "uploads" / "doc.pdf").resolve())

    out_art = backend._rewrite_command_virtual_paths("python /artifacts/script.py")
    out_up = backend._rewrite_command_virtual_paths("cat /uploads/doc.pdf")

    assert artifacts_target in out_art
    assert uploads_target in out_up


def test_rewrites_skills_in_virtual_mode(tmp_path: Path) -> None:
    backend = _make_backend(tmp_path, virtual_mode=True)
    skills_target = str((tmp_path / "skills" / "foo" / "SKILL.md").resolve())

    out = backend._rewrite_command_virtual_paths("cat /skills/foo/SKILL.md")

    assert skills_target in out


def test_non_virtual_command_unchanged(tmp_path: Path) -> None:
    backend = _make_backend(tmp_path, virtual_mode=False)
    cmd = "python -u script.py"
    assert backend._rewrite_command_virtual_paths(cmd) == cmd
