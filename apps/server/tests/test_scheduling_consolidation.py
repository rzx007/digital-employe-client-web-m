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
