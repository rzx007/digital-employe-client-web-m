from __future__ import annotations
from typing import Any

from fastapi import APIRouter, File, Form, Query, Request, UploadFile, status

from src.core.request_utils import get_user_id
from src.models.response import ResponseBase
from src.schemas.skill import (
    LocalSkillDetail,
    LocalSkillImportResult,
    LocalSkillItem,
    SkillListItem,
    SkillNameExistsRequest,
    SkillNameExistsResult,
    SkillRead,
)
from src.service.local_skill_service import LocalSkillService
from src.service.skill_service import SkillService

router = APIRouter(tags=["技能"])


@router.get("/skills/list", response_model=ResponseBase[list[SkillListItem]])
def list_skills(request: Request) -> ResponseBase[list[SkillListItem]]:
    token = request.headers.get("token")
    remote_skills = SkillService.list_remote_skills(token)
    remote_data = []
    for item in remote_skills:
        mapped = SkillService.map_remote_to_list_item(item)
        mapped["source"] = "remote"
        mapped["sourceLabel"] = "远程"
        remote_data.append(SkillListItem(**mapped))

    local_skills = LocalSkillService.list_local_skills()
    local_data = []
    for index, item in enumerate(local_skills, start=1):
        local_id = item.get("localId")
        normalized_id = int(local_id) if isinstance(local_id, int) else -index
        local_data.append(
            SkillListItem(
                id=normalized_id,
                skillName=item.get("skillName") or "",
                displayNameZh=item.get("skillName") or "",
                description=item.get("description"),
                directoryId=None,
                directoryName="本地技能",
                source="local",
                sourceLabel="本地",
            )
        )

    data = remote_data + local_data
    return ResponseBase[list[SkillListItem]](data=data)


@router.get("/skills/{skill_id}", response_model=ResponseBase[SkillRead])
def get_skill(skill_id: int, request: Request) -> ResponseBase[SkillRead]:
    token = request.headers.get("token")
    detail = SkillService.get_remote_skill(skill_id, token)
    return ResponseBase[SkillRead](data=SkillRead(**detail))


@router.get("/skills/remote/directories", response_model=ResponseBase[Any])
async def get_skill_directories(
    request: Request,
    flat: bool = Query(default=True),
) -> ResponseBase[Any]:
    token = request.headers.get("token")
    data = await SkillService.get_remote_directories(flat=flat, token=token)
    return ResponseBase[Any](data=data)


async def _import_local_skill_impl(
    *,
    skill_name: str,
    file: UploadFile,
    overwrite: bool,
) -> ResponseBase[LocalSkillImportResult]:
    file_bytes = await file.read()
    imported = LocalSkillService.import_local_skill_zip(
        skill_name=skill_name,
        file_name=file.filename or f"{skill_name}.zip",
        file_bytes=file_bytes,
        overwrite=overwrite,
    )
    return ResponseBase[LocalSkillImportResult](data=LocalSkillImportResult(**imported))


@router.post(
    "/skills/local/import",
    response_model=ResponseBase[LocalSkillImportResult],
    status_code=status.HTTP_200_OK,
)
async def import_local_skill(
    skillName: str = Form(...),
    file: UploadFile = File(...),
    overwrite: bool = Form(default=False),
) -> ResponseBase[LocalSkillImportResult]:
    return await _import_local_skill_impl(
        skill_name=skillName,
        file=file,
        overwrite=overwrite,
    )


@router.post(
    "/skills/local/import-zip",
    response_model=ResponseBase[LocalSkillImportResult],
    status_code=status.HTTP_200_OK,
)
async def import_local_skill_zip(
    skillName: str = Form(...),
    file: UploadFile = File(...),
    overwrite: bool = Form(default=False),
) -> ResponseBase[LocalSkillImportResult]:
    return await _import_local_skill_impl(
        skill_name=skillName,
        file=file,
        overwrite=overwrite,
    )


