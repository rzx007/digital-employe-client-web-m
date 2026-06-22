def _seed_ws_plan_sc(db):
    from src.models.workspace import Workspace
    from src.models.orchestration_plan import OrchestrationPlan
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db.add(ws); db.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="查热搜并总结",
        plan_json="[]", status="confirmed", total_tasks=0)
    db.add(plan); db.flush()
    return ws, plan


def test_plan_has_schedule_kind_and_run_at_columns():
    from src.models.orchestration_plan import OrchestrationPlan
    cols = OrchestrationPlan.__table__.columns
    assert "schedule_kind" in cols
    assert "run_at" in cols


def test_parse_schedule_recurring_cron_passthrough(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: (None, None))
    spec = parse_schedule("0 10 * * *", now=cst_now())
    assert spec is not None and spec.kind == "recurring" and spec.cron == "0 10 * * *"


def test_parse_schedule_once_via_llm(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm",
        lambda text, now: ("once", "2026-06-22 21:34:00"))
    spec = parse_schedule("5分钟后提醒", now=cst_now())
    assert spec.kind == "once" and spec.run_at is not None and spec.cron is None


def test_parse_schedule_recurring_via_llm(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm",
        lambda text, now: ("recurring", "30 9 * * *"))
    spec = parse_schedule("每天上午9点半", now=cst_now())
    assert spec.kind == "recurring" and spec.cron == "30 9 * * *"


def test_parse_schedule_unparseable_returns_none(monkeypatch):
    import src.service.schedule_parser as sp
    from src.service.schedule_parser import parse_schedule
    from src.models.workspace import cst_now
    monkeypatch.setattr(sp, "_classify_with_llm", lambda text, now: (None, None))
    assert parse_schedule("满月的子时", now=cst_now()) is None


def test_create_scheduled_run_conversation_helper(db_session):
    from src.service.agent.orchestrator.plan_run_service import (
        open_plan_run, create_scheduled_run_conversation,
    )
    from src.models.employee import Employee
    from src.models.conversation import Conversation, ConversationMessage
    from sqlalchemy import select
    import json
    ws, plan = _seed_ws_plan_sc(db_session)
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    conv_id = create_scheduled_run_conversation(db_session, plan, run)
    conv = db_session.get(Conversation, conv_id)
    assert conv.target_type == "curator"
    flags = json.loads(conv.session_flags or "{}")
    assert flags["kind"] == "scheduled_run" and flags["plan_id"] == plan.id and flags["run_seq"] == run.run_seq
    msgs = db_session.scalars(select(ConversationMessage).where(ConversationMessage.conversation_id == conv_id)).all()
    assert any("查热搜并总结" in (m.content or "") for m in msgs)


def test_execute_plan_run_scheduled_opens_new_conversation(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.conversation import Conversation
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.plan_json = '[{"depends_on": null}]'; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True)
    db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()

    seen = {}
    monkeypatch.setattr(ex, "start_immediate_tasks",
        lambda db, tasks, plan, ws_id, run_id, orchestrator_conversation_id=None:
            seen.update(run_id=run_id, orch_conv=orchestrator_conversation_id) or [])

    run = ex.execute_plan_run(db_session, plan, trigger="scheduled", auto_accept=True)
    assert run.trigger == "scheduled" and run.conversation_id is not None
    conv = db_session.get(Conversation, run.conversation_id)
    assert conv.target_type == "curator"  # 新 per-run 会话
    assert seen["run_id"] == run.id and seen["orch_conv"] == run.conversation_id


def test_execute_plan_run_manual_reuses_plan_conversation(db_session, monkeypatch):
    import src.service.agent.orchestrator.execution as ex
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.conversation import Conversation
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.plan_json = '[{"depends_on": null}]'
    conv = Conversation(workspace_id=ws.id, user_id="u-ws1", target_type="curator", target_id=1, title="源")
    db_session.add(conv); db_session.flush()
    plan.conversation_id = conv.id; db_session.commit()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    monkeypatch.setattr(ex, "start_immediate_tasks", lambda *a, **k: [])
    run = ex.execute_plan_run(db_session, plan, trigger="manual", auto_accept=False)
    assert run.trigger == "manual" and run.conversation_id == conv.id  # 复用创建源会话


