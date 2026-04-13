from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from src.service.agent_interface_service import agent_interface_service
from src.service.employee_generation_service import EmployeeGenerationService
from src.core.request_utils import get_user_id, get_user_id_from_token
from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.employee import EmployeeCreate, EmployeeGenerationRequest, EmployeeOut, EmployeeRead, EmployeeSyncResult, EmployeeUpdate
from src.service.employee_service import EmployeeService
from src.service.workspace_service import WorkspaceService
import logging
logger = logging.getLogger(__name__)

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
    return ResponseBase(data=EmployeeService.employee_detail_dict(db, employee))


@router.put("/employees/{employee_id}", response_model=ResponseBase[EmployeeRead])
def update_employee(
    employee_id: int,
    request: Request,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
) -> ResponseBase[EmployeeRead]:
    """更新指定员工的基础信息。"""
    token = request.headers.get("token")
    employee = EmployeeService.update_employee(db, employee_id, payload, token)
    return ResponseBase(data=EmployeeService._employee_to_dict(employee))


@router.delete("/employees/{employee_id}", status_code=status.HTTP_200_OK, response_model=BaseResponse)
def delete_employee(employee_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """删除指定员工。"""
    EmployeeService.delete_employee(db, employee_id)
    return BaseResponse(data=None)


@router.post("/employees/create", summary="创建员工", response_model=ResponseBase)
def create_employee(
    request: Request,
    employee_in: EmployeeCreate,
    db: Session = Depends(get_db),
):
    token = request.headers.get("token")
    try:
        # 获取用户ID
        user_id = get_user_id(request)
    except Exception as e:
        print(f"获取user_id失败: {e}")
        # 如果获取不到用户ID，尝试从token中提取
        
        if token:
            user_id = get_user_id_from_token(token)
            if not user_id:
                user_id = "1"  # 默认值为管理员
        else:
            user_id = "1"  # 默认值为管理员
    
    # 设置创建者ID
    employee_in.user_id = user_id
    print(f"设置user_id为: {user_id}")
    
    employee = EmployeeService.create_employee(db, employee_in, token)
    return ResponseBase(data=EmployeeService._employee_to_dict(employee))


@router.post(
    "/generate-employees",
    summary="根据用户需求生成员工",
    response_model=ResponseBase[list[EmployeeOut]],
)
async def generate_employees(request: EmployeeGenerationRequest):
    """
    根据用户需求异步生成员工信息
    """
    # 异步获取技能列表
    skills = await EmployeeGenerationService.get_available_skills()
    logger.info(f"招聘接口可用技能数量: {len(skills)}")
    if not skills:
        # 返回错误响应
        return ResponseBase(code=500, msg="无法获取技能列表", data=None)

    # 异步生成多个员工档案
    employee_profiles = await EmployeeGenerationService.generate_employee_profiles_async(
        request.prompt, skills, request.count
    )

    # 将生成的员工档案转换为可以用于创建员工的数据格式
    converted_profiles = (
        await EmployeeGenerationService.convert_employee_profiles_to_employee_create(
            employee_profiles, skills
        )
    )

    employee_infos = []
    for profile in converted_profiles:
        # 获取完整的技能详情
        skill_ids = profile.get('skill_ids', [])
       
        skills_detail = []
        if skill_ids:
            for skill_id in skill_ids:
                detail = await agent_interface_service.get_skill_detail(skill_id)
                if detail:
                    skills_detail.append(detail)

        # 使用EmployeeInfo创建对象，确保数据格式正确
        employee_info = EmployeeOut(
            id=0,  # 临时ID，实际创建时会被替换
            employee_name=profile['employee_name'],
            capability_desc=profile['capability_desc'],
            status=profile['status'],
            detail_page_url=profile.get('detail_page_url'),
            created_at="",  # 临时值
            updated_at="",  # 临时值
            skill_ids=skill_ids,
            skills=skills_detail,
            shift_schedule=profile.get('shift_schedule'),
            tasks=profile.get('tasks', []),
        )
        employee_infos.append(employee_info)

    logger.info(
        "招聘接口生成完成: "
        f"employees={len(employee_infos)}, "
        f"skill_ids={[employee.skill_ids for employee in employee_infos]}"
    )

    return ResponseBase(code=1, msg="操作成功", data=employee_infos)
