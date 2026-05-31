from __future__ import annotations

from typing import Any


def compute_requires_confirmation(task_list: list[dict[str, Any]]) -> bool:
    """所有编排计划均须用户手动确认后再执行（卡片按钮或文字确认）。"""
    _ = task_list
    return True
