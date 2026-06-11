"""删除虚拟前缀 rewrite 后：shell 命令原样执行，仅保留多行 python -c 落盘（NT）。"""
from pathlib import Path

from src.service.skill_shell_backend import SkillAwareShellBackend


def _backend(tmp_path: Path) -> SkillAwareShellBackend:
    skills = tmp_path / "skills"
    skills.mkdir()
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    return SkillAwareShellBackend(
        root_dir=str(artifacts),
        skills_root=skills,
        draft_root=None,
        virtual_mode=False,
    )


def test_command_passthrough_no_rewrite(tmp_path):
    b = _backend(tmp_path)
    cmd = 'curl -s "http://x/y?a=1" -o out.json'
    assert b._prepare_shell_command(cmd) == cmd


def test_absolute_path_command_unchanged(tmp_path):
    b = _backend(tmp_path)
    art = b._env["ARTIFACTS_DIR"]
    cmd = f'python "{art}/script.py"'
    assert b._prepare_shell_command(cmd) == cmd


def test_rewrite_method_removed(tmp_path):
    b = _backend(tmp_path)
    assert not hasattr(b, "_rewrite_command_virtual_paths")
    assert not hasattr(b, "_map_virtual_token")
