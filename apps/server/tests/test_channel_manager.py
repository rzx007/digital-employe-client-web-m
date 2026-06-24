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
    monkeypatch.setattr("src.service.channel.manager.resolve_latest_run_id_by_conversation", lambda db, cid: None)
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
    monkeypatch.setattr("src.service.channel.manager.resolve_latest_run_id_by_conversation", lambda db, cid: 77)
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
    monkeypatch.setattr("src.service.channel.manager.resolve_latest_run_id_by_conversation", lambda db, cid: None)
    old = _row(db_session, external_event_id="e3", conversation_id=30, status="reported")
    new = _row(db_session, external_event_id="e4", conversation_id=30, status="acked")
    mgr = ChannelManager(); fake = FakeChannel(); mgr.register(fake)
    mgr._on_terminal_event(db_session, {"type": "conversation_status_changed", "conversation_id": 30, "status": "idle"})
    db_session.refresh(new)
    assert new.status == "reported"  # 只命中 acked 新行


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
