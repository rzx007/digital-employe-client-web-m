"""shell 命令失败的可纠偏建议（§D 报错可纠偏）。"""

from __future__ import annotations

from src.service.skill_shell_backend import _steer_on_error


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
