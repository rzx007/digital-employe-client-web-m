"""设备码归一化与展示格式（签发与验签共用）。"""

from __future__ import annotations

import re

_GROUP_SIZE = 4


def normalize_device_code(raw: str) -> str:
    """去除分隔符、大写，得到用于签名 / 比对的规范形式。"""
    if raw is None:
        return ""
    return re.sub(r"[^0-9A-Za-z]", "", str(raw)).upper()


def format_device_code(raw: str) -> str:
    """将规范设备码按 4 字符分组：``XXXX-XXXX-...``。"""
    normalized = normalize_device_code(raw)
    if not normalized:
        return ""
    groups = [
        normalized[i : i + _GROUP_SIZE]
        for i in range(0, len(normalized), _GROUP_SIZE)
    ]
    return "-".join(groups)
