"""basic_file_read / basic_file_edit / basic_file_write 对 GBK 文本与本机绝对路径。"""

from pathlib import Path

from src.service.agent.basic_file_backend import (
    basic_file_edit,
    basic_file_read,
    basic_file_write,
)
from src.service.skill_shell_backend import SkillAwareShellBackend


def _shell_backend(tmp_path: Path) -> SkillAwareShellBackend:
    skills = tmp_path / "skills"
    skills.mkdir()
    (tmp_path / "artifacts").mkdir()
    return SkillAwareShellBackend(
        root_dir=str(tmp_path / "artifacts"),
        skills_root=skills,
        draft_root=None,
        virtual_mode=False,
    )


def test_basic_file_read_host_absolute_gbk(tmp_path: Path) -> None:
    host_file = tmp_path / "desktop.md"
    host_file.write_bytes("桌面 GBK 文件".encode("gbk"))

    result = basic_file_read(_shell_backend(tmp_path), str(host_file.resolve()))

    assert result.error is None
    assert result.file_data is not None
    assert "桌面 GBK 文件" in (result.file_data.get("content") or "")


def test_basic_file_edit_gbk_converts_to_utf8(tmp_path: Path) -> None:
    host_file = tmp_path / "test.md"
    host_file.write_bytes("旧内容 GBK".encode("gbk"))

    backend = _shell_backend(tmp_path)
    result = basic_file_edit(
        backend,
        str(host_file.resolve()),
        "旧内容",
        "新内容",
    )

    assert result.error is None
    assert result.occurrences == 1
    assert host_file.read_bytes().decode("utf-8") == "新内容 GBK"


def test_write_overwrites_existing_file(tmp_path: Path) -> None:
    backend = _shell_backend(tmp_path)
    target = tmp_path / "artifacts" / "wuhan_travel.py"

    first = backend.write(str(target.resolve()), "print('v1')\n")
    assert first.error is None

    # 同名重写应覆盖，而非报 "already exists"。
    second = backend.write(str(target.resolve()), "print('v2 fixed')\n")
    assert second.error is None
    assert second.path is not None
    assert target.read_text(encoding="utf-8") == "print('v2 fixed')\n"


def test_basic_file_write_creates_parent_dirs(tmp_path: Path) -> None:
    backend = _shell_backend(tmp_path)
    target = tmp_path / "artifacts" / "nested" / "deep" / "a.txt"

    result = basic_file_write(backend, str(target.resolve()), "hello")

    assert result.error is None
    assert target.read_text(encoding="utf-8") == "hello"
