"""#1 计划卡片 inline-edit：编辑待确认编排计划的子任务(prompt/换员工)。"""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from tests.conftest import add_employee


def _setup_plan(db, ws, emp_ids, status="pending"):
    plan_json = [
        {"employee_id": emp_ids[0], "task_name": "A", "prompt": "做A"},
        {"employee_id": emp_ids[1], "task_name": "B", "prompt": "做B", "depends_on": 0},
    ]
    plan = OrchestrationPlan(
        workspace_id=ws.id, conversation_id=1, user_input="x",
        plan_json=json.dumps(plan_json, ensure_ascii=False),
        status=status, total_tasks=2,
    )
    db.add(plan)
    db.flush()
    tasks = []
    for spec in plan_json:
        t = EmployeeTask(
            workspace_id=ws.id, employee_id=spec["employee_id"],
            employee_name_snapshot="", task_name=spec["task_name"],
            dispatch_type="skill", cron_expression="", cron_expression_type="custom",
            user_prompt=spec["prompt"], task_input_json="{}",
            execute_mode="immediate", source="orchestration",
            orchestration_plan_id=plan.id, is_active=True,
        )
        db.add(t)
        tasks.append(t)
    db.commit()
    for t in tasks:
        db.refresh(t)
    db.refresh(plan)
    return plan, tasks


def _svc():
    from src.service.orchestration_lifecycle import update_pending_plan_task
    return update_pending_plan_task


def test_edit_prompt(db_session, workspace):
    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan, tasks = _setup_plan(db_session, workspace, [a.id, b.id])

    out = _svc()(db_session, workspace.id, plan.id, tasks[0].id, prompt="做A-改")
    assert out["prompt"] == "做A-改"
    db_session.refresh(tasks[0])
    assert tasks[0].user_prompt == "做A-改"
    # plan_json 镜像同步
    pj = json.loads(db_session.get(OrchestrationPlan, plan.id).plan_json)
    assert pj[0]["prompt"] == "做A-改"


def test_change_employee_syncs_snapshot_and_plan_json(db_session, workspace):
    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    c = add_employee(db_session, workspace.id, name="丙")
    plan, tasks = _setup_plan(db_session, workspace, [a.id, b.id])

    out = _svc()(db_session, workspace.id, plan.id, tasks[1].id, employee_id=c.id)
    assert out["employee_id"] == c.id
    assert out["employee_name"] == "丙"
    db_session.refresh(tasks[1])
    assert tasks[1].employee_id == c.id
    assert tasks[1].employee_name_snapshot == "丙"
    pj = json.loads(db_session.get(OrchestrationPlan, plan.id).plan_json)
    assert pj[1]["employee_id"] == c.id


def test_reject_when_not_pending(db_session, workspace):
    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan, tasks = _setup_plan(db_session, workspace, [a.id, b.id], status="confirmed")
    with pytest.raises(HTTPException) as ei:
        _svc()(db_session, workspace.id, plan.id, tasks[0].id, prompt="x")
    assert ei.value.status_code == 400


def test_reject_employee_collapse_to_same(db_session, workspace):
    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan, tasks = _setup_plan(db_session, workspace, [a.id, b.id])
    # 把 B 也改成甲 → 全部塌成同一员工
    with pytest.raises(HTTPException) as ei:
        _svc()(db_session, workspace.id, plan.id, tasks[1].id, employee_id=a.id)
    assert ei.value.status_code == 400
    db_session.refresh(tasks[1])
    assert tasks[1].employee_id == b.id  # 未改动


def test_404_task_not_in_plan(db_session, workspace):
    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan, _ = _setup_plan(db_session, workspace, [a.id, b.id])
    with pytest.raises(HTTPException) as ei:
        _svc()(db_session, workspace.id, plan.id, 999999, prompt="x")
    assert ei.value.status_code == 404


def test_404_employee_missing(db_session, workspace):
    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan, tasks = _setup_plan(db_session, workspace, [a.id, b.id])
    with pytest.raises(HTTPException) as ei:
        _svc()(db_session, workspace.id, plan.id, tasks[0].id, employee_id=888888)
    assert ei.value.status_code == 404


def test_endpoint_wiring(db_session, workspace):
    from src.api import orchestration_api
    from src.schemas.orchestration import OrchestrationTaskEdit
    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan, tasks = _setup_plan(db_session, workspace, [a.id, b.id])
    resp = orchestration_api.update_plan_task(
        workspace.id, plan.id, tasks[0].id,
        OrchestrationTaskEdit(prompt="做A-改"), db=db_session,
    )
    assert resp.data["prompt"] == "做A-改"
