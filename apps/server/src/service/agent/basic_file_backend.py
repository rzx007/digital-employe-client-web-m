"""支持图片多模态与 Office/PDF 文本提取的 FilesystemBackend。"""

from __future__ import annotations

import os
from pathlib import Path

from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import (
    EditResult,
    FileData,
    ReadResult,
    WriteResult,
)
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

    def write(self, file_path: str, content: str) -> WriteResult:
        return basic_file_write(self, file_path, content)


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
    total_lines = len(lines)
    start_idx = offset
    end_idx = min(start_idx + limit, total_lines)
    if start_idx >= total_lines:
        return ReadResult(
            error=(
                f"Line offset {offset} exceeds file length "
                f"({total_lines} lines)"
            )
        )
    result = ReadResult(
        file_data=FileData(
            content="".join(lines[start_idx:end_idx]),
            encoding="utf-8",
        )
    )
    result.pagination_meta = {
        "total_lines": total_lines,
        "has_more": end_idx < total_lines,
    }
    return result


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


def _replace_with_line_endwsp_tolerance(
    content: str, old_string: str, new_string: str
) -> str | None:
    """精确匹配失败时的容忍 fallback：行末空白与文件末换行差异。

    归一化策略（仅这两类容忍，不动行首缩进/行内空白）：
    1. 每行 rstrip（行末空白差异）
    2. old_string 末尾的空行被忽略（模型常给文件没有的末尾 \\n）

    仅当归一化后**唯一命中**时才替换（在原 content 行序列上替换、保留原行格式）；
    多于一处即视为歧义、保留原错误，避免错改。
    """
    content_lines = content.split("\n")
    norm_content = [line.rstrip() for line in content_lines]
    norm_old = [line.rstrip() for line in old_string.split("\n")]
    # 去掉 old 末尾的空行：等价于「忽略 old 末尾多余的 \n」
    while norm_old and norm_old[-1] == "":
        norm_old.pop()
    n = len(norm_old)
    if n == 0 or n > len(norm_content):
        return None
    matches: list[int] = []
    for i in range(len(norm_content) - n + 1):
        if norm_content[i : i + n] == norm_old:
            matches.append(i)
            if len(matches) > 1:
                return None
    if len(matches) != 1:
        return None
    start = matches[0]
    new_lines = new_string.split("\n")
    result_lines = content_lines[:start] + new_lines + content_lines[start + n :]
    return "\n".join(result_lines)


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
        # 兜底：行末空白容忍重试。模型常因 old_string 行尾多/少一个空格、或文件末
        # 尾换行差异反复撞 "String not found"。把 content 与 old_string 都按行
        # rstrip 后再找；仅当归一化后唯一命中时才接受替换（多于一处则保留原错误，
        # 避免错改）。行内缩进/制表符不动，保留代码结构敏感性。
        if not replace_all and result.startswith("Error: String not found"):
            fuzzy = _replace_with_line_endwsp_tolerance(
                content, old_string, new_string
            )
            if fuzzy is not None:
                new_content = fuzzy
                try:
                    write_text_as_utf8(Path(resolved_path), new_content)
                except OSError as exc:
                    return EditResult(
                        error=f"Error editing file '{file_path}': {exc}"
                    )
                return EditResult(path=file_path, occurrences=1)
            # fallback 也失败：在原错误上追加 hint，引导模型重读最新文件
            result = (
                f"{result}\nHint: 请先 read_file 拿到最新内容再构造 old_string，"
                "并保留原文件的行内空白与缩进。"
            )
        return EditResult(error=result)

    new_content, occurrences = result

    try:
        write_text_as_utf8(Path(resolved_path), new_content)
    except OSError as exc:
        return EditResult(error=f"Error editing file '{file_path}': {exc}")

    return EditResult(path=file_path, occurrences=int(occurrences))


def basic_file_write(
    backend: FilesystemBackend,
    file_path: str,
    content: str,
) -> WriteResult:
    """写文件：**同名直接覆盖**，不报 "already exists"。

    deepagents 默认 write 在文件已存在时直接返回错误，逼模型改用 edit_file；本地小模型
    常不照做、反复 write 同名路径陷入「创建→报错→再创建」死循环（如反复重建
    wuhan_travel.py 修语法错误）。这里改成覆盖语义：保留父目录自动创建、O_NOFOLLOW
    防穿越符号链接、UTF-8 无 CRLF 转换，仅去掉「已存在即报错」这一限制。
    """
    try:
        resolved_path = backend._resolve_path(file_path)
    except (OSError, RuntimeError) as exc:
        return WriteResult(error=f"Error writing file '{file_path}': {exc}")

    try:
        resolved_path.parent.mkdir(parents=True, exist_ok=True)

        # O_TRUNC：存在则清空重写；O_NOFOLLOW：拒绝写穿符号链接。
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(resolved_path, flags, 0o644)
        # newline="" 关掉 Windows CRLF 转换，磁盘上保持 LF。
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(content)
        return WriteResult(path=file_path)
    except (OSError, UnicodeEncodeError) as exc:
        return WriteResult(error=f"Error writing file '{file_path}': {exc}")
