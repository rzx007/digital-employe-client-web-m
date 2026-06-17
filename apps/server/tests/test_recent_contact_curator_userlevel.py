"""总管最近联系人按 USER 级查找的回归测试。

总管现为用户级实体（每用户唯一），其 workspace_id 冻结到用户的默认工作空间。
在同一用户的**次级**工作空间里查最近联系人时，必须仍能找到总管——
这要求按 workspace 归属的 user_id 派生 owner，而不是直接按 workspace_id 过滤。
旧的 workspace-keyed 实现会在次级工作空间漏掉总管（本测试据此 fail-first）。
"""

from __future__ import annotations

import tempfile

from src.models.workspace import Workspace
from src.service.recent_contact_service import RecentContactService
from tests.conftest import add_employee


def _make_workspace(db, *, ws_id: int, owner: str) -> Workspace:
    root = tempfile.mkdtemp(prefix=f"de-test-ws{ws_id}-")
    ws = Workspace(id=ws_id, name=f"WS{ws_id}", root_path=root, user_id=owner)
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


def test_curator_found_in_secondary_workspace(db_session):
    """总管落在默认工作空间(id=1)，但在同主人的次级工作空间(id=2)仍能查到。"""
    owner = "u1"
    # 默认工作空间 + 次级工作空间，同一主人
    _make_workspace(db_session, ws_id=1, owner=owner)
    _make_workspace(db_session, ws_id=2, owner=owner)

    # 总管的 workspace_id 冻结到默认工作空间 1
    curator = add_employee(
        db_session,
        1,
        name="总管",
        is_curator=True,
        user_id=owner,
    )

    # 直接探针：在次级工作空间(id=2)解析总管，应按 owner 找到同一个总管
    found = RecentContactService._get_curator_employee(db_session, 2)
    assert found is not None, "次级工作空间应能按 user 级解析到总管（旧 workspace-keyed 实现会返回 None）"
    assert found.id == curator.id

    # 端到端：次级工作空间的最近联系人列表里应含总管
    items = RecentContactService.list_recent_contacts(db_session, 2)
    curator_items = [i for i in items if i.is_curator]
    assert curator_items, "次级工作空间最近联系人侧边栏应包含总管"
    assert curator_items[0].target_id == curator.id


def test_curator_not_found_for_other_owner(db_session):
    """异主人的工作空间不应解析到本用户的总管。"""
    _make_workspace(db_session, ws_id=1, owner="u1")
    _make_workspace(db_session, ws_id=2, owner="u2")
    add_employee(db_session, 1, name="总管", is_curator=True, user_id="u1")

    # 工作空间 2 属于 u2，没有总管
    assert RecentContactService._get_curator_employee(db_session, 2) is None
