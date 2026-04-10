from __future__ import annotations
from fastapi import APIRouter, Request

from src.models.response import ResponseBase
from src.schemas.skill import SkillListItem, SkillRead
from src.service.skill_service import SkillService

router = APIRouter(tags=["技能"])


@router.get("/skills/list", response_model=ResponseBase[list[SkillListItem]])
def list_skills(request: Request) -> ResponseBase[list[SkillListItem]]:
    token = request.headers.get("token")
    skills = SkillService.list_remote_skills(token)
    data = [
        SkillListItem(**SkillService.map_remote_to_list_item(item)) for item in skills
    ]
    return ResponseBase[list[SkillListItem]](data=data)


@router.get("/skills/{skill_id}", response_model=ResponseBase[SkillRead])
def get_skill(skill_id: int, request: Request) -> ResponseBase[SkillRead]:
    token = request.headers.get("token")
    detail = SkillService.get_remote_skill(skill_id, token)
    return ResponseBase[SkillRead](data=SkillRead(**detail))
