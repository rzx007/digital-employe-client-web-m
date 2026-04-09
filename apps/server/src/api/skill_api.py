from __future__ import annotations

from fastapi import APIRouter

from src.models.response import ResponseBase
from src.schemas.skill import SkillRead
from src.service.skill_service import SkillService

router = APIRouter(tags=["技能"])


@router.get("/skills/list", response_model=ResponseBase[list[SkillRead]])
def list_skills() -> ResponseBase[list[SkillRead]]:
    skills = SkillService.list_remote_skills()
    return ResponseBase(data=[SkillRead(**item) for item in skills])


@router.get("/skills/{skill_id}", response_model=ResponseBase[SkillRead])
def get_skill(skill_id: int) -> ResponseBase[SkillRead]:
    detail = SkillService.get_remote_skill(skill_id)
    return ResponseBase(data=SkillRead(**detail))
