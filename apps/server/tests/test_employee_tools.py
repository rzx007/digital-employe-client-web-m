"""employee_tools.build_employee_update_payload 增量更新。"""

from __future__ import annotations

from src.service.agent.orchestrator.employee_tools import build_employee_update_payload


def test_build_payload_skill_ids_only_excludes_name():
    payload = build_employee_update_payload(skill_ids=[])

    assert "employee_name" not in payload.model_fields_set
    assert "capability_desc" not in payload.model_fields_set
    assert payload.skill_ids == []


def test_build_payload_includes_only_provided_fields():
    payload = build_employee_update_payload(
        employee_name="  法务助手  ",
        capability_desc="负责合同审查",
    )

    assert payload.employee_name == "法务助手"
    assert payload.capability_desc == "负责合同审查"
    assert "skill_ids" not in payload.model_fields_set
