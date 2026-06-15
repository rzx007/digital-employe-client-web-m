from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from src.service.agent_interface_service import agent_interface_service
from src.service.employee_generation_service import EmployeeGenerationService
from src.core.request_utils import (
    get_user_id,
    get_user_id_from_token,
    get_workspace_id_from_request,
)
from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.employee import EmployeeCreate, EmployeeGenerationRequest, EmployeeGrowthBrainRead, EmployeeOut, EmployeeRead, EmployeeUpdate
from src.service.employee_service import EmployeeService
from src.service.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)

_RECRUIT_SKILL_RESPONSE_KEYS = (
    "id",
    "skillName",
    "displayNameZh",
    "description",
    "prompt",
    "directoryId",
    "directoryName",
    "status",
    "createTime",
    "updateTime",
)


def _skill_for_recruit_response(detail: dict) -> dict:
    """招聘候选人技能：仅元数据，不含 SKILL.md 全文及重复字段。"""
    return {key: detail[key] for key in _RECRUIT_SKILL_RESPONSE_KEYS if key in detail}


router = APIRouter(tags=["员工"])


@router.get("/workspaces/{workspace_id}/employees", response_model=ListResponse[EmployeeRead])
def list_workspace_employees(workspace_id: int, db: Session = Depends(get_db)) -> ListResponse[EmployeeRead]:
    """查询指定工作空间下的员工列表。"""
    WorkspaceService.get_workspace(db, workspace_id)
    employees = EmployeeService.list_employees(db, workspace_id)
    return ListResponse(
        data=[EmployeeService.employee_detail_dict(db, emp) for emp in employees],
    )


@router.get("/employees/{employee_id}", response_model=ResponseBase[EmployeeRead])
def get_employee(employee_id: int, db: Session = Depends(get_db)) -> ResponseBase[EmployeeRead]:
    """根据员工ID查询员工详情。"""
    employee = EmployeeService.get_employee(db, employee_id)
    return ResponseBase(data=EmployeeService.employee_detail_dict(db, employee))


@router.get(
    "/employees/{employee_id}/growth/brain",
    response_model=ResponseBase[EmployeeGrowthBrainRead],
)
def get_employee_growth_brain(
    employee_id: int, db: Session = Depends(get_db)
) -> ResponseBase[EmployeeGrowthBrainRead]:
    """只读：员工成长大脑(profile/技能/记忆/journal)。"""
    brain = EmployeeService.build_employee_growth_brain(db, employee_id)
    return ResponseBase[EmployeeGrowthBrainRead](data=EmployeeGrowthBrainRead(**brain))


# ---- 员工头像：自定义上传 + 读取 ----
_AVATAR_DIR = Path.home() / ".digital-employee" / "avatars"
_AVATAR_ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_AVATAR_MAX_BYTES = 5 * 1024 * 1024  # 5MB
_AVATAR_MEDIA = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


@router.post("/employees/{employee_id}/avatar", response_model=ResponseBase[EmployeeRead])
async def upload_employee_avatar(
    employee_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ResponseBase[EmployeeRead]:
    """上传/替换员工自定义头像（图片）。"""
    employee = EmployeeService.get_employee(db, employee_id)

    ext = Path(file.filename or "").suffix.lower()
    if ext not in _AVATAR_ALLOWED_EXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"头像仅支持 {', '.join(sorted(_AVATAR_ALLOWED_EXT))} 格式",
        )
    data = await file.read()
    if len(data) > _AVATAR_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="头像文件不能超过 5MB",
        )

    _AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    # 先删旧文件（可能是不同扩展名），再写新文件，文件名带 employee_id 唯一。
    for old in _AVATAR_DIR.glob(f"{employee_id}.*"):
        try:
            old.unlink()
        except OSError:
            pass
    dest = _AVATAR_DIR / f"{employee_id}{ext}"
    dest.write_bytes(data)

    employee.avatar_url = str(dest)
    db.commit()
    db.refresh(employee)
    return ResponseBase(data=EmployeeService.employee_detail_dict(db, employee))


@router.delete("/employees/{employee_id}/avatar", response_model=ResponseBase[EmployeeRead])
def delete_employee_avatar(
    employee_id: int, db: Session = Depends(get_db)
) -> ResponseBase[EmployeeRead]:
    """删除员工自定义头像，恢复为文字头像。"""
    employee = EmployeeService.get_employee(db, employee_id)
    for old in _AVATAR_DIR.glob(f"{employee_id}.*"):
        try:
            old.unlink()
        except OSError:
            pass
    employee.avatar_url = None
    db.commit()
    db.refresh(employee)
    return ResponseBase(data=EmployeeService.employee_detail_dict(db, employee))


