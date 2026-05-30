"""激活策略：是否强制激活、时钟回拨容忍度。

拔插要点：在线 / 离线是否要求激活只取决于 ``is_activation_enforced()`` 这一处。
默认沿用「仅离线包要求激活」，若在线版也要激活，改这里的判定即可（例如
``return True`` 或读取独立的 ``ACTIVATION_ENFORCED`` env）。
"""

from __future__ import annotations

import os

from src.core.config import is_offline_mode

CLOCK_ROLLBACK_TOLERANCE_HOURS = 24
EXPIRY_WARNING_DAYS = 7


def is_activation_bypassed() -> bool:
    """仅供开发：跳过激活校验。不应进入生产打包。"""
    return os.getenv("ACTIVATION_BYPASS", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def is_activation_enforced() -> bool:
    """是否强制激活（单一真相）。

    当前策略：离线包强制激活；``ACTIVATION_BYPASS=1`` 时跳过。
    在线版若也需要激活，将此处改为 ``return not is_activation_bypassed()``
    或基于独立 env / 打包标记判定。
    """
    if is_activation_bypassed():
        return False
    return is_offline_mode()
