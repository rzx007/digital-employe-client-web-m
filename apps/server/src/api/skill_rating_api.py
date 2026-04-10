from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import ListResponse, ResponseBase
from src.schemas.skill_rating import SkillRatingBatchCreate, SkillRatingRead
from src.service.skill_rating_service import SkillRatingService

router = APIRouter(tags=["技能评分"])


@router.post(
    "/skill-ratings",
    response_model=ResponseBase[SkillRatingRead],
)
def create_skill_rating(
    payload: SkillRatingBatchCreate,
    db: Session = Depends(get_db),
) -> ResponseBase[SkillRatingRead]:
    """根据 task_execution_log_id 从日志表解析员工与 skill_id，写入一条评分。"""
    data = SkillRatingService.create_from_task_log(db, payload)
    return ResponseBase(data=data)


@router.get(
    "/employees/{employee_id}/skill-ratings",
    response_model=ListResponse[SkillRatingRead],
)
def list_employee_skill_ratings(
    employee_id: int,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> ListResponse[SkillRatingRead]:
    """查询某员工的技能评分记录（按 id 倒序）。"""
    data = SkillRatingService.list_for_employee(db, employee_id, limit=limit)
    return ListResponse(data=data)
