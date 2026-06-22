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
                        lambda db, t, e, w, brief, run_id, *, stream_class=None, orchestrator_conversation_id=None: dispatched.append((t.id, run_id)))
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
                    prereq_briefing="", stream_class=None, run_id=None, orchestrator_conversation_id=None):
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


def test_run_plan_job_opens_scheduled_run_without_curator(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee_task import EmployeeTask
    from sqlalchemy import select as _select
    from sqlalchemy.orm import sessionmaker
    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True; plan.plan_json = '[{"depends_on": null}]'
    db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()

    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    seen = {}
    monkeypatch.setattr(ex, "start_immediate_tasks",
                        lambda db, tasks, plan, ws_id, run_id, orchestrator_conversation_id=None:
                            seen.setdefault("run_id", run_id) or [])
    monkeypatch.setattr(tss.TaskSchedulerService, "_start_curator_task",
                        classmethod(lambda cls, *a, **k: (_ for _ in ()).throw(AssertionError("不该调总管"))))

    tss.TaskSchedulerService.run_plan_job(plan.id)

    with sf() as d:
        run = d.scalars(_select(PlanRun).where(PlanRun.plan_id == plan.id)).first()
        assert run is not None and run.trigger == "scheduled" and run.auto_accept is True
    assert seen.get("run_id") is not None


def test_two_scheduled_runs_end_to_end(db_session, monkeypatch):
    """run_plan_job ×2：每轮 A→B 全链跑通，第二轮不被第一轮历史挡，B 各属各轮。"""
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    import src.service.agent.orchestrator.dependency_scheduler as ds
    import src.service.stream_registry as sr
    from src.models.employee_task import EmployeeTask
    from sqlalchemy import select as _select
    from sqlalchemy.orm import sessionmaker

    sf = sessionmaker(bind=db_session.get_bind())
    # tss.run_plan_job uses `with get_session_local()() as db:` — give it the test bind.
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    # ds.on_employee_task_completed opens its own session via get_session_local — same bind.
    monkeypatch.setattr(ds, "get_session_local", lambda: sf)

    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="b")
    db_session.add_all([A, B]); db_session.commit()
    plan_id = plan.id

    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    # Replace the real stream-start with a synchronous: create success log + auto-accept + drive completion.
    def _fake_start(db, task, employee, workspace_id, *, priority=0, source="orchestration",
                    prereq_briefing="", stream_class=None, run_id=None, orchestrator_conversation_id=None):
        log = TaskExecutionLog(task_id=task.id, workspace_id=workspace_id, employee_id=employee.id,
            skill_id=None, task_name_snapshot=task.task_name, run_status="success", run_result="ok",
            input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id)
        db.add(log); db.commit(); db.refresh(log)
        sr._auto_accept_if_scheduled_run_safe(db, log)
        ds.on_employee_task_completed(task.id, workspace_id)
        return log.conversation_id or 1
    monkeypatch.setattr(ex, "start_task_as_conversation", _fake_start)
    # _dispatch_successor (in ds) forwards to start_task_as_conversation; route it through the same fake.
    monkeypatch.setattr(ds, "_dispatch_successor",
        lambda db, t, e, w, brief, rid, *, stream_class=None, orchestrator_conversation_id=None: _fake_start(db, t, e, w, run_id=rid))

    # Two scheduled fires.
    tss.TaskSchedulerService.run_plan_job(plan_id)
    tss.TaskSchedulerService.run_plan_job(plan_id)

    runs = db_session.scalars(_select(PlanRun).where(PlanRun.plan_id == plan_id)
                              .order_by(PlanRun.run_seq)).all()
    assert [r.run_seq for r in runs] == [1, 2]
    for r in runs:
        logs = db_session.scalars(_select(TaskExecutionLog).where(TaskExecutionLog.run_id == r.id)).all()
        names = sorted(l.task_name_snapshot for l in logs)
        assert names == ["A", "B"], f"run {r.run_seq} 应有 A、B 各一条，实得 {names}"


