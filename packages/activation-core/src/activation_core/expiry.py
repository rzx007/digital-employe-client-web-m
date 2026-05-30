"""授权到期时间解析（签发工具与 CLI 共用）。"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone


def parse_expires(value: str) -> datetime:
    """解析 ``YYYY-MM-DD``、``+30d``、``+12m``、``+1y`` 或 ISO8601。"""
    value = value.strip()
    rel = re.fullmatch(r"\+(\d+)([dmy])", value)
    if rel:
        amount = int(rel.group(1))
        unit = rel.group(2)
        now = datetime.now(timezone.utc)
        if unit == "d":
            return now + timedelta(days=amount)
        if unit == "m":
            return now + timedelta(days=30 * amount)
        return now + timedelta(days=365 * amount)
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    return dt
