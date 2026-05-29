"""本机文件导入 /uploads/ 测试。"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.service.local_file_import import (
    MAX_IMPORTS_PER_MESSAGE,
    extract_host_paths_from_text,
    import_paths_from_message,
    is_virtual_path,
    try_map_to_existing_virtual,
)
from src.service.resource_service import ResourceService


def test_is_virtual_path():
    assert is_virtual_path("/uploads/foo.md")
    assert is_virtual_path("/artifacts/report.md")
    assert not is_virtual_path("C:\\Users\\a\\file.md")
    assert not is_virtual_path("/Users/a/file.md")


def test_extract_windows_paths():
    text = '请读 C:\\Users\\a\\Desktop\\test.md 和 "D:\\data\\b.txt"'
    paths = extract_host_paths_from_text(text)
    assert any("test.md" in p for p in paths)
    assert any("b.txt" in p for p in paths)


def test_extract_unix_paths():
    text = "分析 /Users/x/project/readme.md 以及 /home/y/docs/note.txt"
    paths = extract_host_paths_from_text(text)
    assert "/Users/x/project/readme.md" in paths
    assert "/home/y/docs/note.txt" in paths


def test_extract_excludes_virtual_paths():
    text = "请看 /uploads/foo.md 和 /artifacts/bar.md"
    paths = extract_host_paths_from_text(text)
    assert paths == []


def test_import_local_file_success(tmp_path: Path):
    root = tmp_path / "conversations"
    conv_id = 42
    source = tmp_path / "external.md"
    source.write_text("hello import", encoding="utf-8")

    result = ResourceService.import_local_file(str(root), conv_id, source)
    assert not isinstance(result, str)
    assert result.path == "/uploads/external.md"
    assert result.name == "external.md"

    dest = root / str(conv_id) / "uploads" / "external.md"
    assert dest.is_file()
    assert dest.read_text(encoding="utf-8") == "hello import"


def test_import_local_file_duplicate_name(tmp_path: Path):
    root = tmp_path / "conversations"
    conv_id = 1
    uploads = root / str(conv_id) / "uploads"
    uploads.mkdir(parents=True)
    (uploads / "dup.md").write_text("existing", encoding="utf-8")

    source = tmp_path / "dup.md"
    source.write_text("new content", encoding="utf-8")

    result = ResourceService.import_local_file(str(root), conv_id, source)
    assert not isinstance(result, str)
    assert result.path == "/uploads/dup_1.md"
    assert (uploads / "dup_1.md").read_text(encoding="utf-8") == "new content"


def test_import_shortcut_when_already_in_uploads(tmp_path: Path):
    root = tmp_path / "conversations"
    conv_id = 7
    uploads = root / str(conv_id) / "uploads"
    uploads.mkdir(parents=True)
    existing = uploads / "already.md"
    existing.write_text("same", encoding="utf-8")

    virtual = try_map_to_existing_virtual(str(root), conv_id, existing)
    assert virtual == "/uploads/already.md"

    result = ResourceService.import_local_file(str(root), conv_id, existing)
    assert not isinstance(result, str)
    assert result.path == "/uploads/already.md"
    assert list(uploads.iterdir()) == [existing]


def test_import_local_file_missing(tmp_path: Path):
    missing = tmp_path / "nope.md"
    result = ResourceService.import_local_file(str(tmp_path), 1, missing)
    assert isinstance(result, str)
    assert "不存在" in result or "不是普通文件" in result


def test_import_local_file_directory(tmp_path: Path):
    result = ResourceService.import_local_file(str(tmp_path), 1, tmp_path)
    assert isinstance(result, str)


def test_import_paths_from_message_limit(tmp_path: Path):
    root = tmp_path / "conversations"
    conv_id = 99
    sources: list[Path] = []
    for i in range(MAX_IMPORTS_PER_MESSAGE + 2):
        p = tmp_path / f"f{i}.txt"
        p.write_text(f"content{i}", encoding="utf-8")
        sources.append(p)

    text = " ".join(str(p) for p in sources)
    imported = import_paths_from_message(str(root), conv_id, text)
    assert len(imported) == MAX_IMPORTS_PER_MESSAGE


def test_import_paths_from_message_merges(tmp_path: Path):
    root = tmp_path / "conversations"
    conv_id = 5
    source = tmp_path / "merge.md"
    source.write_text("merged", encoding="utf-8")

    imported = import_paths_from_message(
        str(root),
        conv_id,
        f"请分析 {source}",
    )
    assert len(imported) == 1
    assert imported[0]["path"] == "/uploads/merge.md"
    assert imported[0]["name"] == "merge.md"
