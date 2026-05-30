"""支持图片多模态与 Office/PDF 文本提取的 FilesystemBackend。"""

from __future__ import annotations

from pathlib import Path

from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import FileData, ReadResult
from deepagents.backends.utils import check_empty_content

from src.service.basic_file_reader import (
    BasicFileCategory,
    categorize_file,
    read_basic_file,
)


class BasicFileFilesystemBackend(FilesystemBackend):
    """read_file：文本直读；图片 base64 多模态；PDF/Office 提取为文本。"""

    def read(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> ReadResult:
        return basic_file_read(self, file_path, offset=offset, limit=limit)


def basic_file_read(
    backend: FilesystemBackend,
    file_path: str,
    offset: int = 0,
    limit: int = 2000,
) -> ReadResult:
    """任意 FilesystemBackend 实例：文本直读；PDF/Office 提取；图片 base64。"""
    try:
        resolved_path = backend._resolve_path(file_path)
    except (OSError, RuntimeError) as exc:
        return ReadResult(error=f"Error reading file '{file_path}': {exc}")

    if not resolved_path.exists() or not resolved_path.is_file():
        return ReadResult(error=f"File '{file_path}' not found")

    category = categorize_file(resolved_path)
    if category == BasicFileCategory.TEXT:
        return FilesystemBackend.read(
            backend, file_path, offset=offset, limit=limit
        )

    try:
        payload = read_basic_file(Path(resolved_path))
    except ValueError as exc:
        return ReadResult(error=str(exc))
    except OSError as exc:
        return ReadResult(error=f"Error reading file '{file_path}': {exc}")

    if category == BasicFileCategory.IMAGE:
        if not payload.base64_data:
            return ReadResult(error=f"File '{file_path}' is empty")
        return ReadResult(
            file_data=FileData(
                content=payload.base64_data,
                encoding="base64",
            )
        )

    text = payload.text or ""
    empty_msg = check_empty_content(text)
    if empty_msg:
        return ReadResult(
            file_data=FileData(content=empty_msg, encoding="utf-8")
        )

    lines = text.splitlines(keepends=True)
    start_idx = offset
    end_idx = min(start_idx + limit, len(lines))
    if start_idx >= len(lines):
        return ReadResult(
            error=(
                f"Line offset {offset} exceeds file length "
                f"({len(lines)} lines)"
            )
        )
    return ReadResult(
        file_data=FileData(
            content="".join(lines[start_idx:end_idx]),
            encoding="utf-8",
        )
    )
