"""总管"拉群协作"工具：建群 + 拉员工 + 群聊增删改查。

场景：用户跟总管说"拉个群干这件事"，总管 hire/选好员工后调 create_group_and_dispatch，
一步完成：创建群 → 建群会话(房间) → 提示用户进群发任务。之后组长在群里统筹分解、
派活给成员、成员协作、组长汇总，最终汇总会回流到总管会话（见
group_room_service.summarize_by_leader → origin_curator_conversation_id）。

查/改/删群用 list_workspace_groups / get_group / update_group / delete_group。
"""

from __future__ import annotations

import json

from fastapi import HTTPException
from langchain_core.tools import tool
from sqlalchemy import select

from src.models.chat_group import ChatGroup
from src.models.conversation import Conversation
from src.models.employee import Employee
from src.service.agent.orchestrator.json_list_parse import parse_json_int_list
from src.service.agent.orchestrator.runtime import (
    get_conversation_id,
    get_db,
    get_workspace_id,
)


def _parse_employee_ids(raw: str | list) -> tuple[list[int] | None, str | None]:
    """解析 employee_ids 参数（JSON 数组、逗号分隔字符串或 list）。"""
    parsed_raw: str | list = raw
    if isinstance(raw, str):
        text = raw.strip()
        if text and not text.startswith("["):
            parsed_raw = [x.strip() for x in text.replace("，", ",").split(",") if x.strip()]
    ids, err = parse_json_int_list(parsed_raw, "employee_ids")
    if err:
        return None, err
    deduped = list(dict.fromkeys(ids or []))
    return deduped, None


def _ensure_workspace_group(
    db, group_id: int, workspace_id: int
) -> ChatGroup | str:
    group = db.get(ChatGroup, group_id)
    if not group:
        return f"错误：群聊 ID={group_id} 不存在。"
    if group.workspace_id != workspace_id:
        return f"错误：群聊 ID={group_id} 不属于当前工作空间。"
    return group


def _serialize_group(db, group: ChatGroup) -> dict:
    conv = db.scalars(
        select(Conversation)
        .where(
            Conversation.workspace_id == group.workspace_id,
            Conversation.target_type == "group",
            Conversation.target_id == group.id,
        )
        .order_by(Conversation.id.asc())
    ).first()
    members = list(group.members)
    return {
        "group_id": group.id,
        "name": group.name,
        "employee_ids": [m.id for m in members],
        "member_names": [m.name for m in members],
        "group_conversation_id": conv.id if conv else None,
        "created_at": group.created_at.isoformat() if group.created_at else None,
        "updated_at": group.updated_at.isoformat() if group.updated_at else None,
    }


def _sync_group_conversation_titles(db, group: ChatGroup) -> None:
    convs = db.scalars(
        select(Conversation).where(
            Conversation.workspace_id == group.workspace_id,
            Conversation.target_type == "group",
            Conversation.target_id == group.id,
        )
    ).all()
    for conv in convs:
        conv.title = group.name
    if convs:
        db.commit()


@tool
def list_workspace_groups() -> str:
    """查询当前工作空间下所有群聊（群 ID、名称、成员 ID/姓名、群会话 ID）。

    用户问「有哪些群」「列出群聊」时使用；改/删前先 list 或 get 确认 group_id。
    """
    db = get_db()
    workspace_id = get_workspace_id()
    from src.service.group_service import GroupService

    groups = GroupService.list_groups(db, workspace_id)
    items = [_serialize_group(db, g) for g in groups]
    return json.dumps(
        {
            "type": "group_list",
            "count": len(items),
            "groups": items,
        },
        ensure_ascii=False,
        indent=2,
    )


@tool
def get_group(group_id: int) -> str:
    """查询单个群聊详情（名称、成员、群会话 ID）。改/删前建议先调用确认。"""
    db = get_db()
    workspace_id = get_workspace_id()
    group_or_err = _ensure_workspace_group(db, group_id, workspace_id)
    if isinstance(group_or_err, str):
        return group_or_err
    return json.dumps(
        {"type": "group_detail", **_serialize_group(db, group_or_err)},
        ensure_ascii=False,
        indent=2,
    )


@tool
def update_group(
    group_id: int,
    name: str | None = None,
    employee_ids: str | list | None = None,
) -> str:
    """更新群聊名称和/或成员列表。

    至少提供 name 或 employee_ids 之一。employee_ids 为 JSON 数组或逗号分隔 ID，
    更新后成员仍至少 2 人。改成员前建议 list_workspace_employees 确认 ID。
    """
    if name is None and employee_ids is None:
        return "错误：请至少提供 name 或 employee_ids 之一。"

    db = get_db()
    workspace_id = get_workspace_id()
    group_or_err = _ensure_workspace_group(db, group_id, workspace_id)
    if isinstance(group_or_err, str):
        return group_or_err

    parsed_ids: list[int] | None = None
    if employee_ids is not None:
        parsed_ids, err = _parse_employee_ids(employee_ids)
        if err:
            return err
        if parsed_ids is not None and len(parsed_ids) < 2:
            return "错误：群聊至少需要 2 名成员。"

    from src.service.group_service import GroupService

    try:
        group = GroupService.update_group(
            db,
            group_id,
            name.strip() if isinstance(name, str) and name.strip() else name,
            parsed_ids,
        )
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, list):
            detail = "; ".join(str(d) for d in detail)
        return f"错误：更新群聊失败 — {detail}"

    if name is not None:
        _sync_group_conversation_titles(db, group)

    payload = _serialize_group(db, group)
    payload["type"] = "group_updated"
    payload["message"] = f"群聊「{group.name}」（ID={group.id}）已更新。"
    return json.dumps(payload, ensure_ascii=False, indent=2)


