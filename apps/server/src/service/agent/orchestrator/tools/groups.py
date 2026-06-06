"""总管"拉群协作"工具：建群 + 拉员工 + 把任务派进群（触发组长统筹）。

场景：用户跟总管说"拉个群干这件事"，总管 hire/选好员工后调本工具，
一步完成：创建群 → 建群会话(房间) → 把任务派进群。之后组长在群里统筹分解、
派活给成员、成员协作、组长汇总，最终汇总会回流到总管会话（见
group_room_service.summarize_by_leader → origin_curator_conversation_id）。
"""

from __future__ import annotations

import json

from langchain_core.tools import tool

from src.models.conversation import Conversation
from src.models.employee import Employee
from src.service.agent.orchestrator.runtime import (
    get_conversation_id,
    get_db,
    get_workspace_id,
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
    ids: list[int] = []
    raw = employee_ids
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            raw = [x.strip() for x in raw.replace("，", ",").split(",")]
    if isinstance(raw, list):
        for x in raw:
            try:
                ids.append(int(x))
            except (TypeError, ValueError):
                continue
    ids = list(dict.fromkeys(ids))  # 去重保序
    if len(ids) < 2:
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