def test_create_plan_with_schedule_sets_plan_cron(db_session, monkeypatch):
    import src.service.agent.orchestrator.tools.plans as tp
    monkeypatch.setattr(tp, "get_db", lambda: db_session)
    monkeypatch.setattr(tp, "get_workspace_id", lambda: 1)
    monkeypatch.setattr(tp, "get_conversation_id", lambda: 1)
    monkeypatch.setattr(tp, "parse_nl_cron", lambda s: "0 10 * * *", raising=False)
    monkeypatch.setattr(tp, "execute_plan", lambda db, plan, ws: "scheduled")
    monkeypatch.setattr(tp, "compute_requires_confirmation", lambda tl: False)
    ws = Workspace(id=1, name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(id=1, workspace_id=1, name="e", employee_code="c"); db_session.add(emp); db_session.commit()
    tasks = [{"employee_id": 1, "task_name": "热搜", "prompt": "查热搜", "depends_on": None}]
    tp.create_orchestration_plan.func("每天查热搜", tasks, schedule="每天10点")
    from sqlalchemy import select as _select
    plan = db_session.scalars(_select(OrchestrationPlan)).first()
    assert plan.cron == "0 10 * * *" and plan.is_recurring is True


def test_run_plan_job_stamps_next_run_and_fails_run_on_dispatch_error(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee_task import EmployeeTask
    from src.models.orchestration_plan import OrchestrationPlan
    from sqlalchemy import select as _select
    from sqlalchemy.orm import sessionmaker
    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True; plan.plan_json = '[{"depends_on": null}]'
    db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()
    plan_id = plan.id

    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    # 让派发抛错 → 走 except 分支
    def _boom(*a, **k):
        raise RuntimeError("dispatch boom")
    monkeypatch.setattr(ex, "start_immediate_tasks", _boom)

    tss.TaskSchedulerService.run_plan_job(plan_id)

    from src.models.plan_run import PlanRun
    with sf() as d:
        run = d.scalars(_select(PlanRun).where(PlanRun.plan_id == plan_id)).first()
        assert run is not None and run.status == "failed" and run.ended_at is not None
        p = d.get(OrchestrationPlan, plan_id)
        assert p.next_run_at is not None and p.last_run_at is not None


def test_create_plan_with_unparseable_schedule_errors_not_degrades(db_session, monkeypatch):
    import src.service.agent.orchestrator.tools.plans as tp
    from sqlalchemy import select as _select
    from src.models.orchestration_plan import OrchestrationPlan
    monkeypatch.setattr(tp, "get_db", lambda: db_session)
    monkeypatch.setattr(tp, "get_workspace_id", lambda: 1)
    monkeypatch.setattr(tp, "get_conversation_id", lambda: 1)
    monkeypatch.setattr(tp, "parse_nl_cron", lambda s: None, raising=False)  # 模拟解析失败
    monkeypatch.setattr(tp, "execute_plan", lambda db, plan, ws: "should-not-run")
    monkeypatch.setattr(tp, "compute_requires_confirmation", lambda tl: False)
    ws = Workspace(id=1, name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(id=1, workspace_id=1, name="e", employee_code="c"); db_session.add(emp); db_session.commit()
    tasks = [{"employee_id": 1, "task_name": "热搜", "prompt": "查热搜", "depends_on": None}]
    result = tp.create_orchestration_plan.func("每天查热搜", tasks, schedule="每个满月的子时")
    assert "无法解析" in result            # 返回错误而非静默降级
    # 不应持久化任何 plan
    assert db_session.scalars(_select(OrchestrationPlan)).first() is None


def test_plan_run_has_conversation_id_column():
    from src.models.plan_run import PlanRun
    assert "conversation_id" in PlanRun.__table__.columns


def test_start_task_explicit_orch_conv_overrides_default(db_session, monkeypatch):
    """显式 orchestrator_conversation_id 直接生效，不再 fallback 到 task.source_conversation_id。"""
    import src.service.agent.orchestrator.execution as ex
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    from sqlalchemy import select as _select

    ws, plan = _seed_ws_plan(db_session)
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    # 计划创建源会话
    src_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="原")
    # 本轮专属会话
    run_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="本轮")
    db_session.add_all([src_conv, run_conv]); db_session.flush()
    plan.conversation_id = src_conv.id; db_session.commit()
    task = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                       execute_mode="immediate", orchestration_plan_id=plan.id,
                       user_prompt="a", source_conversation_id=src_conv.id)
    db_session.add(task); db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()

    # 截 stream 启动：只关心日志的 orchestrator_conversation_id 落到哪
    monkeypatch.setattr(ex, "get_main_loop", lambda: type("L", (), {"call_soon_threadsafe": lambda self, fn: None})())
    monkeypatch.setattr("src.service.agent.employee.get_agent", lambda *a, **k: object())
    monkeypatch.setattr("src.llm.factory.resolve_output_tokens", lambda t: 1024)
    monkeypatch.setattr("src.service.product_paths.resolve_conversation_product_root", lambda db, c: "/tmp")
    monkeypatch.setattr("src.service.stream_registry.registry.can_admit", lambda cls: True)

    ex.start_task_as_conversation(
        db_session, task, emp, ws.id,
        run_id=run.id,
        orchestrator_conversation_id=run_conv.id,
    )
    log = db_session.scalars(_select(TaskExecutionLog).where(TaskExecutionLog.task_id == task.id)).first()
    assert log is not None and log.orchestrator_conversation_id == run_conv.id  # 用了本轮会话
    # 模板 task.source_conversation_id 不被改写
    db_session.refresh(task)
    assert task.source_conversation_id == src_conv.id


