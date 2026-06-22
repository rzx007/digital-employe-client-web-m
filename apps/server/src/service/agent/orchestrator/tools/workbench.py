"""[已迁移] arrange_workbench 已搬到 src.service.agent.tools.workbench。

本文件保留 re-export 以兼容历史 import，勿在此新增逻辑。
"""
from __future__ import annotations

from src.service.agent.tools.workbench import (  # noqa: F401
    ARRANGE_RESULT_MARKER,
    SPAN_PRESETS,
    arrange_workbench,
    build_html_resolver_from_entries,
    normalize_operations,
)

__all__ = [
    "arrange_workbench",
    "normalize_operations",
    "build_html_resolver_from_entries",
    "ARRANGE_RESULT_MARKER",
    "SPAN_PRESETS",
]
