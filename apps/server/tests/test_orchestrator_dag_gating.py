from src.models.task_execution_log import TaskExecutionLog


def test_execution_log_has_qa_accepted_at_field():
    assert "qa_accepted_at" in TaskExecutionLog.__table__.columns


# ---------------------------------------------------------------------------
# Task 2: 接受谓词 + 派发门槛测试
# ---------------------------------------------------------------------------
from src.models.employee import Employee
from src.models.workspace import Workspace, cst_now


def _seed_log(db, *, task_id, ws_id, emp_id, run_status="success",
              reported=True, accepted=False, orch_conv=999):
    log = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot="t", run_status=run_status, run_result="r",
        input_json="{}", output_json="{}", conversation_id=None,
        orchestrator_conversation_id=orch_conv, started_at=cst_now(),
        ended_at=cst_now(),
        reported_at=cst_now() if reported else None,
        qa_accepted_at=cst_now() if accepted else None,
    )
    db.add(log); db.commit()
    return log


def test_all_prereqs_accepted_pure():
    from src.service.agent.orchestrator.dependency_scheduler import _all_prereqs_accepted
    assert _all_prereqs_accepted([1, 2], {1, 2}) is True
    assert _all_prereqs_accepted([1, 2], {1}) is False
    assert _all_prereqs_accepted([], set()) is True


def test_load_accepted_task_ids_excludes_unaccepted_and_superseded(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import _load_accepted_task_ids
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    _seed_log(db_session, task_id=1, ws_id=ws.id, emp_id=emp.id, accepted=True)
    _seed_log(db_session, task_id=2, ws_id=ws.id, emp_id=emp.id, accepted=False)
    _seed_log(db_session, task_id=3, ws_id=ws.id, emp_id=emp.id, run_status="superseded", accepted=True)
    got = _load_accepted_task_ids(db_session, [1, 2, 3])
    assert got == {1}
