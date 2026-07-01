import json
from src.models.plan_run import PlanRun
from src.models.workspace import cst_now
from src.service.workspace_events import WorkspaceEventBus, PLAN_RUN_SETTLED
from src.service.agent.orchestrator.plan_run_service import settle_plan_run


def test_settle_plan_run_emits_event(db_session):
    run = PlanRun(plan_id=1, workspace_id=7, run_seq=1, status="running",
                  conversation_id=42, started_at=cst_now())
    db_session.add(run); db_session.commit()

    q = WorkspaceEventBus.subscribe(7)
    settle_plan_run(db_session, run.id)
    db_session.commit()

    evt = json.loads(q.get_nowait())
    assert evt["type"] == PLAN_RUN_SETTLED
    assert evt["status"] == "settled"
    assert evt["run_id"] == run.id
    assert evt["conversation_id"] == 42
    assert evt["workspace_id"] == 7


def test_mark_plan_run_failed_emits_event(db_session):
    from src.service.agent.orchestrator.plan_run_service import mark_plan_run_failed
    run = PlanRun(plan_id=1, workspace_id=9, run_seq=1, status="running",
                  conversation_id=5, started_at=cst_now())
    db_session.add(run); db_session.commit()
    q = WorkspaceEventBus.subscribe(9)
    mark_plan_run_failed(db_session, run)
    evt = json.loads(q.get_nowait())
    assert evt["type"] == PLAN_RUN_SETTLED
    assert evt["status"] == "failed"
    assert evt["run_id"] == run.id
