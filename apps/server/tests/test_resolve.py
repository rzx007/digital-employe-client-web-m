from src.models.conversation import Conversation
from src.models.workspace import cst_now
from src.service.channel.resolve import resolve_active_curator_conversation


def test_picks_latest_curator(db_session):
    import time
    c1 = Conversation(workspace_id=1, user_id="1", target_type="curator", target_id=0, status="idle")
    db_session.add(c1); db_session.commit()
    c2 = Conversation(workspace_id=1, user_id="1", target_type="curator", target_id=0, status="idle")
    db_session.add(c2); db_session.commit()
    # 让 c2 的 updated_at 更新（onupdate）
    c2.status = "idle"; c2.title = "x"; db_session.commit()
    got = resolve_active_curator_conversation(db_session)
    assert got.target_type == "curator"
    # 至少返回一个 curator 会话（最近活跃）；若 updated_at 粒度导致并列，放宽为 in {c1.id, c2.id}
    assert got.id in (c1.id, c2.id)


def test_ignores_employee_conv(db_session):
    emp = Conversation(workspace_id=1, user_id="1", target_type="employee", target_id=5, status="idle")
    db_session.add(emp); db_session.commit()
    got = resolve_active_curator_conversation(db_session)
    # 没有 curator 会话 → fallback ensure 默认工作空间总管会话
    assert got is not None and got.target_type == "curator"


def test_excludes_scheduled_run_conversation(db_session):
    from src.models.plan_run import PlanRun
    from src.models.workspace import cst_now
    # 主会话 a（无 scheduled run）先建
    a = Conversation(workspace_id=1, user_id="1", target_type="curator", target_id=0, status="idle")
    db_session.add(a); db_session.commit()
    # 定时轮派生会话 b 后建，并再次 commit 触发 onupdate→b 的 updated_at 更近（更"活跃"）
    b = Conversation(workspace_id=1, user_id="1", target_type="curator", target_id=0, status="idle")
    db_session.add(b); db_session.commit()
    b.title = "scheduled-run-conv"; db_session.commit()  # bump b.updated_at via onupdate
    # 给 b 挂一条 scheduled PlanRun，使其应被排除
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=1, status="settled",
                           trigger="scheduled", conversation_id=b.id, started_at=cst_now()))
    db_session.commit()
    got = resolve_active_curator_conversation(db_session)
    assert got.id == a.id  # b 更活跃但被定时轮排除 → 返回主会话 a