@tool
def delete_group(group_id: int) -> str:
    """删除群聊（不可逆）。删除前建议 get_group 确认名称与成员。"""
    db = get_db()
    workspace_id = get_workspace_id()
    group_or_err = _ensure_workspace_group(db, group_id, workspace_id)
    if isinstance(group_or_err, str):
        return group_or_err

    snapshot = _serialize_group(db, group_or_err)
    from src.service.group_service import GroupService

    try:
        GroupService.delete_group(db, group_id)
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, list):
            detail = "; ".join(str(d) for d in detail)
        return f"错误：删除群聊失败 — {detail}"

    return json.dumps(
        {
            "type": "group_deleted",
            "group_id": group_id,
            "name": snapshot["name"],
            "message": f"群聊「{snapshot['name']}」（ID={group_id}）已删除。",
        },
        ensure_ascii=False,
        indent=2,
    )


@tool
def create_group_and_dispatch(
    group_name: str,
    employee_ids: str | list,
    task: str = "",
) -> str:
    """拉一个多员工协作群（只建群拉人，**不自动派活**）。

    调用时机：用户要求"拉群协作"时。本工具只负责建群、把员工拉进去；**不会**把
    任务派进群。建群后告知用户「进群发送具体任务」，用户在群里发任务后，群组长
    才开始分解、派活、协作、汇总。这样保持「先建群、再发任务」的清晰节奏，避免
    拉群后组长在没有明确目标时空忙。
    建议先用 list_workspace_employees 确认成员，必要时先 hire_employee 招人。

    参数：
      group_name: 群名称（如"活动落地页协作群"）。
      employee_ids: 要拉进群的员工ID列表（JSON 数组或真数组，如 [3, 4, 19]），至少 2 个。
      task: （可选）任务描述。即使填了也**不会**自动派活，仅用于给用户的进群提示。

    返回：建群结果，并提示用户进群发送任务。
    """
    db = get_db()
    workspace_id = get_workspace_id()
    curator_conversation_id = get_conversation_id()

    # 解析 employee_ids
    ids, err = _parse_employee_ids(employee_ids)
    if err:
        return err
    if ids is None or len(ids) < 2:
        return "错误：拉群至少需要 2 名员工，请检查 employee_ids。"

    # 校验员工存在
    employees = list(
        db.query(Employee).filter(
            Employee.workspace_id == workspace_id, Employee.id.in_(ids)
        ).all()
    ) if hasattr(db, "query") else []
    if not employees:
        from sqlalchemy import select

        employees = list(
            db.scalars(
                select(Employee).where(
                    Employee.workspace_id == workspace_id, Employee.id.in_(ids)
                )
            ).all()
        )
    if len(employees) != len(ids):
        found = {e.id for e in employees}
        missing = [i for i in ids if i not in found]
        return f"错误：以下员工ID不存在：{missing}"

    # 1) 复用或新建群：成员集合相同的现存群直接复用，避免重复建群
    from src.service.group_service import GroupService
    from src.models.chat_group import ChatGroup
    from sqlalchemy import select as _select

    target_ids = set(ids)
    group = None
    for g in db.scalars(
        _select(ChatGroup).where(ChatGroup.workspace_id == workspace_id)
    ).all():
        if {m.id for m in g.members} == target_ids:
            group = g
            break
    if group is None:
        group = GroupService.create_group(db, workspace_id, group_name, ids)

    # 2) 复用或新建群会话（房间时间线）
    group_conv = db.scalars(
        _select(Conversation).where(
            Conversation.workspace_id == workspace_id,
            Conversation.target_type == "group",
            Conversation.target_id == group.id,
        ).order_by(Conversation.id.asc())
    ).first()
    if group_conv is None:
        group_conv = Conversation(
            workspace_id=workspace_id,
            target_type="group",
            target_id=group.id,
            title=group_name,
        )
        db.add(group_conv)
        db.commit()
        db.refresh(group_conv)

    # 3) 建房间并记录"发起的总管会话"，供汇总回流
    from src.service.group_room_service import GroupRoomService

    room = GroupRoomService.ensure_room(db, group_conv)
    room.origin_curator_conversation_id = curator_conversation_id
    db.commit()

    # 4) 只建群、不自动派活：拉群仅完成「建群拉人」，不把任务派进去。
    #    用户进群后发具体任务，组长才开始统筹。避免拉群后组长在没有明确目标时
    #    就自顾自地「互相认识、查看成员信息」等无意义动作。
    member_names = "、".join(e.name for e in employees)
    hint = ""
    if task and task.strip():
        # 总管带了任务也不自动派；提示用户进群发，保持「先建群、再发任务」的节奏
        hint = f"如需开始，请进群发送任务（例如：{task.strip()[:40]}…）。"
    return json.dumps({
        "type": "group_created",
        "group_id": group.id,
        "group_conversation_id": group_conv.id,
        "room_id": room.id,
        "members": member_names,
        "message": (
            f"已拉群「{group_name}」（成员：{member_names}）。"
            f"进群发送具体任务后，组长会分解并分配给成员协作完成。{hint}"
        ),
    }, ensure_ascii=False)
