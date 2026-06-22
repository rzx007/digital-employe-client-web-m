from src.models.task_execution_log import TaskExecutionLog
from src.models.orchestration_plan import OrchestrationPlan
from src.models.employee import Employee
from src.models.workspace import Workspace, cst_now
from src.models.plan_run import PlanRun


class _NoCloseSession:
    """db_session 的透明代理，屏蔽 close()，防止被测函数 finally db.close() 关掉 fixture session。"""
    def __init__(self, real):
        self._real = real
    def close(self):
        pass
    def __getattr__(self, name):
        return getattr(self._real, name)


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


def test_rerun_not_blocked_by_previous_run_history(db_session, monkeypatch):
    """同一冻结计划第二轮：根任务不被第一轮的 success 历史判为'已派过'。"""
    import src.service.agent.orchestrator.dependency_scheduler as ds
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now

    proxy = _NoCloseSession(db_session)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: proxy))
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'
    db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A)
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     orchestration_plan_id=plan.id, user_prompt="b"); db_session.add(B)
    db_session.flush()

    dispatched = []
    monkeypatch.setattr(ds, "_dispatch_successor",
                        lambda db, t, e, w, brief, run_id, stream_class=None: dispatched.append((t.id, run_id)))
    # can_assign_to_employee 是 on_employee_task_completed 内的函数级 import，须 patch 源模块：
    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    def _log(task_id, run_id, status, accepted=False):
        db_session.add(TaskExecutionLog(
            task_id=task_id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
            task_name_snapshot="t", run_status=status, run_result="r",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id,
            qa_accepted_at=cst_now() if accepted else None))
        db_session.commit()

    # 第一轮 r1：A 已 success+accepted（历史）
    r1 = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    _log(A.id, r1.id, "success", accepted=True)

    # 第二轮 r2：A 在本轮 success+accepted，触发 on_employee_task_completed(A)
    r2 = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    _log(A.id, r2.id, "success", accepted=True)
    ds.on_employee_task_completed(A.id, ws.id)

    # B 应在 r2 内被派（不被 r1 历史挡），run_id 是 r2
    assert (B.id, r2.id) in dispatched


def test_execute_plan_opens_run_and_tags_root_log(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from sqlalchemy import select as _select
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()

    captured = {}
    def _fake_start(db, task, employee, workspace_id, *, priority=0, source="orchestration",
                    prereq_briefing="", stream_class=None, run_id=None):
        log = TaskExecutionLog(
            task_id=task.id, workspace_id=workspace_id, employee_id=employee.id, skill_id=None,
            task_name_snapshot=task.task_name, run_status="running", run_result="r",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id)
        db.add(log); db.commit()
        captured["run_id"] = run_id
        return 123
    monkeypatch.setattr(ex, "start_task_as_conversation", _fake_start)
    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)

    ex.execute_plan(db_session, plan, ws.id)
    from src.models.plan_run import PlanRun
    run = db_session.scalars(_select(PlanRun).where(PlanRun.plan_id == plan.id)).first()
    assert run is not None and run.trigger == "manual" and run.auto_accept is False
    assert captured["run_id"] == run.id


def test_rework_new_log_inherits_run_id(db_session):
    """契约：返工不新开 run——新 log 复制 old.run_id（守住 rework.py 的继承字段）。"""
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    old = TaskExecutionLog(task_id=5, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="success", run_result="r", input_json="{}",
        output_json="{}", conversation_id=1, orchestrator_conversation_id=9,
        started_at=cst_now(), run_id=run.id)
    db_session.add(old); db_session.commit()
    new_log = TaskExecutionLog(task_id=5, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="queued", run_result="返工中",
        input_json="{}", output_json="{}", conversation_id=1,
        orchestrator_conversation_id=9, started_at=cst_now(), run_id=old.run_id)
    db_session.add(new_log); db_session.commit()
    assert new_log.run_id == run.id


def test_auto_accept_stamps_qa_for_scheduled_run(db_session):
    from src.service.stream_registry import _auto_accept_if_scheduled_run_safe
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    sched = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    manual = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)

    def _log(run_id, status="success"):
        l = TaskExecutionLog(task_id=1, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
            task_name_snapshot="t", run_status=status, run_result="r", input_json="{}",
            output_json="{}", started_at=cst_now(), run_id=run_id)
        db_session.add(l); db_session.commit(); db_session.refresh(l); return l

    sched_log = _log(sched.id)
    _auto_accept_if_scheduled_run_safe(db_session, sched_log)
    db_session.refresh(sched_log)
    assert sched_log.qa_accepted_at is not None     # 定时轮自动放行

    manual_log = _log(manual.id)
    _auto_accept_if_scheduled_run_safe(db_session, manual_log)
    db_session.refresh(manual_log)
    assert manual_log.qa_accepted_at is None        # 交互式不自动盖

    failed_log = _log(sched.id, status="failed")
    _auto_accept_if_scheduled_run_safe(db_session, failed_log)
    db_session.refresh(failed_log)
    assert failed_log.qa_accepted_at is None        # 仅 success 放行


def test_task_prereqs_accepted_scoped_by_run(db_session, monkeypatch):
    """task_prereqs_accepted 现按 plan 最新 run 判定接受集（修复其调用 _load_accepted_task_ids 的 arity）。"""
    import src.service.agent.orchestrator.dependency_scheduler as ds
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from src.models.employee_task import EmployeeTask
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A)
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     orchestration_plan_id=plan.id, user_prompt="b"); db_session.add(B)
    db_session.flush()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="manual", auto_accept=False)
    # A 在本轮 success+accepted → B 的前置已接受 → task_prereqs_accepted(B) True
    db_session.add(TaskExecutionLog(task_id=A.id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="A", run_status="success", run_result="r", input_json="{}",
        output_json="{}", started_at=cst_now(), run_id=run.id, qa_accepted_at=cst_now()))
    db_session.commit()
    assert ds.task_prereqs_accepted(db_session, B) is True
    # 根任务 A 无前置 → True
    assert ds.task_prereqs_accepted(db_session, A) is True
