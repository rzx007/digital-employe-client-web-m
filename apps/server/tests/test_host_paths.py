"""本机绝对路径判定（三端）。"""

from src.service.agent.path_access.host_paths import (
    is_host_absolute_path,
    normalize_host_path,
)


def test_windows_drive_paths_are_host():
    assert is_host_absolute_path("C:/Users/me/a.pdf")
    assert is_host_absolute_path("D:\\space\\标书\\x.pdf")
    assert is_host_absolute_path("c:/lower")
    assert is_host_absolute_path("C:")


def test_unix_absolute_paths_are_host():
    assert is_host_absolute_path("/Users/me/Documents/a.pdf")
    assert is_host_absolute_path("/home/you/docs/x.pdf")
    assert is_host_absolute_path("/tmp/scratch")


def test_unix_style_paths_all_host_now():
    # 删虚拟前缀后：所有以 / 开头的绝对路径均按 host 处理（不再排除 /artifacts/ 等）
    assert is_host_absolute_path("/artifacts/report.md")
    assert is_host_absolute_path("/skills/foo/SKILL.md")
    assert is_host_absolute_path("/memories/AGENTS.md")


def test_relative_and_empty_are_not_host():
    assert not is_host_absolute_path("")
    assert not is_host_absolute_path("report.md")
    assert not is_host_absolute_path("./a/b")


def test_normalize_host_path_converts_backslashes():
    assert normalize_host_path("D:\\a\\b") == "D:/a/b"
    assert normalize_host_path("/Users/me") == "/Users/me"
