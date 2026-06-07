"""群成员执行会话二次对话应绑定 room 共享产物目录。"""

from __future__ import annotations

import tempfile
from pathlib import Path

from src.models.conversation import Conversation
from src.models.group_room import GroupRoom, GroupRoomMember
from src.service.resource_service import resolve_shared_artifacts_dir
from tests.conftest import add_employee


def _make_room_with_member(db_session, workspace):
    employee = add_employee(db_session, workspace.id, name="前端工程师")
    group_conv = Conversation(
        workspace_id=workspace.id, target_type="group", target_id=1, title="群"
    )
    db_session.add(group_conv)
    db_session.flush()
    leader_conv = Conversation(
        workspace_id=workspace.id,
        target_type="group_leader",
        target_id=group_conv.id,
        title="组长",
    )
    member_conv = Conversation(
        workspace_id=workspace.id,
        target_type="employee",
        target_id=employee.id,
        title="成员执行会话",
    )
    db_session.add_all([leader_conv, member_conv])
    db_session.flush()
    room = GroupRoom(
        workspace_id=workspace.id,
        room_conversation_id=group_conv.id,
        leader_conversation_id=leader_conv.id,
    )
    db_session.add(room)
    db_session.flush()
    member = GroupRoomMember(
        room_id=room.id,
        employee_id=employee.id,
        conversation_id=member_conv.id,
        role_in_room="member",
        state="ready",
    )
    db_session.add(member)
    db_session.commit()
    return room, member_conv


def test_resolve_shared_artifacts_dir_for_member_conversation(
    db_session, workspace
) -> None:
    room, member_conv = _make_room_with_member(db_session, workspace)
    root = tempfile.mkdtemp(prefix="de-test-artifacts-")

    shared = resolve_shared_artifacts_dir(db_session, root, member_conv.id)

    assert shared == str(Path(root) / f"room-{room.id}" / "artifacts")
    assert Path(shared).is_dir()


def test_resolve_shared_artifacts_dir_none_for_plain_conversation(
    db_session, workspace
) -> None:
    conv = Conversation(
        workspace_id=workspace.id,
        target_type="employee",
        target_id=1,
        title="普通会话",
    )
    db_session.add(conv)
    db_session.commit()

    root = tempfile.mkdtemp(prefix="de-test-artifacts-")
    assert resolve_shared_artifacts_dir(db_session, root, conv.id) is None


def test_member_shared_dir_contains_room_artifacts(db_session, workspace) -> None:
    """agent 绑定的 shared_artifacts_dir 应与资源面板扫描的 room 目录一致。"""
    room, member_conv = _make_room_with_member(db_session, workspace)
    root = tempfile.mkdtemp(prefix="de-test-artifacts-")

    room_artifacts = Path(root) / f"room-{room.id}" / "artifacts"
    demo_dir = room_artifacts / "pokemon-components"
    demo_dir.mkdir(parents=True, exist_ok=True)
    (demo_dir / "index.html").write_text("<html></html>", encoding="utf-8")

    shared = resolve_shared_artifacts_dir(db_session, root, member_conv.id)
    assert shared == str(room_artifacts)
    assert (Path(shared) / "pokemon-components" / "index.html").is_file()
