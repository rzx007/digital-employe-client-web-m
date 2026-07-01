"""Structured updates for /memories/AGENTS.md (avoid brittle edit_file matching)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

from src.service.agent.paths import _EMPLOYEE_MEMORY_TEMPLATE
from src.service.basic_file_reader import (
    read_text_with_encoding_fallback,
    write_text_as_utf8,
)

MemorySection = Literal["preference", "fact"]

_SECTION_HEADERS: dict[MemorySection, str] = {
    "preference": "## 用户偏好",
    "fact": "## 已知事实与约定",
}

_SECTION_ALIASES: dict[str, MemorySection] = {
    "preference": "preference",
    "pref": "preference",
    "用户偏好": "preference",
    "偏好": "preference",
    "fact": "fact",
    "facts": "fact",
    "已知事实与约定": "fact",
    "已知事实": "fact",
    "事实": "fact",
    "约定": "fact",
}

_PLACEHOLDER_RE = re.compile(
    r"^\s*(?:[-*]\s*)?[（(]暂无[）)]\s*$",
    re.MULTILINE,
)


def normalize_memory_section(value: str) -> MemorySection | None:
    compact = value.strip()
    lowered = compact.lower()
    if lowered in _SECTION_ALIASES:
        return _SECTION_ALIASES[lowered]
    return _SECTION_ALIASES.get(compact)


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _normalize_bullet(text: str) -> str:
    line = " ".join(text.strip().split())
    if not line.startswith("- "):
        line = f"- {line.lstrip('- ').strip()}"
    return line


def _bullet_body(line: str) -> str:
    return re.sub(r"^\s*[-*]\s*", "", line.strip())


def _is_placeholder_line(line: str) -> bool:
    return bool(_PLACEHOLDER_RE.match(line.strip()))


def ensure_memory_file_utf8(memory_file: Path) -> bool:
    """若记忆文件非 UTF-8，则按 GBK 等回退读取并转存为 UTF-8。"""
    if not memory_file.is_file():
        return False
    raw = memory_file.read_bytes()
    if not raw:
        return False
    try:
        raw.decode("utf-8")
        return False
    except UnicodeDecodeError:
        pass

    text = read_text_with_encoding_fallback(memory_file)
    write_text_as_utf8(memory_file, _normalize_newlines(text))
    return True


def decode_memory_bytes(raw: bytes) -> str:
    """MemoryMiddleware 注入记忆时使用，兼容 GBK 等非 UTF-8 文件。"""
    if not raw:
        return ""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass
    return read_text_with_encoding_fallback_from_bytes(raw)


def read_text_with_encoding_fallback_from_bytes(raw: bytes) -> str:
    from src.service.basic_file_reader import _TEXT_FALLBACK_ENCODINGS

    for encoding in _TEXT_FALLBACK_ENCODINGS:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def normalize_all_memory_files(skill_root: Path | None = None) -> int:
    """启动时扫描 */memories/AGENTS.md，将 GBK 等非 UTF-8 记忆转存为 UTF-8。"""
    import os

    from src.core.config import get_settings

    root = skill_root
    if root is None:
        settings = get_settings()
        root = Path(os.path.expandvars(os.path.expanduser(settings.skill_path)))
        if not root.is_absolute():
            root = (Path.cwd() / root).resolve()

    if not root.is_dir():
        return 0

    converted = 0
    for memory_file in root.glob("*/memories/AGENTS.md"):
        if ensure_memory_file_utf8(memory_file):
            converted += 1
    return converted


def append_memory_entry(
    memory_file: Path,
    *,
    section: MemorySection,
    text: str,
) -> tuple[bool, str]:
    """Append one bullet under a memory section. Returns (changed, message)."""
    entry = _normalize_bullet(text)
    body = _bullet_body(entry)
    if not body:
        return False, "记忆内容不能为空"

    if memory_file.is_file():
        content = _normalize_newlines(read_text_with_encoding_fallback(memory_file))
    else:
        memory_file.parent.mkdir(parents=True, exist_ok=True)
        content = _normalize_newlines(_EMPLOYEE_MEMORY_TEMPLATE)

    header = _SECTION_HEADERS[section]
    lines = content.split("\n")

    header_idx = next(
        (i for i, line in enumerate(lines) if line.strip() == header),
        None,
    )
    if header_idx is None:
        insert_at = len(lines)
        for i, line in enumerate(lines):
            if line.strip().startswith("---"):
                insert_at = i
                break
        block = ["", header, entry]
        if insert_at >= len(lines) or not lines[insert_at - 1].strip():
            lines[insert_at:insert_at] = block
        else:
            lines.extend(block)
        write_text_as_utf8(memory_file, "\n".join(lines).rstrip() + "\n")
        return True, f"已写入「{header}」：{body}"

    section_end = len(lines)
    for i in range(header_idx + 1, len(lines)):
        stripped = lines[i].strip()
        if stripped.startswith("## ") or stripped.startswith("---"):
            section_end = i
            break

    existing_bodies = {
        _bullet_body(line)
        for line in lines[header_idx + 1 : section_end]
        if line.strip() and not _is_placeholder_line(line)
    }
    if body in existing_bodies:
        return False, f"该记忆已存在，无需重复写入：{body}"

    cleaned: list[str] = []
    for line in lines[header_idx + 1 : section_end]:
        if _is_placeholder_line(line):
            continue
        cleaned.append(line)

    cleaned.append(entry)
    new_lines = (
        lines[: header_idx + 1]
        + cleaned
        + lines[section_end:]
    )
    write_text_as_utf8(memory_file, "\n".join(new_lines).rstrip() + "\n")
    return True, f"已写入「{header}」：{body}"
