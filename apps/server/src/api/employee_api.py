from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.employee import EmployeeRead, EmployeeSyncResult, EmployeeUpdate
from src.service.employee_service import EmployeeService
from src.service.workspace_service import WorkspaceService

router = APIRouter(tags=["员工"])


@router.get("/workspaces/{workspace_id}/employees/sync", response_model=ResponseBase[EmployeeSyncResult])
def sync_workspace_employees(workspace_id: int, db: Session = Depends(get_db)) -> ResponseBase[EmployeeSyncResult]:
    """同步指定工作空间的员工数据。"""
    workspace = WorkspaceService.get_workspace(db, workspace_id)
    employees = EmployeeService.sync_workspace_employees(db, workspace)
    employee_items = [EmployeeService._employee_to_dict(emp) for emp in employees]
    payload = EmployeeSyncResult(
        workspace_id=workspace_id,
        synced_count=len(employee_items),
        employees=employee_items,
    )
    return ResponseBase(data=payload)


@router.get("/workspaces/{workspace_id}/employees", response_model=ListResponse[EmployeeRead])
def list_workspace_employees(workspace_id: int, db: Session = Depends(get_db)) -> ListResponse[EmployeeRead]:
    """查询指定工作空间下的员工列表。"""
    WorkspaceService.get_workspace(db, workspace_id)
    employees = EmployeeService.list_employees(db, workspace_id)
    return ListResponse(data=[EmployeeService._employee_to_dict(emp) for emp in employees])


@router.get("/employees/{employee_id}", response_model=ResponseBase[EmployeeRead])
def get_employee(employee_id: int, db: Session = Depends(get_db)) -> ResponseBase[EmployeeRead]:
    """根据员工ID查询员工详情。"""
    employee = EmployeeService.get_employee(db, employee_id)
    return ResponseBase(data=EmployeeService._employee_to_dict(employee))


@router.put("/employees/{employee_id}", response_model=ResponseBase[EmployeeRead])
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
) -> ResponseBase[EmployeeRead]:
    """更新指定员工的基础信息。"""
    employee = EmployeeService.update_employee(db, employee_id, payload.name, payload.description, payload.version)
    return ResponseBase(data=EmployeeService._employee_to_dict(employee))


@router.delete("/employees/{employee_id}", status_code=status.HTTP_200_OK, response_model=BaseResponse)
def delete_employee(employee_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """删除指定员工。"""
    EmployeeService.delete_employee(db, employee_id)
    return BaseResponse(data=None)


@router.get("/local_employees/skills", response_model=ResponseBase[list[dict]])
def get_local_employee_skills(employee_name: str) -> ResponseBase[list[dict]]:
    """获取本地员工的技能列表。

    Args:
        employee_name: 员工名称（对应 local-employees 目录下的文件夹名称）

    Returns:
        该员工的技能列表
    """
    skills = EmployeeService.get_local_employee_skills(employee_name)
    return ResponseBase(data=skills)

