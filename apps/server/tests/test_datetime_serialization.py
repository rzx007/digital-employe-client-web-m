"""Characterization tests locking datetime serialization behavior after the
column→CstDateTime swap (plan Task 4).

Two response schemas have NO field_serializer and now emit ISO-8601 with the
"+08:00" CST offset: OrchestrationPlanRead and SkillRatingRead. The remaining
schemas use an @field_serializer(...).strftime("%Y-%m-%d %H:%M:%S") which strips
the tz, so their output is unchanged.
"""

from __future__ import annotations

import re

from src.core.cst import cst_now
from src.schemas.orchestration import OrchestrationPlanRead
from src.schemas.skill_rating import SkillRatingRead
from src.schemas.task import EmployeeTaskRead


# ---------------------------------------------------------------------------
# No-serializer schemas: aware datetime -> ISO-8601 carrying "+08:00"
# ---------------------------------------------------------------------------


def test_orchestration_plan_read_emits_cst_offset():
    now = cst_now()
    plan = OrchestrationPlanRead.model_validate(
        {
            "id": 1,
            "workspace_id": 1,
            "conversation_id": 1,
            "message_id": None,
            "user_input": "x",
            "plan_json": None,
            "status": "pending",
            "total_tasks": 0,
            "completed_tasks": 0,
            "created_at": now,
            "updated_at": now,
        }
    )
    dumped = plan.model_dump(mode="json")
    assert "+08:00" in dumped["created_at"]
    assert "+08:00" in dumped["updated_at"]


def test_skill_rating_read_emits_cst_offset():
    now = cst_now()
    rating = SkillRatingRead.model_validate(
        {
            "id": 1,
            "workspace_id": 1,
            "employee_id": 1,
            "conversation_id": None,
            "message_id": None,
            "task_execution_log_id": None,
            "skill_id": 1,
            "skill_name": "s",
            "score": 5,
            "comment": None,
            "created_at": now,
        }
    )
    dumped = rating.model_dump(mode="json")
    assert "+08:00" in dumped["created_at"]


# ---------------------------------------------------------------------------
# strftime-serializer schema: aware datetime -> "YYYY-MM-DD HH:MM:SS", no offset
# ---------------------------------------------------------------------------

_STRFTIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")


def test_employee_task_read_strftime_unchanged():
    now = cst_now()
    task = EmployeeTaskRead.model_validate(
        {
            "id": 1,
            "workspace_id": 1,
            "employee_id": 1,
            "employee_name_snapshot": None,
            "task_name": "t",
            "dispatch_type": "skill",
            "skill_id": None,
            "capability_id": None,
            "priority": 0,
            "task_type": None,
            "cron_expression": "",
            "cron_expression_type": "",
            "is_active": True,
            "confirm_execution_result": False,
            "user_prompt": None,
            "source": "manual",
            "task_input": {},
            "next_run_at": None,
            "last_run_at": None,
            "created_at": now,
            "updated_at": now,
        }
    )
    dumped = task.model_dump(mode="json")
    assert _STRFTIME_RE.match(dumped["created_at"]), dumped["created_at"]
    assert "+08:00" not in dumped["created_at"]
    assert _STRFTIME_RE.match(dumped["updated_at"]), dumped["updated_at"]
