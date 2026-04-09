from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.chat_group import GroupCreate, GroupRead, GroupUpdate
from src.service.group_service import GroupService

router = APIRouter(tags=["群聊"])


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

