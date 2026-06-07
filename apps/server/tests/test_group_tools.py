"""总管群聊工具：list / get / update / delete。"""

from __future__ import annotations

import json

from src.models.conversation import Conversation
from src.service.agent.orchestrator.runtime import set_context
from src.service.agent.orchestrator.tools.groups import (
    delete_group,
    get_group,
    list_workspace_groups,
    update_group,
)
from src.service.group_service import GroupService
from tests.conftest import add_employee


def _setup_two_employees(db_session, workspace):
    a = add_employee(db_session, workspace.id, name="员工A")
    b = add_employee(db_session, workspace.id, name="员工B")
    return a, b


def test_list_workspace_groups_empty(db_session, workspace) -> None:
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)
    raw = list_workspace_groups.invoke({})
    data = json.loads(raw)
    assert data["type"] == "group_list"
    assert data["count"] == 0


def test_group_crud_flow(db_session, workspace) -> None:
    a, b = _setup_two_employees(db_session, workspace)
    group = GroupService.create_group(
        db_session, workspace.id, "测试群", [a.id, b.id]
    )
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="group",
        target_id=group.id,
        title="测试群",
    )
    db_session.add(conv)
    db_session.commit()

    set_context(db=db_session, workspace_id=workspace.id, conversation_id=1)

    listed = json.loads(list_workspace_groups.invoke({}))
    assert listed["count"] == 1
    assert listed["groups"][0]["group_id"] == group.id

    detail = json.loads(get_group.invoke({"group_id": group.id}))
    assert detail["type"] == "group_detail"
    assert detail["name"] == "测试群"
    assert detail["group_conversation_id"] == conv.id

    updated = json.loads(
        update_group.invoke({"group_id": group.id, "name": "新群名"})
    )
    assert updated["type"] == "group_updated"
    assert updated["name"] == "新群名"
    db_session.refresh(conv)
    assert conv.title == "新群名"

    deleted = json.loads(delete_group.invoke({"group_id": group.id}))
    assert deleted["type"] == "group_deleted"
    assert deleted["group_id"] == group.id

    empty = json.loads(list_workspace_groups.invoke({}))
    assert empty["count"] == 0


def test_get_group_wrong_workspace(db_session, workspace) -> None:
    a, b = _setup_two_employees(db_session, workspace)
    group = GroupService.create_group(
        db_session, workspace.id, "隔离群", [a.id, b.id]
    )
    set_context(db=db_session, workspace_id=999, conversation_id=1)
    result = get_group.invoke({"group_id": group.id})
    assert "不属于当前工作空间" in result
