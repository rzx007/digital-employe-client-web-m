from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
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
    AUTO_CONFIRM_SUFFIX = "不需要手动确认，自动确认"
    MAX_TASKS_IN_PROMPT = 10
    MAX_TASK_CONTENT_CHARS = 300
    MAX_QUESTION_CHARS = 8000

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
    def _compose_question(pending_tasks: list[dict[str, str]]) -> str:
        if not pending_tasks:
            return ""
        lines = ["请根据以下同步的飞书任务，创建对应任务："]
        for task in pending_tasks[: FeishuTaskSyncService.MAX_TASKS_IN_PROMPT]:
            task_id = task.get("task_id", "")
            task_content = task.get("task_content", "")
            if len(task_content) > FeishuTaskSyncService.MAX_TASK_CONTENT_CHARS:
                task_content = (
                    task_content[: FeishuTaskSyncService.MAX_TASK_CONTENT_CHARS] + "..."
                )
            lines.append(f"- 任务ID：{task_id}；任务内容：{task_content}")
        if len(pending_tasks) > FeishuTaskSyncService.MAX_TASKS_IN_PROMPT:
            lines.append(
                " - 其余还有 "
                f"{len(pending_tasks) - FeishuTaskSyncService.MAX_TASKS_IN_PROMPT} 条任务"
            )
        lines.append(FeishuTaskSyncService.AUTO_CONFIRM_SUFFIX.strip())
        question = "\n".join(lines).strip()
        if len(question) > FeishuTaskSyncService.MAX_QUESTION_CHARS:
            reserve = len(FeishuTaskSyncService.AUTO_CONFIRM_SUFFIX) + 20
            question = (
                question[: FeishuTaskSyncService.MAX_QUESTION_CHARS - reserve]
                + "\n(任务内容过长，已截断)\n"
                + FeishuTaskSyncService.AUTO_CONFIRM_SUFFIX
            )
        return question

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
                "pending_tasks": [],
                "pending_task_ids": [],
            }

        inserted_count = 0
        pending_tasks: list[dict[str, str]] = []
        pending_task_ids: list[str] = []
        seen_task_ids: set[str] = set()
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
            if task_id in seen_task_ids:
                continue
            seen_task_ids.add(task_id)

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
                pending_tasks.append({"task_id": task_id, "task_content": task_content})
                pending_task_ids.append(task_id)
                continue

            # 同一飞书任务ID已存在时，不再修改本地 feishu_tasks 字段
            if existing.is_schedule_created:
                continue
            pending_tasks.append(
                {"task_id": existing.task_id, "task_content": existing.task_content}
            )
            pending_task_ids.append(existing.task_id)

        if inserted_count > 0:
            db.commit()

        pending_count = len(pending_tasks)
        return {
            "username": username,
            "inserted_count": inserted_count,
            "updated_count": 0,
            "changed_count": inserted_count,
            "pending_count": pending_count,
            "pending_tasks": pending_tasks,
            "pending_task_ids": pending_task_ids,
        }

    @staticmethod
    async def _consume_curator_stream(conversation_id: int, question: str) -> bool:
        logger.info("开始消费总管会话: conversation_id=%s, question=%s", conversation_id, question)
        has_error = False
        got_done = False
        with get_session_local()() as db:
            async for chunk in ChatService.stream_conversation_answer(
                db=db,
                conversation_id=conversation_id,
                question=question,
                skill_name="",
            ):
                if not isinstance(chunk, str):
                    continue
                if "[DONE]" in chunk:
                    got_done = True
                if '"error"' in chunk or "stream_ended" in chunk and "error" in chunk:
                    has_error = True
        return got_done and not has_error

    @staticmethod
    def trigger_curator_after_sync_if_needed(pending_tasks: list[dict[str, str]]) -> bool:
        if not pending_tasks:
            return False
        question = FeishuTaskSyncService._compose_question(pending_tasks)
        if not question:
            return False

        with get_session_local()() as db:
            settings = get_settings()
            # 使用独立总管会话避免历史消息过长导致模型输入超限
            conversation = ChatService.create_conversation(
                db=db,
                workspace_id=settings.default_workspace_id,
                target_type="curator",
                target_id=1,
                title="飞书任务同步会话",
            )
            conversation_id = int(conversation.id)

        coroutine = FeishuTaskSyncService._consume_curator_stream(
            conversation_id=conversation_id,
            question=question,
        )
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coroutine)

        if loop.is_running():
            loop.create_task(coroutine)
            # 已在运行中的事件循环内无法同步等待结果，视为已触发但未确认成功
            return False
        return asyncio.run(coroutine)

    @staticmethod
    def _mark_tasks_scheduled(task_ids: list[str]) -> int:
        if not task_ids:
            return 0
        with get_session_local()() as db:
            rows = list(
                db.scalars(select(FeishuTask).where(FeishuTask.task_id.in_(task_ids))).all()
            )
            updated = 0
            for row in rows:
                if row.is_schedule_created:
                    continue
                row.is_schedule_created = True
                db.add(row)
                updated += 1
            if updated > 0:
                db.commit()
            return updated

    @staticmethod
    def sync_and_trigger() -> dict[str, Any]:
        with get_session_local()() as db:
            result = FeishuTaskSyncService.sync_tasks(db)
        pending_task_ids = result.get("pending_task_ids") or []
        # 只要本轮同步成功并识别到待处理任务，先标记为已创建排班，避免重复触发
        marked_count = FeishuTaskSyncService._mark_tasks_scheduled(pending_task_ids)
        trigger_ok = False
        try:
            trigger_ok = FeishuTaskSyncService.trigger_curator_after_sync_if_needed(
                result.get("pending_tasks") or []
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            logger.error("飞书任务同步后触发总管会话失败: %s", exc, exc_info=True)
        result["trigger_ok"] = trigger_ok
        result["marked_scheduled_count"] = marked_count
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
