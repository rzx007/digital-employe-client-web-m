from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.chat_group import ChatGroup
from src.models.employee import Employee
from src.models.workspace import Workspace


class GroupService:
    @staticmethod
    def _ensure_workspace(db: Session, workspace_id: int) -> Workspace:
        workspace = db.get(Workspace, workspace_id)
        if not workspace:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。")
        return workspace

    @staticmethod
    def _load_employees(db: Session, workspace_id: int, employee_ids: list[int]) -> list[Employee]:
        if not employee_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="员工ID列表不能为空。")
        employees = list(
            db.scalars(
                select(Employee).where(
                    Employee.workspace_id == workspace_id,
                    Employee.id.in_(employee_ids),
                )
            ).all()
        )
        if len(employees) != len(set(employee_ids)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="部分员工ID在当前工作空间中不存在。",
            )
        return employees

    @staticmethod
    def _group_to_dict(group: ChatGroup) -> dict:
        return {
            "id": group.id,
            "workspace_id": group.workspace_id,
            "name": group.name,
            "employee_ids": [member.id for member in group.members],
            "created_at": group.created_at,
            "updated_at": group.updated_at,
        }

    @staticmethod
    def create_group(
        db: Session,
        workspace_id: int,
        name: str,
        employee_ids: list[int],
    ) -> ChatGroup:
        GroupService._ensure_workspace(db, workspace_id)
        employees = GroupService._load_employees(db, workspace_id, employee_ids)
        group = ChatGroup(workspace_id=workspace_id, name=name)
        group.members = employees
        db.add(group)
        db.commit()
        db.refresh(group)
        return group

    @staticmethod
    def list_groups(db: Session, workspace_id: int) -> list[ChatGroup]:
        GroupService._ensure_workspace(db, workspace_id)
        return list(
            db.scalars(select(ChatGroup).where(ChatGroup.workspace_id == workspace_id).order_by(ChatGroup.id.desc())).all()
        )

    @staticmethod
    def get_group(db: Session, group_id: int) -> ChatGroup:
        group = db.get(ChatGroup, group_id)
        if not group:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到群聊。")
        return group

    @staticmethod
    def update_group(
        db: Session,
        group_id: int,
        name: str | None,
        employee_ids: list[int] | None,
    ) -> ChatGroup:
        group = GroupService.get_group(db, group_id)
        if name is not None:
            group.name = name
        if employee_ids is not None:
            employees = GroupService._load_employees(db, group.workspace_id, employee_ids)
            group.members = employees
        db.commit()
        db.refresh(group)
        return group

    @staticmethod
    def delete_group(db: Session, group_id: int) -> None:
        group = GroupService.get_group(db, group_id)
        workspace_id = group.workspace_id
        db.delete(group)
        db.commit()
        from src.service.recent_contact_service import RecentContactService

        RecentContactService.delete_by_target(db, workspace_id, "group", group_id)