def test_on_employee_task_completed_dispatches_downstream_with_run_conversation(db_session, monkeypatch):
    """下游派发也走本轮 PlanRun.conversation_id（不走 task.source_conversation_id fallback）。"""
    import src.service.agent.orchestrator.dependency_scheduler as ds
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.service.agent.orchestrator.plan_run_service import open_plan_run

    proxy = _NoCloseSession(db_session)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: proxy))
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    src_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="原")
    run_conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="本轮")
    db_session.add_all([src_conv, run_conv]); db_session.flush()
    plan.conversation_id = src_conv.id; db_session.commit()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     orchestration_plan_id=plan.id, source_conversation_id=src_conv.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     orchestration_plan_id=plan.id, source_conversation_id=src_conv.id, user_prompt="b")
    db_session.add_all([A, B]); db_session.commit()

    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    run.conversation_id = run_conv.id; db_session.commit()

    dispatched_orch_conv = []
    monkeypatch.setattr(ds, "_dispatch_successor",
        lambda db, t, e, w, brief, run_id, *, stream_class=None, orchestrator_conversation_id=None:
            dispatched_orch_conv.append(orchestrator_conversation_id))
    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    import src.service.stream_registry as sr
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    # A 本轮 success + accepted → 触发 on_employee_task_completed(A)
    db_session.add(TaskExecutionLog(task_id=A.id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="A", run_status="success", run_result="ok", input_json="{}",
        output_json="{}", started_at=cst_now(), run_id=run.id,
        qa_accepted_at=cst_now(), orchestrator_conversation_id=run_conv.id))
    db_session.commit()
    ds.on_employee_task_completed(A.id, ws.id)
    # B 被派、orch_conv 是本轮会话
    assert dispatched_orch_conv == [run_conv.id]


def test_run_plan_job_creates_per_run_conversation_and_seeds_user_input(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.conversation import Conversation, ConversationMessage
    from src.models.employee_task import EmployeeTask
    from src.models.plan_run import PlanRun
    from sqlalchemy import select as _select
    from sqlalchemy.orm import sessionmaker
    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True
    plan.plan_json = '[{"depends_on": null}]'
    plan.user_input = "每2分钟查热搜并总结成文档"
    db_session.commit()
    # 必须先有 curator employee
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="热搜", employee_code="hot", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()
    plan_id = plan.id

    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    seen = {}
    monkeypatch.setattr(ex, "start_immediate_tasks",
        lambda db, tasks, plan, ws_id, run_id, orchestrator_conversation_id=None:
            seen.setdefault("orch_conv", orchestrator_conversation_id) or [])

    tss.TaskSchedulerService.run_plan_job(plan_id)

    with sf() as d:
        run = d.scalars(_select(PlanRun).where(PlanRun.plan_id == plan_id)).first()
        assert run is not None and run.conversation_id is not None
        conv = d.get(Conversation, run.conversation_id)
        assert conv is not None
        assert conv.target_type == "curator"
        # session_flags 标记
        import json
        flags = json.loads(conv.session_flags or "{}")
        assert flags.get("kind") == "scheduled_run"
        assert flags.get("plan_id") == plan_id
        assert flags.get("run_seq") == run.run_seq
        # 种 user_input 消息
        msgs = list(d.scalars(_select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conv.id)).all())
        assert any(m.role == "user" and "每2分钟查热搜并总结成文档" in (m.content or "") for m in msgs)
    # orch_conv 透传到派单链
    assert seen.get("orch_conv") == run.conversation_id