@router.get("/employees/{employee_id}/avatar")
def get_employee_avatar(employee_id: int, db: Session = Depends(get_db)):
    """读取员工自定义头像文件。"""
    employee = EmployeeService.get_employee(db, employee_id)
    avatar_path = getattr(employee, "avatar_url", None)
    if not avatar_path or not Path(avatar_path).is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="该员工无自定义头像")
    ext = Path(avatar_path).suffix.lower()
    return FileResponse(
        avatar_path,
        media_type=_AVATAR_MEDIA.get(ext, "application/octet-stream"),
    )


@router.put(
    "/workspaces/{workspace_id}/employees/{employee_id}",
    response_model=ResponseBase[EmployeeRead],
)
def update_employee(
    workspace_id: int,
    employee_id: int,
    request: Request,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
) -> ResponseBase[EmployeeRead]:
    """更新指定员工的基础信息。"""
    token = request.headers.get("token")
    employee = EmployeeService.update_employee(db, employee_id, payload, token)
    return ResponseBase(data=EmployeeService.employee_detail_dict(db, employee))


@router.delete("/employees/{employee_id}", status_code=status.HTTP_200_OK, response_model=BaseResponse)
def delete_employee(employee_id: int, db: Session = Depends(get_db)) -> BaseResponse:
    """删除指定员工。"""
    EmployeeService.delete_employee(db, employee_id)
    return BaseResponse(data=None)


@router.post(
    "/workspaces/{workspace_id}/employees",
    summary="创建员工",
    response_model=ResponseBase,
)
def create_employee(
    workspace_id: int,
    request: Request,
    employee_in: EmployeeCreate,
    db: Session = Depends(get_db),
):
    token = request.headers.get("token")
    employee_in.workspace_id = workspace_id
    try:
        user_id = get_user_id(request)
    except Exception as e:
        logger.error("获取 user_id 失败: %s", e, exc_info=True)
        if token:
            user_id = get_user_id_from_token(token)
            if not user_id:
                user_id = "1"
        else:
            user_id = "1"

    employee_in.user_id = user_id
    logger.info("创建员工 user_id=%s workspace_id=%s", user_id, workspace_id)

    employee = EmployeeService.create_employee(db, employee_in, token)
    return ResponseBase(data=EmployeeService.employee_detail_dict(db, employee))


@router.post(
    "/generate-employees",
    summary="根据用户需求生成员工",
    response_model=ResponseBase[list[EmployeeOut]],
)
async def generate_employees(http_request: Request, request: EmployeeGenerationRequest):
    """
    根据用户需求异步生成员工信息
    """
    # 异步获取技能列表
    token = http_request.headers.get("token")
    workspace_id = get_workspace_id_from_request(http_request)
    skills = await EmployeeGenerationService.get_available_skills(
        token=token, workspace_id=workspace_id
    )
    logger.info(f"招聘接口可用技能数量: {len(skills)}")
    if not skills:
        # 返回错误响应
        return ResponseBase(code=500, msg="无法获取技能列表", data=None)

    # 异步生成多个员工档案
    _gen_started = time.perf_counter()
    employee_profiles = await EmployeeGenerationService.generate_employee_profiles_async(
        request.prompt, skills, request.count
    )
    logger.info(
        "generate_employee_profiles_async 处理耗时 %.3fs (count=%s)",
        time.perf_counter() - _gen_started,
        request.count,
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
        profile_skills_by_id = {
            int(item["id"]): item
            for item in (profile.get("skills") or [])
            if item.get("id") is not None
        }
        if skill_ids:
            for raw_id in skill_ids:
                skill_id_int = int(raw_id)
                detail = None
                if skill_id_int < 0:
                    detail = await agent_interface_service.get_skill_detail(
                        skill_id_int,
                        token=token,
                        workspace_id=workspace_id,
                        include_skill_content=False,
                    )
                if detail:
                    skills_detail.append(_skill_for_recruit_response(detail))
                elif skill_id_int in profile_skills_by_id:
                    skills_detail.append(
                        _skill_for_recruit_response(
                            profile_skills_by_id[skill_id_int]
                        )
                    )

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
