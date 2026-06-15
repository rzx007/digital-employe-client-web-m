"""2B：信号闸门 critic。"""
import json
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from tests.conftest import add_employee


def _log(db, ws_id, emp_id, *, task_id, status, error=None):
    lg = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id,
        task_name_snapshot="活", run_status=status,
        output_json=json.dumps({"content": "ok"}, ensure_ascii=False),
        error_message=error, started_at=cst_now(), ended_at=cst_now(),
    )
    db.add(lg); db.commit(); db.refresh(lg)
    return lg


def test_detect_failure_then_success_positive(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=7, status="failed", error="ModuleNotFound xyz")
    success = _log(db_session, workspace.id, emp.id, task_id=7, status="success")
    ctx = detect_failure_then_success(db_session, success)
    assert ctx is not None
    assert "xyz" in ctx


def test_detect_no_prior_failure_returns_none(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    success = _log(db_session, workspace.id, emp.id, task_id=8, status="success")
    assert detect_failure_then_success(db_session, success) is None


def test_detect_non_success_log_returns_none(db_session, workspace):
    from src.service.reflection_engine import detect_failure_then_success
    emp = add_employee(db_session, workspace.id, name="w")
    _log(db_session, workspace.id, emp.id, task_id=9, status="failed", error="x")
    failed2 = _log(db_session, workspace.id, emp.id, task_id=9, status="failed", error="y")
    assert detect_failure_then_success(db_session, failed2) is None
