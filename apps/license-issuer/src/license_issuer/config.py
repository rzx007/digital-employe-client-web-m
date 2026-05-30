"""签发工具默认路径。

私钥默认与 ``de-license`` 可执行文件同目录的 ``private_key.pem``（便于整包分发）。
开发态 ``uv run de-license`` 时，目录为 ``apps/license-issuer/``。
仍可通过 ``--private-key``、``DE_LICENSE_PRIVATE_KEY`` 或
``~/.digital-employee-admin/private_key.pem``（仅当同目录无私钥时回退）覆盖。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

DEFAULT_ADMIN_DIR = Path.home() / ".digital-employee-admin"
LEGACY_PRIVATE_KEY = DEFAULT_ADMIN_DIR / "private_key.pem"
LEGACY_PUBLIC_KEY = DEFAULT_ADMIN_DIR / "public_key.pem"

_PRIVATE_KEY_NAME = "private_key.pem"
_PUBLIC_KEY_NAME = "public_key.pem"


def tool_install_dir() -> Path:
    """de-license 所在目录（PyInstaller 单文件 exe 的目录）。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    # .../apps/license-issuer/src/license_issuer/config.py -> apps/license-issuer
    return Path(__file__).resolve().parents[2]


def default_private_key_path() -> Path:
    return tool_install_dir() / _PRIVATE_KEY_NAME


def default_public_key_path() -> Path:
    return tool_install_dir() / _PUBLIC_KEY_NAME


def resolve_private_key(path: str | None) -> Path:
    if path:
        return Path(path).expanduser()
    env = os.getenv("DE_LICENSE_PRIVATE_KEY", "").strip()
    if env:
        return Path(env).expanduser()
    tool_key = default_private_key_path()
    if tool_key.exists():
        return tool_key
    if LEGACY_PRIVATE_KEY.exists():
        return LEGACY_PRIVATE_KEY
    return tool_key


def resolve_public_key(path: str | None) -> Path:
    if path:
        return Path(path).expanduser()
    env = os.getenv("DE_LICENSE_PUBLIC_KEY", "").strip()
    if env:
        return Path(env).expanduser()
    tool_pub = default_public_key_path()
    if tool_pub.exists():
        return tool_pub
    if LEGACY_PUBLIC_KEY.exists():
        return LEGACY_PUBLIC_KEY
    return tool_pub


def private_key_hint() -> str:
    tool = default_private_key_path()
    lines = [
        f"将组织私钥放到: {tool}",
        f"或指定: --private-key / 环境变量 DE_LICENSE_PRIVATE_KEY",
    ]
    if LEGACY_PRIVATE_KEY != tool:
        lines.append(f"（回退路径: {LEGACY_PRIVATE_KEY}）")
    return "\n".join(lines)
