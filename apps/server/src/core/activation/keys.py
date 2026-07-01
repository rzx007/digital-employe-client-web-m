"""加载嵌入的激活公钥。

优先级：
1. 环境变量 ``ACTIVATION_PUBLIC_KEY_PEM``（整段 PEM，便于测试 / 临时覆盖）
2. 同目录 ``public_key.pem``（随客户端打包分发）

私钥永不进客户端，仅管理员本机持有。
"""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

_PUBLIC_KEY_FILENAME = "public_key.pem"
_RELATIVE_PEM = Path("src") / "core" / "activation" / _PUBLIC_KEY_FILENAME


class PublicKeyMissingError(RuntimeError):
    """未找到激活公钥。"""


def _public_key_candidates() -> list[Path]:
    candidates: list[Path] = [Path(__file__).resolve().parent / _PUBLIC_KEY_FILENAME]
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / _RELATIVE_PEM)
    return candidates


@lru_cache(maxsize=1)
def load_public_key_pem() -> bytes:
    env_pem = os.getenv("ACTIVATION_PUBLIC_KEY_PEM")
    if env_pem and env_pem.strip():
        return env_pem.strip().encode("utf-8")

    for path in _public_key_candidates():
        if path.exists():
            data = path.read_bytes().strip()
            if data:
                return data

    raise PublicKeyMissingError(
        "未找到激活公钥：请将 public_key.pem 放入 core/activation/ "
        "或设置 ACTIVATION_PUBLIC_KEY_PEM 环境变量"
    )


def has_public_key() -> bool:
    try:
        load_public_key_pem()
        return True
    except PublicKeyMissingError:
        return False
