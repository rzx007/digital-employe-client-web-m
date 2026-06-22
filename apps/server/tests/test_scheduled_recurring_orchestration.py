from src.models.task_execution_log import TaskExecutionLog
from src.models.orchestration_plan import OrchestrationPlan
from src.models.employee import Employee
from src.models.workspace import Workspace
from src.models.plan_run import PlanRun


def test_execution_log_has_run_id_column():
    assert "run_id" in TaskExecutionLog.__table__.columns


def test_plan_has_cron_and_recurring_columns():
    cols = OrchestrationPlan.__table__.columns
    for name in ("cron", "is_recurring", "last_run_at", "next_run_at"):
        assert name in cols, name


def test_plan_run_table_exists():
    from src.models.plan_run import PlanRun
    for name in ("plan_id", "run_seq", "trigger", "auto_accept", "status"):
        assert name in PlanRun.__table__.columns, name


def _seed_ws_plan(db):
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    plan = OrchestrationPlan(
        workspace_id=ws.id, conversation_id=1, user_input="x",
        plan_json="[]", status="confirmed", total_tasks=0,
    )
    db.add(plan); db.flush()
    return ws, plan


def test_open_plan_run_increments_run_seq(db_session):
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    ws, plan = _seed_ws_plan(db_session)
    r1 = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    r2 = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    assert r1.run_seq == 1 and r2.run_seq == 2
    assert r2.trigger == "scheduled" and r2.auto_accept is True
    assert r2.status == "running"


def test_latest_run_id_for_task(db_session):
    from src.service.agent.orchestrator.plan_run_service import (
        open_plan_run, latest_run_id_for_task,
    )
    from src.models.workspace import cst_now
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    log = TaskExecutionLog(
        task_id=77, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="success", run_result="r",
        input_json="{}", output_json="{}", started_at=cst_now(), run_id=run.id,
    )
    db_session.add(log); db_session.commit()
    assert latest_run_id_for_task(db_session, 77) == run.id
    assert latest_run_id_for_task(db_session, 999) is None


def test_latest_run_id_for_task_ignores_null_run_logs(db_session):
    from src.service.agent.orchestrator.plan_run_service import (
        open_plan_run, latest_run_id_for_task,
    )
    from src.models.workspace import cst_now
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)

    def _log(run_id):
        db_session.add(TaskExecutionLog(
            task_id=55, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
            task_name_snapshot="t", run_status="success", run_result="r",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id))
        db_session.commit()

    _log(run.id)   # 编排日志
    _log(None)     # 之后来了一条非编排日志（run_id=NULL）
    # 仍应返回编排轮 run.id，而不是 None
    assert latest_run_id_for_task(db_session, 55) == run.id


def test_log_status_by_task_scoped_by_run(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import _log_status_by_task
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from src.models.workspace import cst_now
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    r1 = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    r2 = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)

    def _log(task_id, run_id, status):
        db_session.add(TaskExecutionLog(
            task_id=task_id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
            task_name_snapshot="t", run_status=status, run_result="r",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id))
    _log(10, r1.id, "success")   # 上一轮
    _log(10, r2.id, "running")   # 本轮
    db_session.commit()

    # 只看本轮 r2：task10 是 running，不含上一轮的 success
    got = _log_status_by_task(db_session, [10], r2.id)
    assert got == {10: {"running"}}
    # 看 r1：只有 success
    assert _log_status_by_task(db_session, [10], r1.id) == {10: {"success"}}