def test_execute_plan_scheduled_only_registers(db_session, monkeypatch):
    """定时计划(schedule_kind 非空)：execute_plan 只注册调度、不立即跑、不开 PlanRun。"""
    import src.service.agent.orchestrator.execution as ex
    from src.models.plan_run import PlanRun
    from sqlalchemy import select
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "recurring"; plan.cron = "0 10 * * *"; db_session.commit()
    called = {}
    monkeypatch.setattr("src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        classmethod(lambda cls: called.setdefault("reload", True)))
    ran = {"run": False}
    monkeypatch.setattr(ex, "execute_plan_run", lambda *a, **k: ran.update(run=True))
    msg = ex.execute_plan(db_session, plan, ws.id)
    assert called.get("reload") and not ran["run"]
    assert db_session.scalars(select(PlanRun).where(PlanRun.plan_id == plan.id)).first() is None


def test_execute_plan_immediate_runs_via_primitive(db_session, monkeypatch):
    """即时计划(无 schedule)：execute_plan 走 execute_plan_run(manual)。"""
    import src.service.agent.orchestrator.execution as ex
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = None; plan.cron = None; db_session.commit()
    seen = {}
    monkeypatch.setattr(ex, "execute_plan_run",
        lambda db, p, *, trigger, auto_accept: seen.update(trigger=trigger, auto=auto_accept))
    ex.execute_plan(db_session, plan, ws.id)
    assert seen == {"trigger": "manual", "auto": False}


def test_reload_jobs_task_scan_excludes_all_orchestration_subtasks(db_session):
    from sqlalchemy import select, func
    from src.models.employee_task import EmployeeTask
    from src.models.employee import Employee
    from src.models.workspace import Workspace
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    standalone = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="独立",
        execute_mode="scheduled", cron_expression="0 9 * * *", dispatch_type="skill", is_active=True)
    sub = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="子",
        execute_mode="scheduled", cron_expression="0 9 * * *", dispatch_type="skill",
        orchestration_plan_id=1, is_active=True)
    db_session.add_all([standalone, sub]); db_session.commit()
    rows = db_session.scalars(select(EmployeeTask).where(
        EmployeeTask.is_active.is_(True),
        EmployeeTask.dispatch_type == "skill",
        EmployeeTask.cron_expression.isnot(None),
        func.trim(EmployeeTask.cron_expression) != "",
        EmployeeTask.orchestration_plan_id.is_(None),
    )).all()
    ids = {t.id for t in rows}
    assert standalone.id in ids and sub.id not in ids


def test_reload_jobs_plan_scan_includes_once_and_recurring(db_session):
    from sqlalchemy import select
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.workspace import Workspace, cst_now
    from datetime import timedelta
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u"); db_session.add(ws); db_session.flush()
    rec = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="r", plan_json="[]",
        status="confirmed", schedule_kind="recurring", cron="0 10 * * *")
    once_future = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="o", plan_json="[]",
        status="confirmed", schedule_kind="once", run_at=cst_now() + timedelta(hours=1))
    once_done = OrchestrationPlan(workspace_id=ws.id, conversation_id=1, user_input="d", plan_json="[]",
        status="done", schedule_kind="once", run_at=cst_now() + timedelta(hours=1))
    db_session.add_all([rec, once_future, once_done]); db_session.commit()
    rows = db_session.scalars(select(OrchestrationPlan).where(
        OrchestrationPlan.status == "confirmed",
        OrchestrationPlan.schedule_kind.isnot(None),
    )).all()
    ids = {p.id for p in rows}
    assert rec.id in ids and once_future.id in ids and once_done.id not in ids


def test_run_plan_job_once_auto_stops(db_session, monkeypatch):
    """once 计划跑完 status=done，不再被调度。"""
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.workspace import cst_now
    from sqlalchemy.orm import sessionmaker
    from datetime import timedelta
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "once"; plan.run_at = cst_now() + timedelta(minutes=5)
    db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "execute_plan_run", lambda *a, **k: None)
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "done"  # once 自停


def test_run_plan_job_recurring_updates_next_run(db_session, monkeypatch):
    import src.service.task_scheduler_service as tss
    import src.service.agent.orchestrator.execution as ex
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from sqlalchemy.orm import sessionmaker
    ws, plan = _seed_ws_plan_sc(db_session)
    plan.schedule_kind = "recurring"; plan.cron = "0 10 * * *"; db_session.commit()
    curator = Employee(workspace_id=ws.id, name="总管", employee_code="curator", is_curator=True); db_session.add(curator); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c", user_id=ws.user_id); db_session.add(emp); db_session.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A",
        execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a"); db_session.add(A); db_session.commit()
    plan_id = plan.id
    sf = sessionmaker(bind=db_session.get_bind())
    monkeypatch.setattr(tss, "get_session_local", lambda: sf)
    monkeypatch.setattr(ex, "execute_plan_run", lambda *a, **k: None)
    tss.TaskSchedulerService.run_plan_job(plan_id)
    with sf() as d:
        p = d.get(OrchestrationPlan, plan_id)
        assert p.status == "confirmed" and p.last_run_at is not None and p.next_run_at is not None
