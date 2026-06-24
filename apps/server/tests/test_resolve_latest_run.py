from datetime import timedelta

from src.models.plan_run import PlanRun
from src.models.workspace import cst_now
from src.service.orchestration_lifecycle import resolve_latest_run_id_by_conversation


def test_no_run_returns_none(db_session):
    assert resolve_latest_run_id_by_conversation(db_session, 123) is None


def test_since_excludes_old_run(db_session):
    """共享会话残留的历史 run 必须被 since 过滤掉（否则纯对话回复被误判成编排轮）。"""
    now = cst_now()
    old = now - timedelta(hours=6)
    # 历史 run（指令进来之前 6 小时就 settled 了）
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=1, status="settled",
                           conversation_id=27, started_at=old))
    db_session.commit()
    instruction_at = now  # inbox 行的 created_at
    # 不传 since：会捞到历史 run（旧行为，会误判）
    assert resolve_latest_run_id_by_conversation(db_session, 27) is not None
    # 传 since：历史 run 被排除 → None（纯对话回复路径）
    assert resolve_latest_run_id_by_conversation(
        db_session, 27, since=instruction_at) is None


def test_since_keeps_this_turn_run(db_session):
    """这条指令之后才开始的 run 应被保留（编排轮路径）。"""
    instruction_at = cst_now()
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=1, status="running",
                           conversation_id=28,
                           started_at=instruction_at + timedelta(seconds=3)))
    db_session.commit()
    rid = resolve_latest_run_id_by_conversation(db_session, 28, since=instruction_at)
    assert rid is not None


def test_returns_latest_run(db_session):
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=1, status="settled",
                           conversation_id=7, started_at=cst_now()))
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=2, status="running",
                           conversation_id=7, started_at=cst_now()))
    db_session.commit()
    rid = resolve_latest_run_id_by_conversation(db_session, 7)
    latest = db_session.query(PlanRun).filter_by(conversation_id=7).order_by(PlanRun.id.desc()).first()
    assert rid == latest.id
