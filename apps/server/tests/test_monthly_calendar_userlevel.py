"""月历视图按 user_id 过滤员工（修跨用户泄漏）。"""

from __future__ import annotations

import json


def _shift_for_june_2026() -> str:
    # 给员工一个覆盖 2026-06 的排班，使其在月历里产生条目（否则无班无任务会被跳过）。
    return json.dumps(
        {
            "shift_id": 1,
            "shift_name": "白班",
            "start_date": "2026-06-01",
            "end_date": "2026-06-30",
        }
    )


def test_monthly_calendar_only_includes_requesting_user_employees(db_session):
    from src.models.employee import Employee
    from src.service.task_service import TaskService

    alice = Employee(
        workspace_id=1,
        user_id="u1",
        employee_code="a",
        name="Alice",
        shift_schedule_json=_shift_for_june_2026(),
    )
    bob = Employee(
        workspace_id=1,
        user_id="u2",
        employee_code="b",
        name="Bob",
        shift_schedule_json=_shift_for_june_2026(),
    )
    db_session.add_all([alice, bob])
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u1", year=2026, month=6
    )

    serialized = str(payload)
    assert "Alice" in serialized  # u1 自己的员工应出现
    assert "Bob" not in serialized  # 不得泄漏 u2 的员工

    leaked_ids = {
        emp.get("employee_id")
        for day in payload["days"].values()
        for emp in day["employees"]
    }
    assert bob.id not in leaked_ids
    assert alice.id in leaked_ids
