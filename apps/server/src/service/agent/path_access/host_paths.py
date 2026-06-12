"""本机物理绝对路径判定（纯函数，不依赖 deepagents）。

支持三端：Windows 盘符路径（C:\\、D:/）、macOS / Linux 绝对路径（/Users/、/home/）。
"""

from __future__ import annotations

import re

_WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:(?:[/\\]|$)")


def is_host_absolute_path(path: str) -> bool:
    """是否为本机物理绝对路径（三端）。

    删除虚拟前缀后，所有以 `/` 开头的绝对路径与 Windows 盘符路径均按 host 处理
    （不再有 /artifacts/ 等虚拟前缀需要排除）。
    """
    if not path:
        return False
    if _WINDOWS_DRIVE_RE.match(path):
        return True
    if path.startswith("/"):
        return True
    return False


def normalize_host_path(path: str) -> str:
    """统一分隔符为 /，便于 deepagents 内部按 posix 处理。"""
    return path.replace("\\", "/")
