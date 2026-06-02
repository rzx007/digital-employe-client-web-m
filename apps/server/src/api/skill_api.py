from __future__ import annotations
import logging
from typing import Any

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
    Depends,
)

from src.core.request_utils import (
    get_user_id,
    get_username,
    get_workspace_id_from_request,
)
from src.core.config import is_offline_mode
from src.core.runtime_capabilities import get_capabilities
from src.core.deps import require_capability
from sqlalchemy.orm import Session

from src.db.session import get_db, get_session_local
from src.models.response import ResponseBase
from src.schemas.skill import (
    LocalSkillDetail,
    LocalSkillImportResult,
    LocalSkillItem,
    SkillListItem,
    SkillNameExistsRequest,
    SkillNameExistsResult,
    SkillRead,
    UpdateSkillDisplayNameRequest,
    UpdateSkillDisplayNameResult,
    UpdateLocalSkillRequest,
    UpdateLocalSkillResult,
)
from src.service.employee_service import EmployeeService
from src.service.local_skill_service import LocalSkillService
from src.service.skill_service import SkillService
from src.service.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["技能"])


@router.get("/skills/list", response_model=ResponseBase[list[SkillListItem]])
def list_skills(
    request: Request,
    local_only: bool = Query(
        default=False,
        alias="localOnly",
        description="为 true 时仅返回本地与内置技能，不请求远程技能列表",
    ),
) -> ResponseBase[list[SkillListItem]]:
    workspace_id = get_workspace_id_from_request(request)
    local_skills = LocalSkillService.list_local_skills(workspace_id)
    local_data: list[SkillListItem] = []
    for index, item in enumerate(local_skills, start=1):
        local_id = item.get("localId")
        normalized_id = (
            int(local_id)
            if isinstance(local_id, int)
            else LocalSkillService.LOCAL_SKILL_ID_START - index + 1
        )
        is_builtin = bool(item.get("isBuiltin"))
        zh_raw = item.get("displayNameZh")
        display_zh = (
            zh_raw.strip()
            if isinstance(zh_raw, str) and zh_raw.strip()
            else None
        )
        local_data.append(
            SkillListItem(
                id=normalized_id,
                skillName=item.get("skillName") or "",
                displayNameZh=display_zh,
                description=item.get("description"),
                directoryId=None,
                directoryName="本地技能",
                tags=[],
                source="builtin" if is_builtin else "local",
                sourceLabel="内置" if is_builtin else "本地",
            )
        )

    # 离线或未启用远程平台时只返回本地/内置；SkillsMP 走独立 API，不在此阻塞。
    if (
        local_only
        or is_offline_mode()
        or not get_capabilities().remote_skills
    ):
        return ResponseBase[list[SkillListItem]](data=local_data)

    token = request.headers.get("token")
    remote_data: list[SkillListItem] = []
    remote_skills = SkillService.list_remote_skills(token, timeout=5.0)
    for item in remote_skills:
        mapped = SkillService.map_remote_to_list_item(item)
        mapped["source"] = "remote"
        mapped["sourceLabel"] = "远程"
        remote_data.append(SkillListItem(**mapped))

    return ResponseBase[list[SkillListItem]](data=remote_data + local_data)


@router.get("/skills/{skill_id}", response_model=ResponseBase[SkillRead], dependencies=[Depends(require_capability("remote_skills"))])
def get_skill(skill_id: int, request: Request) -> ResponseBase[SkillRead]:
    token = request.headers.get("token")
    detail = SkillService.get_remote_skill(skill_id, token)
    return ResponseBase[SkillRead](data=SkillRead(**detail))


@router.get("/skills/remote/directories", response_model=ResponseBase[Any], dependencies=[Depends(require_capability("remote_skills"))])
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
    workspace_id: int,
    display_name_zh: str | None = None,
) -> ResponseBase[LocalSkillImportResult]:
    file_bytes = await file.read()
    imported = LocalSkillService.import_local_skill_zip(
        skill_name=skill_name,
        file_name=file.filename or f"{skill_name}.zip",
        file_bytes=file_bytes,
        overwrite=overwrite,
        workspace_id=workspace_id,
        display_name_zh=display_name_zh,
    )
    return ResponseBase[LocalSkillImportResult](data=LocalSkillImportResult(**imported))


