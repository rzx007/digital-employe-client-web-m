from __future__ import annotations

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi import HTTPException, status

from src.core.config import get_settings
from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.models.skill_rating import SkillRating
from src.models.task_execution_log import TaskExecutionLog
from src.schemas.skill_rating import SkillRatingBatchCreate, SkillRatingRead


class SkillRatingService:
    @staticmethod
    def _resolve_skill_name(db: Session, employee_id: int, skill_id: int) -> str | None:
        row = db.scalar(
            select(EmployeeSkill).where(
                EmployeeSkill.employee_id == employee_id,
                EmployeeSkill.skill_id == skill_id,
            )
        )
        return row.skill_name if row else None

    @staticmethod
    def create_from_task_log(
        db: Session,
        payload: SkillRatingBatchCreate,
    ) -> SkillRatingRead:
        log = db.get(TaskExecutionLog, payload.task_execution_log_id)
        if not log:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"未找到任务执行日志 id={payload.task_execution_log_id}。",
            )
        if log.skill_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"任务执行日志 id={payload.task_execution_log_id} 未关联 skill_id。",
            )
        employee = db.get(Employee, log.employee_id)
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="任务执行日志关联的员工不存在。",
            )
        if log.workspace_id != employee.workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="任务执行日志与工作空间不一致。",
            )

        skill_id = int(log.skill_id)
        skill_name = SkillRatingService._resolve_skill_name(db, employee.id, skill_id)
        if skill_name is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"技能 skill_id={skill_id} 未绑定到该员工。",
            )

        row = SkillRating(
            workspace_id=employee.workspace_id,
            employee_id=employee.id,
            conversation_id=None,
            message_id=None,
            skill_id=skill_id,
            skill_name=skill_name,
            score=payload.score,
            comment=payload.comment,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        # 调用远程接口，将分数同步过去
        settings = get_settings()
        try:
            # 将skill_remote_rating路径中的{skillId}替换为skill_id

            rating_url = (
                settings.skill_remote_base_url
                + settings.skill_remote_rating.format(skill_id=skill_id)
            )
            httpx.post(rating_url, json={"score": payload.score})
        except (httpx.HTTPError, ValueError) as exc:
            print(f"评分同步失败: {exc}")

        return SkillRatingRead.model_validate(row)

    @staticmethod
    def list_for_employee(
        db: Session, employee_id: int, limit: int = 200
    ) -> list[SkillRatingRead]:
        employee = db.get(Employee, employee_id)
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。"
            )
        stmt = (
            select(SkillRating)
            .where(SkillRating.employee_id == employee_id)
            .order_by(SkillRating.id.desc())
            .limit(min(max(limit, 1), 1000))
        )
        rows = list(db.scalars(stmt).all())
        return [SkillRatingRead.model_validate(r) for r in rows]
