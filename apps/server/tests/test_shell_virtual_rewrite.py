"""shell 命令在物理模式下仍 rewrite /skills/ 等虚拟前缀。"""

from src.service.skill_shell_backend import SkillAwareShellBackend


def _make_backend(tmp_path, *, virtual_mode):
    skills = tmp_path / "skills"
    skills.mkdir()
    return SkillAwareShellBackend(
        root_dir=str(tmp_path),
        skills_root=skills,
        draft_root=None,
        virtual_mode=virtual_mode,
    )


def test_rewrites_skills_in_physical_mode(tmp_path):
    backend = _make_backend(tmp_path, virtual_mode=False)
    skills_target = str((tmp_path / "skills" / "foo" / "SKILL.md").resolve())

    out = backend._rewrite_command_virtual_paths("cat /skills/foo/SKILL.md")

    assert skills_target in out
    assert "/skills/foo" not in out


def test_rewrites_skills_in_virtual_mode(tmp_path):
    backend = _make_backend(tmp_path, virtual_mode=True)
    skills_target = str((tmp_path / "skills" / "foo" / "SKILL.md").resolve())

    out = backend._rewrite_command_virtual_paths("cat /skills/foo/SKILL.md")

    assert skills_target in out


def test_non_virtual_command_unchanged(tmp_path):
    backend = _make_backend(tmp_path, virtual_mode=False)
    cmd = "python -u script.py"
    assert backend._rewrite_command_virtual_paths(cmd) == cmd