@router.post(
    "/skills/local/import",
    response_model=ResponseBase[LocalSkillImportResult],
    status_code=status.HTTP_200_OK,
)
async def import_local_skill(
    request: Request,
    skillName: str = Form(...),
    file: UploadFile = File(...),
    overwrite: bool = Form(default=False),
    displayNameZh: str | None = Form(default=None),
) -> ResponseBase[LocalSkillImportResult]:
    workspace_id = get_workspace_id_from_request(request)
    return await _import_local_skill_impl(
        skill_name=skillName,
        file=file,
        overwrite=overwrite,
        workspace_id=workspace_id,
        display_name_zh=displayNameZh,
    )


@router.post(
    "/skills/local/import-zip",
    response_model=ResponseBase[LocalSkillImportResult],
    status_code=status.HTTP_200_OK,
)
async def import_local_skill_zip(
    request: Request,
    skillName: str = Form(...),
    file: UploadFile = File(...),
    overwrite: bool = Form(default=False),
    displayNameZh: str | None = Form(default=None),
) -> ResponseBase[LocalSkillImportResult]:
    workspace_id = get_workspace_id_from_request(request)
    return await _import_local_skill_impl(
        skill_name=skillName,
        file=file,
        overwrite=overwrite,
        workspace_id=workspace_id,
        display_name_zh=displayNameZh,
    )


@router.post(
    "/skills/remote/{skill_id}/install",
    response_model=ResponseBase[LocalSkillImportResult],
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_capability("remote_skills"))]
)
async def install_remote_skill_to_local(
    skill_id: int,
    request: Request,
    overwrite: bool = Query(default=False),
) -> ResponseBase[LocalSkillImportResult]:
    token = request.headers.get("token")
    workspace_id = get_workspace_id_from_request(request)
    detail = SkillService.get_remote_skill(skill_id, token)
    if int(detail.get("status") or 0) != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"技能未启用，无法安装: skill_id={skill_id}",
        )
    raw_name = detail.get("skillName") or detail.get("skill_name")
    if not raw_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="远程技能详情缺少 skillName。",
        )
    normalized = LocalSkillService._normalize_skill_name(str(raw_name))
    file_map = EmployeeService._skill_content_to_file_map(detail.get("skillContent"))
    if not file_map:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="远程技能内容为空或格式无法解析，无法安装到本地（需要 skillContent 文件映射）。",
        )
    display_zh = detail.get("displayNameZh") or detail.get("display_name_zh")
    raw_desc = detail.get("description")
    imported = LocalSkillService.install_skill_from_file_map(
        skill_name=normalized,
        file_map=file_map,
        workspace_id=workspace_id,
        overwrite=overwrite,
        display_name_zh=display_zh if isinstance(display_zh, str) else None,
        description=raw_desc if isinstance(raw_desc, str) else None,
    )
    return ResponseBase[LocalSkillImportResult](
        data=LocalSkillImportResult(**imported)
    )


@router.post(
    "/skills/local/name/exists",
    response_model=ResponseBase[SkillNameExistsResult],
)
def local_skill_name_exists(
    request: Request,
    payload: SkillNameExistsRequest,
) -> ResponseBase[SkillNameExistsResult]:
    workspace_id = get_workspace_id_from_request(request)
    exists = LocalSkillService.local_skill_exists(payload.skillName, workspace_id)
    return ResponseBase[SkillNameExistsResult](
        data=SkillNameExistsResult(exists=exists)
    )


@router.get("/skills/local/list", response_model=ResponseBase[list[LocalSkillItem]])
def list_local_skills(request: Request) -> ResponseBase[list[LocalSkillItem]]:
    workspace_id = get_workspace_id_from_request(request)
    data = [
        LocalSkillItem(**item)
        for item in LocalSkillService.list_local_skills(workspace_id)
    ]
    return ResponseBase[list[LocalSkillItem]](data=data)


@router.get("/skills/local/{skill_name}", response_model=ResponseBase[LocalSkillDetail])
def get_local_skill_detail(
    request: Request, skill_name: str
) -> ResponseBase[LocalSkillDetail]:
    workspace_id = get_workspace_id_from_request(request)
    detail = LocalSkillService.get_local_skill_detail(skill_name, workspace_id)
    return ResponseBase[LocalSkillDetail](data=LocalSkillDetail(**detail))


