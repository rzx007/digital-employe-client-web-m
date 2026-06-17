from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.recent_contact import RecentContact
from src.models.workspace import CST, Workspace, cst_now
from src.schemas.recent_contact import (
    RecentContactImportItem,
    RecentContactRead,
)
from src.service.chat_service import ChatService
logger = logging.getLogger(__name__)

MAX_RECENT = 50


class RecentContactService:
    @staticmethod
    def _validate_target(db: Session, workspace_id: int, target_type: str, target_id: int) -> None:
        ChatService._validate_target(db, workspace_id, target_type, target_id)
        if target_type == "curator":
            employee = db.get(Employee, target_id)
            if not employee or not employee.is_curator:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="未找到总管联系人。",
                )

    @staticmethod
    def _target_exists(
        db: Session, workspace_id: int, target_type: str, target_id: int
    ) -> bool:
        try:
            RecentContactService._validate_target(
                db, workspace_id, target_type, target_id
            )
            return True
        except HTTPException:
            return False

    @staticmethod
    def _get_curator_employee(db: Session, workspace_id: int) -> Employee | None:
        # 总管已是 USER 级（每用户唯一，其 workspace_id 冻结到默认工作空间），
        # 因此按工作空间归属的 user_id 查，而不是直接按 workspace_id。
        ws = db.get(Workspace, workspace_id)
        owner = ws.user_id if ws is not None else None
        if owner is None:
            return None
        return db.scalar(
            select(Employee).where(
                Employee.user_id == owner,
                Employee.is_curator.is_(True),
            )
        )

    @staticmethod
    def _latest_conversation(
        db: Session, workspace_id: int, target_type: str, target_id: int
    ) -> Conversation | None:
        return db.scalars(
            select(Conversation)
            .where(
                Conversation.workspace_id == workspace_id,
                Conversation.target_type == target_type,
                Conversation.target_id == target_id,
            )
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            .limit(1)
        ).first()

    @staticmethod
    def _last_message_preview(
        db: Session, conversation_id: int
    ) -> tuple[str | None, datetime | None]:
        msg = db.scalars(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role.in_(("user", "assistant")),
            )
            .order_by(ConversationMessage.id.desc())
            .limit(1)
        ).first()
        if not msg or not msg.content:
            return None, None
        content = msg.content.strip()
        if len(content) > 120:
            content = content[:117] + "..."
        return content, msg.created_at

    @staticmethod
    def _resolve_display(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
    ) -> tuple[str, str, str | None, bool, bool]:
        if target_type == "curator":
            employee = db.get(Employee, target_id)
            if not employee:
                return str(target_id), "总管助手", None, False, True
            return (
                str(target_id),
                employee.name or "总管助手",
                None,
                False,
                True,
            )
        if target_type == "employee":
            employee = db.get(Employee, target_id)
            if not employee:
                return str(target_id), "未知", None, False, False
            meta: dict = {}
            try:
                meta = json.loads(employee.meta_json or "{}")
            except (json.JSONDecodeError, TypeError):
                pass
            emp_status = meta.get("status")
            status_str = (
                "online"
                if emp_status == 1
                else "offline"
                if emp_status is not None
                else None
            )
            return (
                str(target_id),
                employee.name or "未知",
                status_str,
                False,
                False,
            )
        # 群组功能已退场，fallback 为"未知"
        return str(target_id), "未知", None, True, False

    @staticmethod
    def _row_to_read(
        db: Session,
        workspace_id: int,
        row: RecentContact,
    ) -> RecentContactRead | None:
        if not RecentContactService._target_exists(
            db, workspace_id, row.target_type, row.target_id
        ):
            return None

        contact_id, contact_name, status_str, is_group, is_curator = (
            RecentContactService._resolve_display(
                db, workspace_id, row.target_type, row.target_id
            )
        )
        latest = RecentContactService._latest_conversation(
            db, workspace_id, row.target_type, row.target_id
        )
        last_message: str | None = None
        last_message_time: datetime | None = None
        title = "数字员工统筹" if is_curator else ""

        if latest:
            title = latest.title or title
            last_message, last_message_time = (
                RecentContactService._last_message_preview(db, latest.id)
            )

        return RecentContactRead(
            target_type=row.target_type,  # type: ignore[arg-type]
            target_id=row.target_id,
            contact_id=contact_id,
            contact_name=contact_name,
            title=title,
            last_message=last_message,
            last_message_time=last_message_time,
            unread_count=0,
            updated_at=row.last_accessed_at,
            is_group=is_group,
            is_curator=is_curator,
            is_pinned=row.is_pinned,
            latest_conversation_id=latest.id if latest else None,
            status=status_str,
        )

    @staticmethod
    def _enforce_max_recent(db: Session, workspace_id: int) -> None:
        rows = list(
            db.scalars(
                select(RecentContact)
                .where(RecentContact.workspace_id == workspace_id)
                .order_by(
                    RecentContact.is_pinned.desc(),
                    RecentContact.last_accessed_at.desc(),
                    RecentContact.id.desc(),
                )
            ).all()
        )
        if len(rows) <= MAX_RECENT:
            return
        to_remove = rows[MAX_RECENT:]
        for row in to_remove:
            db.delete(row)
        db.commit()

    @staticmethod
    def touch(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
    ) -> RecentContactRead:
        RecentContactService._validate_target(db, workspace_id, target_type, target_id)
        now = cst_now()
        row = db.scalar(
            select(RecentContact).where(
                RecentContact.workspace_id == workspace_id,
                RecentContact.target_type == target_type,
                RecentContact.target_id == target_id,
            )
        )
        if row:
            row.last_accessed_at = now
            row.updated_at = now
        else:
            row = RecentContact(
                workspace_id=workspace_id,
                target_type=target_type,
                target_id=target_id,
                last_accessed_at=now,
            )
            db.add(row)
        db.commit()
        db.refresh(row)
        RecentContactService._enforce_max_recent(db, workspace_id)
        read = RecentContactService._row_to_read(db, workspace_id, row)
        if not read:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="无法构建最近联系人。",
            )
        return read

    @staticmethod
    def set_pinned(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
        is_pinned: bool,
    ) -> RecentContactRead:
        row = db.scalar(
            select(RecentContact).where(
                RecentContact.workspace_id == workspace_id,
                RecentContact.target_type == target_type,
                RecentContact.target_id == target_id,
            )
        )
        if not row:
            return RecentContactService.touch(
                db, workspace_id, target_type, target_id
            )
        row.is_pinned = is_pinned
        row.updated_at = cst_now()
        db.commit()
        db.refresh(row)
        read = RecentContactService._row_to_read(db, workspace_id, row)
        if not read:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到最近联系人。",
            )
        return read

    @staticmethod
    def delete_by_target(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
    ) -> None:
        db.execute(
            delete(RecentContact).where(
                RecentContact.workspace_id == workspace_id,
                RecentContact.target_type == target_type,
                RecentContact.target_id == target_id,
            )
        )
        db.commit()

    @staticmethod
    def _cleanup_orphan_rows(db: Session, workspace_id: int) -> None:
        rows = list(
            db.scalars(
                select(RecentContact).where(
                    RecentContact.workspace_id == workspace_id
                )
            ).all()
        )
        removed = 0
        for row in rows:
            if not RecentContactService._target_exists(
                db, workspace_id, row.target_type, row.target_id
            ):
                db.delete(row)
                removed += 1
        if removed:
            db.commit()

    @staticmethod
    def list_recent_contacts(
        db: Session, workspace_id: int
    ) -> list[RecentContactRead]:
        RecentContactService._cleanup_orphan_rows(db, workspace_id)

        rows = list(
            db.scalars(
                select(RecentContact)
                .where(RecentContact.workspace_id == workspace_id)
                .order_by(
                    RecentContact.is_pinned.desc(),
                    RecentContact.last_accessed_at.desc(),
                    RecentContact.id.desc(),
                )
                .limit(MAX_RECENT)
            ).all()
        )

        curator = RecentContactService._get_curator_employee(db, workspace_id)
        if curator:
            has_curator = any(
                r.target_type == "curator" and r.target_id == curator.id
                for r in rows
            )
            if not has_curator:
                RecentContactService.touch(db, workspace_id, "curator", curator.id)
                rows = list(
                    db.scalars(
                        select(RecentContact)
                        .where(RecentContact.workspace_id == workspace_id)
                        .order_by(
                            RecentContact.is_pinned.desc(),
                            RecentContact.last_accessed_at.desc(),
                            RecentContact.id.desc(),
                        )
                        .limit(MAX_RECENT)
                    ).all()
                )

        items: list[RecentContactRead] = []
        for row in rows:
            read = RecentContactService._row_to_read(db, workspace_id, row)
            if read:
                items.append(read)

        curator_items = [i for i in items if i.is_curator]
        other_items = [i for i in items if not i.is_curator]
        return curator_items + other_items

    @staticmethod
    def import_items(
        db: Session,
        workspace_id: int,
        items: list[RecentContactImportItem],
    ) -> int:
        imported = 0
        for item in items:
            if not RecentContactService._target_exists(
                db, workspace_id, item.target_type, item.target_id
            ):
                continue
            row = db.scalar(
                select(RecentContact).where(
                    RecentContact.workspace_id == workspace_id,
                    RecentContact.target_type == item.target_type,
                    RecentContact.target_id == item.target_id,
                )
            )
            accessed = item.last_accessed_at or cst_now()
            if accessed.tzinfo is None:
                accessed = accessed.replace(tzinfo=CST)
            if row:
                row_accessed = row.last_accessed_at
                if row_accessed.tzinfo is None:
                    row_accessed = row_accessed.replace(tzinfo=CST)
                if accessed > row_accessed:
                    row.last_accessed_at = accessed
                if item.is_pinned:
                    row.is_pinned = True
            else:
                db.add(
                    RecentContact(
                        workspace_id=workspace_id,
                        target_type=item.target_type,
                        target_id=item.target_id,
                        is_pinned=item.is_pinned,
                        last_accessed_at=accessed,
                    )
                )
                imported += 1
        db.commit()
        RecentContactService._enforce_max_recent(db, workspace_id)
        return imported