def test_execute_plan_manual_run_writes_conversation_id_from_plan(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.plan_run import PlanRun
    from sqlalchemy import select as _select
    ws, plan = _seed_ws_plan(db_session)
    plan.plan_json = '[{"depends_on": null}]'; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=emp.id, title="源")
    db_session.add(conv); db_session.flush()
    plan.conversation_id = conv.id; db_session.commit()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    db_session.add(A); db_session.commit()
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])
    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    ex.execute_plan(db_session, plan, ws.id)
    run = db_session.scalars(_select(PlanRun).where(PlanRun.plan_id == plan.id)).first()
    assert run is not None and run.trigger == "manual" and run.conversation_id == conv.id


def test_today_task_read_has_plan_fields():
    from src.schemas.task import TodayTaskRead
    fields = TodayTaskRead.model_fields
    assert "is_plan" in fields and "plan_id" in fields and "run_seq" in fields


def test_conversation_read_exposes_session_flags():
    from src.schemas.conversation import ConversationRead
    assert "session_flags" in ConversationRead.model_fields


def test_two_runs_get_separate_conversations(db_session, monkeypatch):
    """两轮调度各开一个 curator 会话，子任务日志 orch_conv 分别落到对应会话。"""
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    import src.service.agent.orchestrator.dependency_scheduler as ds
    import src.service.stream_registry as sr
    from src.models.conversation import Conversation
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.plan_run import PlanRun
    from sqlalchemy import select as _select
    from sqlalchemy.orm import sessionmaker

    sf = sessionmaker(bind=db_session.get_bind())
    for mod in (tss, ds):
        monkeypatch.setattr(mod, "get_session_local", lambda: sf, raising=False)

    ws, plan = _seed_ws_plan(db_session)
    plan.cron = "0 10 * * *"; plan.is_recurring = True
    plan.user_input = "每天查热搜→总结文档"
    plan.plan_json = '[{"depends_on": null}, {"depends_on": [0]}]'
    db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="emp", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="b")
    db_session.add_all([A, B]); db_session.commit()
    plan_id = plan.id

    monkeypatch.setattr("src.service.agent.orchestrator.runtime.can_assign_to_employee", lambda db, eid: True)
    monkeypatch.setattr(sr.registry, "can_admit", lambda cls: True)

    def _fake_start(db, task, employee, workspace_id, *, priority=0, source="orchestration",
                    prereq_briefing="", stream_class=None, run_id=None,
                    orchestrator_conversation_id=None):
        log = TaskExecutionLog(
            task_id=task.id, workspace_id=workspace_id, employee_id=employee.id,
            skill_id=None, task_name_snapshot=task.task_name, run_status="success",
            run_result="ok", input_json="{}", output_json="{}", started_at=cst_now(),
            run_id=run_id, orchestrator_conversation_id=orchestrator_conversation_id,
        )
        db.add(log); db.commit(); db.refresh(log)
        sr._auto_accept_if_scheduled_run_safe(db, log)
        ds.on_employee_task_completed(task.id, workspace_id)
        return 1

    monkeypatch.setattr(ex, "start_task_as_conversation", _fake_start)
    monkeypatch.setattr(ds, "_dispatch_successor",
        lambda db, t, e, w, brief, rid, *, stream_class=None, orchestrator_conversation_id=None:
            _fake_start(db, t, e, w, run_id=rid, orchestrator_conversation_id=orchestrator_conversation_id))

    # 两轮触发
    tss.TaskSchedulerService.run_plan_job(plan_id)
    tss.TaskSchedulerService.run_plan_job(plan_id)

    runs = db_session.scalars(_select(PlanRun).where(PlanRun.plan_id == plan_id)
                              .order_by(PlanRun.run_seq)).all()
    assert [r.run_seq for r in runs] == [1, 2]
    # 每轮一个 conversation，互不相同
    conv_ids = [r.conversation_id for r in runs]
    assert all(c is not None for c in conv_ids) and len(set(conv_ids)) == 2
    # 每轮的子任务日志 orch_conv 落到本轮会话
    for r in runs:
        logs = db_session.scalars(_select(TaskExecutionLog)
            .where(TaskExecutionLog.run_id == r.id)).all()
        assert all(l.orchestrator_conversation_id == r.conversation_id for l in logs)
    # 每个 conv session_flags 带正确标记
    import json
    for r in runs:
        conv = db_session.get(Conversation, r.conversation_id)
        flags = json.loads(conv.session_flags or "{}")
        assert flags["kind"] == "scheduled_run" and flags["plan_id"] == plan_id
        assert flags["run_seq"] == r.run_seq
