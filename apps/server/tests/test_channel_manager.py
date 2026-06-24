from src.models.channel_inbox import ChannelInbox
from src.service.channel.manager import ChannelManager
from src.service.channel.base import Channel


class FakeChannel(Channel):
    name = "feishu"
    def __init__(self): self.reports = []
    def start(self): ...
    def stop(self): ...
    def is_authorized(self, uid): return True
    def send_ack(self, chat_id, text): ...
    def send_report(self, chat_id, report): self.reports.append((chat_id, report))


def _row(db, **kw):
    base = dict(channel="feishu", external_user_id="ou", external_chat_id="oc",
               workspace_id=1, text="hi", status="acked")
    base.update(kw)
    r = ChannelInbox(**base); db.add(r); db.commit(); return r


def test_dispatch_pure_reply(db_session, monkeypatch):
    monkeypatch.setattr("src.service.channel.manager.build_channel_report", lambda db, row: "REPORT")
    monkeypatch.setattr("src.service.channel.manager.resolve_latest_run_id_by_conversation", lambda db, cid, **kw: None)
    row = _row(db_session, external_event_id="e1", conversation_id=10)
    mgr = ChannelManager(); fake = FakeChannel(); mgr.register(fake)
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed", "conversation_id": 10, "status": "idle"})
    assert fake.reports == [("oc", "REPORT")]
    db_session.refresh(row); assert row.status == "reported"
    # 幂等：再喂一次不重复
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed", "conversation_id": 10, "status": "idle"})
    assert len(fake.reports) == 1


def test_orchestration_backfill_then_settle(db_session, monkeypatch):
    monkeypatch.setattr("src.service.channel.manager.build_channel_report", lambda db, row: "REPORT")
    monkeypatch.setattr("src.service.channel.manager.resolve_latest_run_id_by_conversation", lambda db, cid, **kw: 77)
    row = _row(db_session, external_event_id="e2", conversation_id=20)
    mgr = ChannelManager(); fake = FakeChannel(); mgr.register(fake)
    # idle 先到：应回填 plan_run_id、不回执
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed", "conversation_id": 20, "status": "idle"})
    db_session.refresh(row)
    assert row.plan_run_id == 77 and row.status == "running"
    assert fake.reports == []
    # settled 到：回执
    mgr._on_terminal_event(db_session, {"type": "plan_run_settled", "run_id": 77, "workspace_id": 1, "conversation_id": 20})
    db_session.refresh(row)
    assert row.status == "reported" and len(fake.reports) == 1


def test_dispatch_latest_row_only(db_session, monkeypatch):
    monkeypatch.setattr("src.service.channel.manager.build_channel_report", lambda db, row: "R")
    monkeypatch.setattr("src.service.channel.manager.resolve_latest_run_id_by_conversation", lambda db, cid, **kw: None)
    old = _row(db_session, external_event_id="e3", conversation_id=30, status="reported")
    new = _row(db_session, external_event_id="e4", conversation_id=30, status="acked")
    mgr = ChannelManager(); fake = FakeChannel(); mgr.register(fake)
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed", "conversation_id": 30, "status": "idle"})
    db_session.refresh(new)
    assert new.status == "reported"  # 只命中 acked 新行


def test_stop_unsubscribes():
    """stop() 应退订全局队列，反复 start/stop 不在全局订阅集合泄漏废弃 queue。

    start() 会起后台线程 + 跑 reconcile_on_start（新开 DB session），在纯单测环境
    不稳定，故此处直接手动 subscribe_all 模拟订阅，再验证 stop() 退订。
    """
    from src.service.workspace_events import WorkspaceEventBus

    before = len(WorkspaceEventBus._global_subscribers)
    mgr = ChannelManager()
    mgr._queue = WorkspaceEventBus.subscribe_all()
    assert len(WorkspaceEventBus._global_subscribers) == before + 1  # 已订阅
    mgr.stop()  # 应 unsubscribe（_thread 为 None，join 跳过）
    after = len(WorkspaceEventBus._global_subscribers)
    assert after == before  # 无泄漏


def test_pure_reply_not_misled_by_stale_run(db_session, monkeypatch):
    """回归：共享会话残留历史 PlanRun 时，纯对话回复仍应立即回执（用真 resolve + since）。

    这正是真机暴露的 bug：飞书接盘的共享总管会话里有几小时前的 settled run，
    纯回复被误判成编排轮、傻等永不来的 plan_run_settled、永不回执。
    """
    from datetime import timedelta
    from src.models.plan_run import PlanRun
    from src.models.workspace import cst_now

    monkeypatch.setattr("src.service.channel.manager.build_channel_report", lambda db, row: "R")
    # 历史 run（6 小时前 settled），属同一会话 42
    db_session.add(PlanRun(plan_id=1, workspace_id=1, run_seq=1, status="settled",
                           conversation_id=42, started_at=cst_now() - timedelta(hours=6)))
    db_session.commit()
    # 之后才来的飞书指令（inbox 行 created_at = 现在）
    row = _row(db_session, external_event_id="e42", conversation_id=42, status="running")
    mgr = ChannelManager(); fake = FakeChannel(); mgr.register(fake)
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed",
                                        "conversation_id": 42, "status": "idle"})
    db_session.refresh(row)
    assert row.status == "reported"          # 历史 run 被 since 过滤 → 走纯回复回执
    assert fake.reports == [("oc", "R")]


def test_reconcile_interrupted(db_session, monkeypatch):
    class _R:
        @staticmethod
        def is_active(cid): return False
    monkeypatch.setattr("src.service.channel.manager.registry", _R())
    row = _row(db_session, external_event_id="e9", conversation_id=5, status="running")
    mgr = ChannelManager(); fake = FakeChannel(); mgr.register(fake)
    mgr.reconcile_on_start(db_session)
    db_session.refresh(row)
    assert row.status == "failed"
    assert fake.reports and "中断" in fake.reports[0][1]