@router.post(
    "/skills/local/name/exists",
    response_model=ResponseBase[SkillNameExistsResult],
)
def local_skill_name_exists(
    payload: SkillNameExistsRequest,
) -> ResponseBase[SkillNameExistsResult]:
    exists = LocalSkillService.local_skill_exists(payload.skillName)
    return ResponseBase[SkillNameExistsResult](
        data=SkillNameExistsResult(exists=exists)
    )


@router.get("/skills/local/list", response_model=ResponseBase[list[LocalSkillItem]])
def list_local_skills() -> ResponseBase[list[LocalSkillItem]]:
    data = [LocalSkillItem(**item) for item in LocalSkillService.list_local_skills()]
    return ResponseBase[list[LocalSkillItem]](data=data)


@router.get("/skills/local/{skill_name}", response_model=ResponseBase[LocalSkillDetail])
def get_local_skill_detail(skill_name: str) -> ResponseBase[LocalSkillDetail]:
    detail = LocalSkillService.get_local_skill_detail(skill_name)
    return ResponseBase[LocalSkillDetail](data=LocalSkillDetail(**detail))


@router.post("/skills/local/{skill_name}/remote-import", response_model=ResponseBase[Any])
async def remote_import_local_skill(
    skill_name: str,
    request: Request,
    directoryId: int = Form(...),
    displayNameZh: str | None = Form(default=None),
) -> ResponseBase[Any]:
    token = request.headers.get("token")
    exists = await SkillService.remote_skill_name_exists(skill_name, token)
    if exists:
        return ResponseBase[Any](code=0, msg=f"远程已存在同名技能: {skill_name}")
    file_name, file_bytes = LocalSkillService.build_local_skill_zip(skill_name)
    uploaded_by_user_id = get_user_id(request)
    payload = await SkillService.remote_import_skill(
        file_name=file_name,
        file_bytes=file_bytes,
        directory_id=directoryId,
        display_name_zh=displayNameZh,
        uploaded_by_user_id=uploaded_by_user_id,
        token=token,
    )
    return ResponseBase[Any](
        code=int(payload.get("code") or 1),
        msg=payload.get("msg") or "操作成功",
        data=payload.get("data"),
    )


@router.get("/local_employees/skills", response_model=ResponseBase[list[dict]])
def get_employee_local_skills(
    employee_id: str = Query(..., description="员工ID"),
    employee_name: str | None = Query(default=None, description="员工名称"),
    skill_name: str | None = Query(default=None, description="指定技能名称"),
) -> ResponseBase[list[dict]]:
    """
    获取指定员工的本地技能列表
    
    该接口用于工作台加载本地上传的技能，支持：
    1. 不传 skill_name：返回该员工所有本地技能
    2. 传入 skill_name：返回指定技能的详细信息
    """
    from pathlib import Path
    from src.core.config import get_settings
    
    settings = get_settings()
    local_root = Path(settings.local_skills_path)
    
    if not local_root.exists():
        return ResponseBase(data=[])
    
    skills = []
    for skill_dir in sorted(local_root.iterdir(), key=lambda p: p.name.lower()):
        if not skill_dir.is_dir():
            continue
        
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        
        # 读取 SKILL.md 内容
        skill_content = ""
        try:
            skill_content = skill_md.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to read SKILL.md for {skill_dir.name}: {e}")
        
        meta_file = skill_dir / ".skill-meta.json"
        meta = {}
        if meta_file.exists():
            try:
                import json
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        
        # 如果指定了 skill_name，只返回匹配的
        if skill_name and skill_dir.name != skill_name:
            continue
        
        skills.append({
            "id": meta.get("localId", 0),
            "skillName": skill_dir.name,
            "description": meta.get("description", ""),
            "prompt": "",
            "directoryId": None,
            "status": 1,
            "createTime": meta.get("importedAt", ""),
            "updateTime": meta.get("importedAt", ""),
            "directoryName": "本地技能",
            "skillContent": skill_content,  # 添加技能内容
            "skill_content": skill_content,  # 兼容两种字段名
        })
    
    return ResponseBase(data=skills)
