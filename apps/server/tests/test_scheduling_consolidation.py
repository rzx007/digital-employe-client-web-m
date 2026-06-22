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
