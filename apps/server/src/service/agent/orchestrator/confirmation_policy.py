from __future__ import annotations

from typing import Any


def compute_requires_confirmation(task_list: list[dict[str, Any]]) -> bool:
    """与总管 Prompt「确认策略」一致：简单任务可自动 confirm。

    简单：全部即时、无依赖、子任务数 ≤ 2 → False
    其他：定时、有 depends_on、或 ≥ 3 个子任务 → True
    """
    if len(task_list) > 2:
        return True
    for task in task_list:
        cron = task.get("cron")
        if cron is not None and str(cron).strip():
            return True
        depends_on = task.get("depends_on")
        if depends_on is not None and depends_on != "":
            return True
    return False
