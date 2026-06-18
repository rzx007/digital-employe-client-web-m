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


# ---- edit_file 行末空白容忍 fallback ----
# 模型常因 old_string 行尾多/少空格、或文件末换行差异反复撞 "String not found"。
# fallback：精确匹配 0 次时按 rstrip 重试；唯一命中才替换，否则保留原错误（不错改）。


def _edit_setup(tmp_path: Path, body: str, name: str = "doc.md"):
    """先建 backend（会 mkdir artifacts），再写目标文件 —— 避免顺序冲突。"""
    backend = _shell_backend(tmp_path)
    target = tmp_path / "artifacts" / name
    target.write_text(body, encoding="utf-8")
    return backend, target


def test_edit_tolerates_trailing_whitespace_diff(tmp_path: Path) -> None:
    # 文件第一行尾有空格，模型 old_string 没带 → 精确匹配失败 → fallback 救场
    backend, target = _edit_setup(tmp_path, "foo bar \nbaz\n")

    result = basic_file_edit(
        backend, str(target.resolve()), "foo bar\nbaz", "NEW\nLINE"
    )

    assert result.error is None
    assert result.occurrences == 1
    assert target.read_text(encoding="utf-8") == "NEW\nLINE\n"


def test_edit_tolerates_missing_trailing_newline(tmp_path: Path) -> None:
    # 文件实际没有末尾换行，模型 old_string 多带了一个 → fallback 忽略 old 末尾空行
    backend, target = _edit_setup(tmp_path, "line one\nline two")

    result = basic_file_edit(
        backend, str(target.resolve()), "line one\nline two\n", "REPLACED\n"
    )

    assert result.error is None
    assert result.occurrences == 1
    assert target.read_text(encoding="utf-8") == "REPLACED\n"


def test_edit_rejects_indent_difference(tmp_path: Path) -> None:
    # 行首缩进风格不同（tab vs 4 空格）：fallback 不归一化行首空白 → 保留原错误
    body = "\tGood: foo\n"
    backend, target = _edit_setup(tmp_path, body)

    result = basic_file_edit(
        backend, str(target.resolve()), "    Good: foo", "Bad: foo"
    )

    assert result.error is not None
    assert "String not found" in result.error
    assert "read_file" in result.error  # hint 已附加
    assert target.read_text(encoding="utf-8") == body


def test_edit_rejects_when_multiple_matches_after_normalize(tmp_path: Path) -> None:
    # 两段独立的 "foo+bar"，每段 foo 行尾空格数不同；精确匹配都不中、归一化后都中
    # → fallback 检测到歧义，拒绝替换、保留原错误
    body = "foo \nbar\nfoo  \nbar\n"
    backend, target = _edit_setup(tmp_path, body)

    result = basic_file_edit(backend, str(target.resolve()), "foo\nbar", "X")

    assert result.error is not None
    assert "String not found" in result.error
    assert "read_file" in result.error
    # 文件未被改动
    assert target.read_text(encoding="utf-8") == body


def test_edit_genuine_miss_returns_hint(tmp_path: Path) -> None:
    backend, target = _edit_setup(tmp_path, "alpha\nbeta\n")

    result = basic_file_edit(
        backend, str(target.resolve()), "non-existent text", "X"
    )

    assert result.error is not None
    assert "String not found" in result.error
    assert "read_file" in result.error  # hint 已附加
