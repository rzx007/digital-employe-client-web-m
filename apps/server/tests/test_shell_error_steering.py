"""shell 命令失败的可纠偏建议（§D 报错可纠偏）。"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from src.service.skill_shell_backend import (
    SkillAwareShellBackend,
    _steer_on_error,
)


def test_module_not_found_suggests_pip_install() -> None:
    out = "Traceback ...\nModuleNotFoundError: No module named 'pandas'"
    hint = _steer_on_error(out)
    assert "pip install pandas" in hint
    assert "[建议]" in hint


def test_submodule_name_uses_top_package() -> None:
    out = "ModuleNotFoundError: No module named 'sklearn.linear_model'"
    assert "pip install sklearn" in _steer_on_error(out)


def test_file_not_found_suggests_check_path() -> None:
    assert "确认真实路径" in _steer_on_error("FileNotFoundError: ...")
    assert "确认真实路径" in _steer_on_error("cat: x: No such file or directory")


def test_permission_denied() -> None:
    assert "/artifacts/" in _steer_on_error("PermissionError: [Errno 13] Permission denied")


def test_no_hint_for_clean_output() -> None:
    assert _steer_on_error("hello world\ndone") == ""


def test_node_cannot_find_module_steers_to_global_install() -> None:
    out = "Error: Cannot find module 'docx'\n    at ...\ncode: 'MODULE_NOT_FOUND'"
    hint = _steer_on_error(out)
    assert "docx" in hint
    assert "npm install -g" in hint
    # 必须明确劝阻本地装（产物目录刷 node_modules 是核心 bug）
    assert "切勿" in hint


def test_node_module_not_found_without_name() -> None:
    hint = _steer_on_error("internal/modules/cjs/loader: MODULE_NOT_FOUND")
    assert "npm install -g" in hint


def _make_backend(monkeypatch, global_root: str | None) -> SkillAwareShellBackend:
    """构建 backend，并把全局 npm root 探测替换为固定值（避开真机 npm 依赖）。"""
    monkeypatch.setattr(
        "src.service.skill_shell_backend.resolve_global_node_modules",
        lambda: global_root or "",
    )
    art = Path(tempfile.mkdtemp())
    skills = Path(tempfile.mkdtemp())
    return SkillAwareShellBackend(root_dir=str(art), skills_root=skills, draft_root=None)


def test_node_path_injected_when_global_root_resolves(monkeypatch) -> None:
    fake_root = tempfile.mkdtemp()  # 必须是真实存在目录，但内容无关
    be = _make_backend(monkeypatch, fake_root)
    assert be._env.get("NODE_PATH") == fake_root


def test_node_path_prepended_not_overwritten(monkeypatch) -> None:
    fake_root = tempfile.mkdtemp()
    monkeypatch.setenv("NODE_PATH", "/pre/existing")
    monkeypatch.setattr(
        "src.service.skill_shell_backend.resolve_global_node_modules",
        lambda: fake_root,
    )
    art = Path(tempfile.mkdtemp())
    skills = Path(tempfile.mkdtemp())
    be = SkillAwareShellBackend(root_dir=str(art), skills_root=skills, draft_root=None)
    parts = be._env["NODE_PATH"].split(os.pathsep)
    assert parts[0] == fake_root
    assert "/pre/existing" in parts


def test_no_node_path_when_npm_absent(monkeypatch) -> None:
    monkeypatch.delenv("NODE_PATH", raising=False)
    be = _make_backend(monkeypatch, None)
    assert "NODE_PATH" not in be._env or not be._env["NODE_PATH"]
