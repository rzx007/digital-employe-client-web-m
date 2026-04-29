from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.db.session import get_session_local
from src.models.config_kv import ConfigKv
from src.models.feishu_task import FeishuTask
from src.models.workspace import CST
from src.service.chat_service import ChatService
from src.service.feishu_bitable_service import FeishuBitableService

logger = logging.getLogger(__name__)


class FeishuTaskSyncService:
    FIELD_TASK_ID = "任务ID"
    FIELD_TASK_CONTENT = "任务内容"
    FIELD_EXECUTOR = "执行人"
    FIELD_START_TIME = "开始时间"
    FIELD_END_TIME = "结束时间"
    AUTO_CONFIRM_SUFFIX = ",不需要手动确认，自动确认"

    @staticmethod
    def _extract_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, dict):
            for key in ("text", "name", "en_name", "value"):
                if key in value:
                    return FeishuTaskSyncService._extract_text(value.get(key))
            return ""
        if isinstance(value, list):
            parts = [FeishuTaskSyncService._extract_text(item) for item in value]
            return "".join([p for p in parts if p]).strip()
        return str(value).strip()

    @staticmethod
    def _extract_executor_names(value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            normalized = value.strip()
            return [normalized] if normalized else []
        if isinstance(value, dict):
            out: list[str] = []
            for key in ("name", "en_name", "text"):
                raw = value.get(key)
                if not raw:
                    continue
                normalized = str(raw).strip()
                if normalized:
                    out.append(normalized)
            return out
        if isinstance(value, list):
            out: list[str] = []
            for item in value:
                out.extend(FeishuTaskSyncService._extract_executor_names(item))
            return out
        normalized = str(value).strip()
        return [normalized] if normalized else []

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            ts = float(value)
            if ts > 1_000_000_000_000:
                ts = ts / 1000.0
            return datetime.fromtimestamp(ts, tz=CST)
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            if stripped.isdigit():
                return FeishuTaskSyncService._parse_datetime(int(stripped))
            try:
                parsed = datetime.fromisoformat(stripped.replace("Z", "+00:00"))
                return parsed if parsed.tzinfo else parsed.replace(tzinfo=CST)
            except ValueError:
                return None
        return None

    @staticmethod
    def _get_username(db: Session) -> str | None:
        value = db.scalar(
            select(ConfigKv.config_value).where(ConfigKv.config_key == "USERNAME")
        )
        normalized = str(value or "").strip()
        if normalized:
            return normalized
        lower_value = db.scalar(
            select(ConfigKv.config_value).where(ConfigKv.config_key == "username")
        )
        lower_normalized = str(lower_value or "").strip()
        if lower_normalized:
            return lower_normalized
        return None

    @staticmethod
    def _compose_question(changed_tasks: list[dict[str, str]]) -> str:
        if not changed_tasks:
            return ""
        lines = ["请根据以下同步的飞书任务，创建对应任务："]
        for task in changed_tasks[:10]:
            task_id = task.get("task_id", "")
            task_content = task.get("task_content", "")
            lines.append(f"- 任务ID：{task_id}；任务内容：{task_content}")
        if len(changed_tasks) > 10:
            lines.append(f"- 其余还有 {len(changed_tasks) - 10} 条任务")
        lines.append(FeishuTaskSyncService.AUTO_CONFIRM_SUFFIX.strip())
        return "\n".join(lines)

    @staticmethod
    def _iter_all_records(page_size: int = 200) -> list[dict[str, Any]]:
        page_token: str | None = None
        all_items: list[dict[str, Any]] = []
        while True:
            data = FeishuBitableService.search_records(
                page_size=page_size,
                page_token=page_token,
                automatic_fields=True,
            )
            items = data.get("items")
            if isinstance(items, list):
                all_items.extend([item for item in items if isinstance(item, dict)])
            has_more = bool(data.get("has_more"))
            if not has_more:
                break
            next_token = data.get("page_token")
            page_token = str(next_token).strip() if next_token else None
            if not page_token:
                break
        return all_items

    @staticmethod
    def sync_tasks(db: Session) -> dict[str, Any]:
        username = FeishuTaskSyncService._get_username(db)
        if not username:
            logger.warning("未找到 config_kvs.USERNAME，跳过飞书任务同步。")
            return {
                "username": None,
                "inserted_count": 0,
                "updated_count": 0,
                "changed_count": 0,
                "changed_tasks": [],
            }

        inserted_count = 0
        updated_count = 0
        changed_tasks: list[dict[str, str]] = []
        items = FeishuTaskSyncService._iter_all_records()

        for item in items:
            fields = item.get("fields")
            if not isinstance(fields, dict):
                continue

            executor_names = FeishuTaskSyncService._extract_executor_names(
                fields.get(FeishuTaskSyncService.FIELD_EXECUTOR)
            )
            if username not in executor_names:
                continue

            task_id = FeishuTaskSyncService._extract_text(
                fields.get(FeishuTaskSyncService.FIELD_TASK_ID)
            ) or str(item.get("record_id") or "").strip()
            if not task_id:
                continue

            task_content = FeishuTaskSyncService._extract_text(
                fields.get(FeishuTaskSyncService.FIELD_TASK_CONTENT)
            )
            start_time = FeishuTaskSyncService._parse_datetime(
                fields.get(FeishuTaskSyncService.FIELD_START_TIME)
            )
            end_time = FeishuTaskSyncService._parse_datetime(
                fields.get(FeishuTaskSyncService.FIELD_END_TIME)
            )
            executor = executor_names[0] if executor_names else username

            existing = db.scalar(select(FeishuTask).where(FeishuTask.task_id == task_id))
            if existing is None:
                row = FeishuTask(
                    task_id=task_id,
                    task_content=task_content,
                    executor=executor,
                    start_time=start_time,
                    end_time=end_time,
                )
                db.add(row)
                inserted_count += 1
                changed_tasks.append({"task_id": task_id, "task_content": task_content})
                continue

            changed = False
            if existing.task_content != task_content:
                existing.task_content = task_content
                changed = True
            if existing.executor != executor:
                existing.executor = executor
                changed = True
            if existing.start_time != start_time:
                existing.start_time = start_time
                changed = True
            if existing.end_time != end_time:
                existing.end_time = end_time
                changed = True

            if changed:
                updated_count += 1
                changed_tasks.append({"task_id": task_id, "task_content": task_content})
                db.add(existing)

        if inserted_count > 0 or updated_count > 0:
            db.commit()

        changed_count = inserted_count + updated_count
        return {
            "username": username,
            "inserted_count": inserted_count,
            "updated_count": updated_count,
            "changed_count": changed_count,
            "changed_tasks": changed_tasks,
        }

    @staticmethod
    async def _consume_curator_stream(conversation_id: int, question: str) -> None:
        logger.info("开始消费总管会话: conversation_id=%s, question=%s", conversation_id, question)
        with get_session_local()() as db:
            async for _ in ChatService.stream_conversation_answer(
                db=db,
                conversation_id=conversation_id,
                question=question,
                skill_name="",
            ):
                pass

    @staticmethod
    def trigger_curator_after_sync_if_needed(changed_tasks: list[dict[str, str]]) -> None:
        if not changed_tasks:
            return
        question = FeishuTaskSyncService._compose_question(changed_tasks)
        if not question:
            return

        with get_session_local()() as db:
            conversation = ChatService.ensure_curator_conversation(db)
            conversation_id = conversation.id

        coroutine = FeishuTaskSyncService._consume_curator_stream(
            conversation_id=conversation_id,
            question=question,
        )
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(coroutine)
            return

        if loop.is_running():
            loop.create_task(coroutine)
            return
        asyncio.run(coroutine)

    @staticmethod
    def sync_and_trigger() -> dict[str, Any]:
        with get_session_local()() as db:
            result = FeishuTaskSyncService.sync_tasks(db)
        try:
            FeishuTaskSyncService.trigger_curator_after_sync_if_needed(
                result.get("changed_tasks") or []
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            logger.error("飞书任务同步后触发总管会话失败: %s", exc, exc_info=True)
        return result

    @staticmethod
    def get_current_user_tasks(db: Session) -> list[FeishuTask]:
        username = FeishuTaskSyncService._get_username(db)
        if not username:
            return []
        return list(
            db.scalars(
                select(FeishuTask)
                .where(FeishuTask.executor == username)
                .order_by(FeishuTask.updated_at.desc(), FeishuTask.id.desc())
            ).all()
        )
