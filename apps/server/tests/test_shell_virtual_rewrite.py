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
    # 不匹配多行 python -c → 命令原样，无临时脚本（(cmd, None)）。
    assert b._prepare_shell_command(cmd) == (cmd, None)


def test_absolute_path_command_unchanged(tmp_path):
    b = _backend(tmp_path)
    art = b._env["ARTIFACTS_DIR"]
    cmd = f'python "{art}/script.py"'
    assert b._prepare_shell_command(cmd) == (cmd, None)


def test_rewrite_method_removed(tmp_path):
    b = _backend(tmp_path)
    assert not hasattr(b, "_rewrite_command_virtual_paths")
    assert not hasattr(b, "_map_virtual_token")


def test_multiline_python_c_materialized_outside_product_root(tmp_path):
    """多行 python -c 落盘的临时脚本写进系统临时目录(非产物根)，不污染资源管理器。"""
    import os
    from pathlib import Path

    if os.name != "nt":
        return  # 落盘垫片仅 Windows
    b = _backend(tmp_path)
    cmd = 'python -c "import sys\nprint(sys.version)"'
    rewritten, script_path = b._prepare_shell_command(cmd)
    assert script_path is not None
    p = Path(script_path)
    try:
        assert p.exists()
        # 不在产物目录(tmp_path/artifacts 或 tmp_path)下 → 资源管理器看不到
        assert tmp_path not in p.parents
        assert f'"{script_path}"' in rewritten
    finally:
        p.unlink(missing_ok=True)
