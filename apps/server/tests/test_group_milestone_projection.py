import json
import pytest
from src.service.group_room_service import GroupRoomService


class _FakeMsg:
    def __init__(self, content):
        self.content = content


def test_conclusion_completed_carries_delivered_milestone(monkeypatch):
    """成员流完成 → 投影消息 extra_meta 带 role=worker + milestone.kind=delivered。"""
    captured = {}

    def _fake_post(db, room, *, role, content, sender_id, sender_label,
                   extra_meta=None, **kw):
        captured["role"] = role
        captured["extra_meta"] = extra_meta
        captured["content"] = content
        return _FakeMsg(content)

    monkeypatch.setattr(GroupRoomService, "post_to_timeline", staticmethod(_fake_post))
    monkeypatch.setattr(GroupRoomService, "update_member_state", staticmethod(lambda *a, **k: None))

    GroupRoomService._project_member_milestone(
        room=object(), db=None, member_employee_id=7, sender_label="张三",
        member_conversation_id=42, kind="delivered", text="文案已完成",
        artifacts=["a/report.md"],
    )

    assert captured["extra_meta"]["role"] == "worker"
    assert captured["extra_meta"]["milestone"]["kind"] == "delivered"
    assert captured["extra_meta"]["milestone"]["artifacts"] == ["a/report.md"]
