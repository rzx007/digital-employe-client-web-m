"""本机物理绝对路径判定（纯函数，不依赖 deepagents）。

支持三端：Windows 盘符路径（C:\\、D:/）、macOS / Linux 绝对路径（/Users/、/home/）。
"""

from __future__ import annotations

import re

from src.service.agent.path_access.virtual_paths import is_virtual_path

_WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:(?:[/\\]|$)")


def is_host_absolute_path(path: str) -> bool:
    """是否为本机物理绝对路径（三端），且不是 CompositeBackend 虚拟路径。"""
    if not path:
        return False
    if _WINDOWS_DRIVE_RE.match(path):
        return True
    if path.startswith("/") and not is_virtual_path(path):
        return True
    return False


def normalize_host_path(path: str) -> str:
    """统一分隔符为 /，便于 deepagents 内部按 posix 处理。"""
    return path.replace("\\", "/")
