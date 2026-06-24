from src.models.plan_run import PlanRun
from src.models.workspace import cst_now
from src.service.orchestration_lifecycle import resolve_latest_run_id_by_conversation


def test_no_run_returns_none(db_session):
    assert resolve_latest_run_id_by_conversation(db_session, 123) is None


def test_returns_latest_run(db_session):
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=1, status="settled",
                           conversation_id=7, started_at=cst_now()))
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=2, status="running",
                           conversation_id=7, started_at=cst_now()))
    db_session.commit()
    rid = resolve_latest_run_id_by_conversation(db_session, 7)
    latest = db_session.query(PlanRun).filter_by(conversation_id=7).order_by(PlanRun.id.desc()).first()
    assert rid == latest.id
