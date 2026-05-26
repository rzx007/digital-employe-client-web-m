from __future__ import annotations

import logging
import threading

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi import HTTPException, status

from src.core.config import get_settings, join_base_and_path
from src.core.remote_gateway import RemoteGateway
from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.models.skill_rating import SkillRating
from src.models.task_execution_log import TaskExecutionLog
from src.schemas.skill_rating import SkillRatingBatchCreate, SkillRatingRead

logger = logging.getLogger(__name__)


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
        token: str,
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

        existing_rating_id = db.scalar(
            select(SkillRating.id).where(
                SkillRating.task_execution_log_id == payload.task_execution_log_id
            ).limit(1)
        )
        if existing_rating_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该任务执行日志已存在评分记录。",
            )

        row = SkillRating(
            workspace_id=employee.workspace_id,
            employee_id=employee.id,
            conversation_id=None,
            message_id=None,
            task_execution_log_id=payload.task_execution_log_id,
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
            if not settings.skill_remote_rating:
                raise ValueError("未配置技能评分路径（SKILL_REMOTE_RATING）。")
            rating_url = join_base_and_path(
                settings.skill_remote_base_url,
                settings.skill_remote_rating.format(skill_id=skill_id),
            )
            if not rating_url:
                raise ValueError("未配置远程技能服务地址（REMOTE_API_BASE_URL）。")
            headers = {"token": f"{token}"}
            RemoteGateway.sync_post("skill_rating_upload", rating_url, headers=headers, json={"score": payload.score})
        except (httpx.HTTPError, ValueError) as exc:
            logger.error("评分同步远程失败 skill_id=%s: %s", skill_id, exc, exc_info=True)

        # 评分后触发改进建议（低分 + 有评论，后台线程避免阻塞 API 响应）
        try:
            from src.service.skill_improvement_service import trigger_improvement_review

            threading.Thread(
                target=trigger_improvement_review,
                args=(
                    skill_name,
                    employee.id,
                    payload.score,
                    payload.comment or "",
                    log.conversation_id,
                ),
                daemon=True,
            ).start()
        except Exception:
            logger.warning("skill improvement review trigger failed", exc_info=True)

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
