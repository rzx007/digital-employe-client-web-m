"""签发服务配置：私钥路径、调用方 token、默认到期。全部来自环境变量。"""

from __future__ import annotations

import os
from pathlib import Path

from license_issuer.config import resolve_private_key

DEFAULT_EXPIRES = "+90d"


def get_private_key_path() -> Path:
    """私钥路径：复用 issuer 解析（DE_LICENSE_PRIVATE_KEY / 默认 / 回退）。"""
    return resolve_private_key(None)


def get_api_token() -> str:
    """调用方 Bearer token；为空表示未配置（接口将拒绝所有调用）。"""
    return os.getenv("ISSUER_API_TOKEN", "").strip()


def get_default_expires() -> str:
    return os.getenv("ISSUER_DEFAULT_EXPIRES", DEFAULT_EXPIRES).strip() or DEFAULT_EXPIRES
