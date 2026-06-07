from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.chat_group import GroupCreate, GroupRead, GroupUpdate
from src.service.group_service import GroupService

router = APIRouter(tags=["群聊"])


class AutoConfirmUpdate(BaseModel):
    """群「自动确认成员任务」开关请求体。"""

    enabled: bool


@router.post("/workspaces/{workspace_id}/groups", response_model=ResponseBase[GroupRead], status_code=status.HTTP_201_CREATED)
def create_group(
    workspace_id: int,
    payload: GroupCreate,
    db: Session = Depends(get_db),
) -> ResponseBase[GroupRead]:
    """在指定工作空间创建群组并绑定员工。"""
    group = GroupService.create_group(db, workspace_id, payload.name, payload.employee_ids)
    return ResponseBase(data=GroupService._group_to_dict(group))


@router.get("/workspaces/{workspace_id}/groups", response_model=ListResponse[GroupRead])
def list_groups(workspace_id: int, db: Session = Depends(get_db)) -> ListResponse[GroupRead]:
    """查询指定工作空间的群组列表。"""
    groups = GroupService.list_groups(db, workspace_id)
    return ListResponse(data=[GroupService._group_to_dict(group) for group in groups])


@router.get("/groups/{group_id}", response_model=ResponseBase[GroupRead])
def get_group(group_id: int, db: Session = Depends(get_db)) -> ResponseBase[GroupRead]:
    """根据群组ID查询群组详情。"""
    group = GroupService.get_group(db, group_id)
    return ResponseBase(data=GroupService._group_to_dict(group))


@router.put("/groups/{group_id}", response_model=ResponseBase[GroupRead])
def update_group(group_id: int, payload: GroupUpdate, db: Session = Depends(get_db)) -> ResponseBase[GroupRead]:
    """更新群组名称或成员列表。"""
    group = GroupService.update_group(db, group_id, payload.name, payload.employee_ids)
    return ResponseBase(data=GroupService._group_to_dict(group))


@router.delete("/groups/{group_id}", status_code=status.HTTP_200_OK, response_model=BaseResponse)
def delete_group(group_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """删除指定群组。"""
    GroupService.delete_group(db, group_id)
    return BaseResponse(data=None)


@router.get("/chat/conversations/{conversation_id}/room", response_model=BaseResponse)
def get_group_room_state(conversation_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """获取群会话对应的协作房间状态（成员 + 角色/状态），用于渲染成员侧栏。"""
    from src.service.group_room_service import GroupRoomService

    state = GroupRoomService.get_room_state(db, conversation_id)
    if state is None:
        return BaseResponse(code=404, msg="该会话不是群会话或不存在", data=None)
    return BaseResponse(data=state)


@router.get("/chat/conversations/{conversation_id}/room/dag", response_model=BaseResponse)
def get_group_room_dag(conversation_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """获取群协作的 DAG 流程图（节点+边），用于渲染 SOP 面板。

    仅"组长统筹"模式有 DAG；纯 @ 直接派活返回 has_dag=False。
    """
    from src.service.group_room_service import GroupRoomService

    dag = GroupRoomService.get_room_dag(db, conversation_id)
    if dag is None:
        return BaseResponse(code=404, msg="该会话不是群会话或不存在", data=None)
    return BaseResponse(data=dag)


@router.patch(
    "/chat/conversations/{conversation_id}/room/auto-confirm",
    response_model=BaseResponse,
)
def set_group_room_auto_confirm(
    conversation_id: int,
    payload: AutoConfirmUpdate,
    db: Session = Depends(get_db),
) -> BaseResponse:
    """设置群「自动确认成员任务」开关。

    开启后，成员（@ 直接派活）的非澄清类审批（文档方案确认等）自动放行、群任务全
    自动跑通；组长的「澄清提问」不受影响，仍需用户作答。默认关。
    """
    from src.service.group_room_service import GroupRoomService

    state = GroupRoomService.set_auto_confirm(db, conversation_id, payload.enabled)
    if state is None:
        return BaseResponse(code=404, msg="该会话不是群会话或不存在", data=None)
    return BaseResponse(data=state)


@router.post("/chat/conversations/{conversation_id}/room/stop", response_model=BaseResponse)
def stop_group_room(conversation_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """停止群协作：取消组长流 + 所有成员执行流 + 停用未完成任务。供前端「停止」按钮调用。"""
    from src.service.group_room_service import GroupRoomService

    result = GroupRoomService.stop_room(db, conversation_id)
    return BaseResponse(data=result)


@router.get("/chat/conversations/{conversation_id}/room/artifact", response_model=BaseResponse)
def read_group_room_artifact(
    conversation_id: int,
    path: str,
    db: Session = Depends(get_db),
) -> BaseResponse:
    """读取群房间共享产物文件内容（弹窗预览用）。"""
    from src.service.group_room_service import GroupRoomService

    data = GroupRoomService.read_room_artifact(db, conversation_id, path)
    if data is None:
        return BaseResponse(code=404, msg="文件不存在或无权访问", data=None)
    return BaseResponse(data=data)

