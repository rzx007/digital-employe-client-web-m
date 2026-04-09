from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi import HTTPException, status

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.employee_skill import EmployeeSkill
from src.models.skill_rating import SkillRating
from src.schemas.skill_rating import SkillRatingBatchCreate, SkillRatingRead
from src.service.skill_invocation_inference import (
    infer_skill_folder_names_from_chunk_json,
    infer_skill_folder_names_from_user_content,
)


class SkillRatingService:
    @staticmethod
    def _preceding_user_message(
        db: Session, conversation_id: int, assistant_message_id: int
    ) -> ConversationMessage | None:
        stmt = (
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.id < assistant_message_id,
                ConversationMessage.role == "user",
            )
            .order_by(ConversationMessage.id.desc())
            .limit(1)
        )
        return db.scalars(stmt).first()

    @staticmethod
    def _infer_invoked_skill_folder_names(
        db: Session, assistant_message: ConversationMessage
    ) -> set[str]:
        names = infer_skill_folder_names_from_chunk_json(assistant_message.chunk_json)
        user_msg = SkillRatingService._preceding_user_message(
            db, assistant_message.conversation_id, assistant_message.id
        )
        if user_msg and user_msg.content:
            names |= infer_skill_folder_names_from_user_content(user_msg.content)
        return names

    @staticmethod
    def _match_folder_names_to_employee_skills(
        db: Session, employee_id: int, folder_names: set[str]
    ) -> list[tuple[int, str]]:
        """将目录名（不区分大小写）映射为员工已绑定技能，保持首次匹配顺序。"""
        if not folder_names:
            return []
        rows = list(db.scalars(select(EmployeeSkill).where(EmployeeSkill.employee_id == employee_id)).all())
        result: list[tuple[int, str]] = []
        seen: set[int] = set()
        for folder in sorted(folder_names):
            folder_nf = folder.strip().casefold()
            if not folder_nf:
                continue
            for r in rows:
                if r.skill_name.strip().casefold() == folder_nf:
                    if r.skill_id not in seen:
                        seen.add(r.skill_id)
                        result.append((r.skill_id, r.skill_name))
                    break
        return result

    @staticmethod
    def _validate_context(
        db: Session,
        employee: Employee,
        conversation_id: int | None,
        message_id: int | None,
    ) -> tuple[int | None, int | None]:
        conv_id = conversation_id
        msg_id = message_id
        if message_id is not None:
            message = db.get(ConversationMessage, message_id)
            if not message:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到消息。")
            conv = db.get(Conversation, message.conversation_id)
            if not conv or conv.workspace_id != employee.workspace_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="消息不属于该员工所在工作空间。")
            if conv.target_type != "employee" or conv.target_id != employee.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="会话目标与员工不一致。")
            conv_id = message.conversation_id
            if conversation_id is not None and conversation_id != conv_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="message_id 所属会话与 conversation_id 不一致。",
                )
        elif conversation_id is not None:
            conv = db.get(Conversation, conversation_id)
            if not conv or conv.workspace_id != employee.workspace_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到会话。")
            if conv.target_type != "employee" or conv.target_id != employee.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="会话目标与员工不一致。")
        return conv_id, msg_id

    @staticmethod
    def create_batch(
        db: Session,
        employee_id: int,
        payload: SkillRatingBatchCreate,
    ) -> list[SkillRatingRead]:
        employee = db.get(Employee, employee_id)
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")

        seen: set[int] = set()
        unique_ids: list[int] = []
        for sid in payload.skill_ids:
            i = int(sid)
            if i in seen:
                continue
            seen.add(i)
            unique_ids.append(i)

        if not unique_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="skill_ids 不能为空。")

        conv_id, msg_id = SkillRatingService._validate_context(
            db, employee, payload.conversation_id, payload.message_id
        )

        id_to_name = SkillRatingService._resolve_skill_names(db, employee_id, unique_ids)
        missing = [i for i in unique_ids if i not in id_to_name]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"以下技能未绑定到该员工: {missing}",
            )

        created: list[SkillRating] = []
        for skill_id in unique_ids:
            row = SkillRating(
                workspace_id=employee.workspace_id,
                employee_id=employee.id,
                conversation_id=conv_id,
                message_id=msg_id,
                skill_id=skill_id,
                skill_name=id_to_name[skill_id],
                score=payload.score,
                comment=payload.comment,
            )
            db.add(row)
            created.append(row)
        db.commit()
        for row in created:
            db.refresh(row)
        return [SkillRatingRead.model_validate(r) for r in created]

    @staticmethod
    def list_for_employee(db: Session, employee_id: int, limit: int = 200) -> list[SkillRatingRead]:
        employee = db.get(Employee, employee_id)
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")
        stmt = (
            select(SkillRating)
            .where(SkillRating.employee_id == employee_id)
            .order_by(SkillRating.id.desc())
            .limit(min(max(limit, 1), 1000))
        )
        rows = list(db.scalars(stmt).all())
        return [SkillRatingRead.model_validate(r) for r in rows]
