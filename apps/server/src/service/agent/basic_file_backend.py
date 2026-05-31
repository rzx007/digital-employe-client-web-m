"""支持图片多模态与 Office/PDF 文本提取的 FilesystemBackend。"""

from __future__ import annotations

from pathlib import Path

from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import EditResult, FileData, FileDownloadResponse, ReadResult
from deepagents.backends.utils import check_empty_content, perform_string_replacement

from src.service.basic_file_reader import (
    BasicFileCategory,
    categorize_file,
    read_basic_file,
    read_text_with_encoding_fallback,
    write_text_as_utf8,
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

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        return basic_file_edit(
            self,
            file_path,
            old_string,
            new_string,
            replace_all=replace_all,
        )


class EncodingAwareFilesystemBackend(BasicFileFilesystemBackend):
    """MemoryMiddleware 用 download_files 读 AGENTS.md，须兼容 Windows GBK 并归一化为 UTF-8。"""

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses: list[FileDownloadResponse] = []
        for path in paths:
            try:
                resolved_path = Path(self._resolve_path(path))
            except (OSError, RuntimeError):
                responses.extend(super().download_files([path]))
                continue

            if (
                resolved_path.is_file()
                and categorize_file(resolved_path) == BasicFileCategory.TEXT
            ):
                try:
                    text = read_text_with_encoding_fallback(resolved_path)
                    write_text_as_utf8(resolved_path, text)
                    responses.append(
                        FileDownloadResponse(
                            path=path,
                            content=text.encode("utf-8"),
                            error=None,
                        )
                    )
                except OSError as exc:
                    responses.append(
                        FileDownloadResponse(
                            path=path,
                            content=None,
                            error=str(exc),
                        )
                    )
                continue

            responses.extend(super().download_files([path]))
        return responses


def _paginate_text_read_result(
    text: str,
    *,
    file_path: str,
    offset: int,
    limit: int,
) -> ReadResult:
    empty_msg = check_empty_content(text)
    if empty_msg:
        return ReadResult(file_data=FileData(content=empty_msg, encoding="utf-8"))

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
        try:
            text = read_text_with_encoding_fallback(Path(resolved_path))
        except OSError as exc:
            return ReadResult(error=f"Error reading file '{file_path}': {exc}")
        return _paginate_text_read_result(
            text, file_path=file_path, offset=offset, limit=limit
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
    return _paginate_text_read_result(
        text, file_path=file_path, offset=offset, limit=limit
    )


def basic_file_edit(
    backend: FilesystemBackend,
    file_path: str,
    old_string: str,
    new_string: str,
    *,
    replace_all: bool = False,
) -> EditResult:
    """纯文本 edit：读时编码回退，写回统一 UTF-8。"""
    try:
        resolved_path = backend._resolve_path(file_path)
    except (OSError, RuntimeError) as exc:
        return EditResult(error=f"Error editing file '{file_path}': {exc}")

    if not resolved_path.exists() or not resolved_path.is_file():
        return EditResult(error=f"Error: File '{file_path}' not found")

    if categorize_file(resolved_path) != BasicFileCategory.TEXT:
        return FilesystemBackend.edit(
            backend,
            file_path,
            old_string,
            new_string,
            replace_all=replace_all,
        )

    try:
        content = read_text_with_encoding_fallback(Path(resolved_path))
    except OSError as exc:
        return EditResult(error=f"Error editing file '{file_path}': {exc}")

    old_string = old_string.replace("\r\n", "\n").replace("\r", "\n")
    new_string = new_string.replace("\r\n", "\n").replace("\r", "\n")

    result = perform_string_replacement(
        content, old_string, new_string, replace_all
    )
    if isinstance(result, str):
        return EditResult(error=result)

    new_content, occurrences = result

    try:
        write_text_as_utf8(Path(resolved_path), new_content)
    except OSError as exc:
        return EditResult(error=f"Error editing file '{file_path}': {exc}")

    return EditResult(path=file_path, occurrences=int(occurrences))