@router.patch(
    "/skills/local/{skill_name}",
    response_model=ResponseBase[UpdateLocalSkillResult],
)
def update_local_skill(
    request: Request,
    skill_name: str,
    payload: UpdateLocalSkillRequest,
    db: Session = Depends(get_db),
) -> ResponseBase[UpdateLocalSkillResult]:
    workspace_id = get_workspace_id_from_request(request)
    updated = LocalSkillService.update_local_skill(
        skill_name,
        workspace_id,
        display_name_zh=payload.displayNameZh,
        skill_md_content=payload.skillMdContent,
    )
    synced_count = EmployeeService.sync_local_skill_to_assignees(
        db,
        workspace_id=workspace_id,
        skill_name=skill_name,
    )
    return ResponseBase[UpdateLocalSkillResult](
        data=UpdateLocalSkillResult(
            **updated,
            syncedEmployeeCount=synced_count,
        )
    )


@router.patch(
    "/skills/local/{skill_name}/display-name",
    response_model=ResponseBase[UpdateSkillDisplayNameResult],
)
def update_local_skill_display_name(
    request: Request,
    skill_name: str,
    payload: UpdateSkillDisplayNameRequest,
    db: Session = Depends(get_db),
) -> ResponseBase[UpdateSkillDisplayNameResult]:
    workspace_id = get_workspace_id_from_request(request)
    updated = LocalSkillService.update_display_name_zh(
        skill_name,
        payload.displayNameZh,
        workspace_id,
    )
    EmployeeService.sync_local_skill_to_assignees(
        db,
        workspace_id=workspace_id,
        skill_name=skill_name,
    )
    return ResponseBase[UpdateSkillDisplayNameResult](
        data=UpdateSkillDisplayNameResult(**updated)
    )


@router.delete("/skills/local/{skill_name}", response_model=ResponseBase[None])
def delete_workspace_local_skill(
    request: Request,
    skill_name: str,
    db: Session = Depends(get_db),
) -> ResponseBase[None]:
    workspace_id = get_workspace_id_from_request(request)
    normalized = LocalSkillService._normalize_skill_name(skill_name)
    local_id: int | None = None
    skill_dir = LocalSkillService._skill_dir(normalized, workspace_id)
    if skill_dir.is_dir():
        meta = LocalSkillService._read_meta(skill_dir)
        local_id = LocalSkillService._parse_local_id(meta.get("localId"))

    EmployeeService.unassign_local_skill_from_assignees(
        db,
        workspace_id=workspace_id,
        skill_name=skill_name,
        local_id=local_id,
    )
    LocalSkillService.delete_workspace_skill(skill_name, workspace_id)
    return ResponseBase[None](data=None)


@router.post("/skills/local/{skill_name}/remote-import", response_model=ResponseBase[Any], dependencies=[Depends(require_capability("remote_skills"))])
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
    workspace_id = get_workspace_id_from_request(request)
    file_name, file_bytes = LocalSkillService.build_local_skill_zip(skill_name, workspace_id)
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
    request: Request,
    employee_id: str = Query(..., description="员工ID"),
    employee_name: str | None = Query(default=None, description="员工名称"),
    skill_name: str | None = Query(default=None, description="指定技能名称"),
) -> ResponseBase[list[dict]]:
    """
    获取指定员工的本地技能列表（支持 workspace 隔离）

    该接口用于工作台加载本地上传的技能，支持：
    1. 不传 skill_name：返回该员工所有本地技能
    2. 传入 skill_name：返回指定技能的详细信息
    """
    from pathlib import Path
    from src.core.config import get_settings

    workspace_id = get_workspace_id_from_request(request)
    settings = get_settings()
    local_root = Path(settings.local_skills_path) / str(workspace_id)
    builtin_root = Path(settings.local_skills_path) / "builtin"

    skills = []

    def _load_skills_from_dir(root: Path):
        if not root.exists():
            return
        for skill_dir in sorted(root.iterdir(), key=lambda p: p.name.lower()):
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

            skills.append(
                {
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
                }
            )

    # 先加载 builtin 技能
    _load_skills_from_dir(builtin_root)

    # 再加载 workspace 自定义技能（同名会覆盖 builtin）
    _load_skills_from_dir(local_root)

    # 去重（如果 skill_name 未指定）
    if not skill_name:
        skill_map = {s["skillName"]: s for s in skills}
        skills = list(skill_map.values())

    return ResponseBase(data=skills)
