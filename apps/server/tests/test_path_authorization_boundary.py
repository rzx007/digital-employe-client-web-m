from pathlib import Path
from src.service.agent.path_authorization import is_outside_workspace


def test_inside_root_is_not_outside(tmp_path):
    (tmp_path / "artifacts").mkdir()
    roots = [tmp_path / "artifacts"]
    target = tmp_path / "artifacts" / "sub" / "x.txt"
    assert is_outside_workspace(str(target), roots) is False


def test_outside_all_roots_is_outside(tmp_path):
    (tmp_path / "artifacts").mkdir()
    roots = [tmp_path / "artifacts"]
    assert is_outside_workspace(str(tmp_path / "other" / "x.txt"), roots) is True


def test_dotdot_escape_is_outside(tmp_path):
    (tmp_path / "artifacts").mkdir()
    roots = [tmp_path / "artifacts"]
    escape = tmp_path / "artifacts" / ".." / "secret.txt"
    assert is_outside_workspace(str(escape), roots) is True


def test_prefix_not_fooled_by_sibling(tmp_path):
    # /foo 不应放行 /foobar
    (tmp_path / "foo").mkdir()
    roots = [tmp_path / "foo"]
    assert is_outside_workspace(str(tmp_path / "foobar" / "x"), roots) is True


def test_multi_root_second_matches(tmp_path):
    (tmp_path / "a").mkdir(); (tmp_path / "b").mkdir()
    roots = [tmp_path / "a", tmp_path / "b"]
    assert is_outside_workspace(str(tmp_path / "b" / "x"), roots) is False
