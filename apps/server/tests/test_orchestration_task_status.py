"""OrchestrationTaskItem.status 必须接受 _build_task_items 实际产出的全部状态。

orchestration_api._build_task_items 把 latest_log.run_status 在 failed/cancelled 时原样
透传给 status。Literal 漏 'cancelled' 时，含已取消子任务的计划在「总管会话加载」会
ValidationError → 500「总管会话加载失败」。守此回归。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.schemas.orchestration import OrchestrationTaskItem

# _build_task_items 实际可产出的状态全集（pending/success/failed/cancelled/running + queued）
_PRODUCED_STATUSES = ["pending", "running", "success", "failed", "queued", "cancelled"]


@pytest.mark.parametrize("status", _PRODUCED_STATUSES)
def test_orchestration_task_item_accepts_produced_status(status: str) -> None:
    item = OrchestrationTaskItem(
        task_id=1,
        employee_id=2,
        employee_name="员工",
        task_name="任务",
        prompt="p",
        status=status,
    )
    assert item.status == status


def test_orchestration_task_item_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        OrchestrationTaskItem(
            task_id=1,
            employee_id=2,
            employee_name="员工",
            task_name="任务",
            prompt="p",
            status="bogus",
        )
