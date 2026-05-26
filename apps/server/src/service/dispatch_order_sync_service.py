from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.db.session import get_session_local
from src.models.dispatch_order_sync import DispatchOrderSync
from src.models.workspace import cst_now
from src.service.chat_service import ChatService
from src.service.agent.orchestrator import run_coro_on_main_loop
from src.service.performance_balance_service import PerformanceBalanceService

logger = logging.getLogger(__name__)


class DispatchOrderSyncService:
    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return parsed
        except ValueError:
            return None

    @staticmethod
    def _normalize_remote_orders(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, list):
                return [item for item in data if isinstance(item, dict)]
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        return []

    @staticmethod
    def _build_curator_prompt(order: DispatchOrderSync, username: str) -> str:
        return (
            "请根据以下派单信息创建任务，并按系统规范分配执行。\n"
            f"任务名称：{order.order_name}\n"
            f"任务内容：{order.content}\n"
            f"开始时间：{order.start_time}\n"
            f"结束时间：{order.end_time}\n"
            "请避免重复创建同一远程派单ID的任务。自动确认任务。"
        )

    @staticmethod
    async def _consume_curator_stream(conversation_id: int, question: str) -> bool:
        with get_session_local()() as db:
            async for chunk in ChatService.stream_conversation_answer(
                db=db,
                conversation_id=conversation_id,
                question=question,
                skill_name="",
            ):
                if not isinstance(chunk, str):
                    continue
        return True

    @staticmethod
    async def _sync_once(db: Session) -> dict[str, int]:
        from src.core.remote_gateway import RemoteGateway
        RemoteGateway.ensure("dispatch_order_sync")
        
        now = cst_now()
        remote_payload = await PerformanceBalanceService.get_remote_dispatch_orders(db)
        remote_orders = DispatchOrderSyncService._normalize_remote_orders(remote_payload)
        username = PerformanceBalanceService.get_username_from_config(db)

        synced_count = 0
        inserted_count = 0
        updated_count = 0
        triggered_count = 0

        settings = get_settings()
        default_workspace_id = settings.default_workspace_id
        curator = ChatService.ensure_curator_conversation(db, default_workspace_id)
        conversation_id = int(curator.id)

        for item in remote_orders:
            remote_id_raw = item.get("id")
            try:
                remote_order_id = int(remote_id_raw)
            except (TypeError, ValueError):
                continue

            row = db.scalar(
                select(DispatchOrderSync).where(
                    DispatchOrderSync.remote_order_id == remote_order_id
                )
            )
            is_new = row is None
            if is_new:
                row = DispatchOrderSync(remote_order_id=remote_order_id)
                db.add(row)
                inserted_count += 1
            else:
                updated_count += 1

            row.order_name = str(item.get("order_name") or "")
            row.dispatcher = str(item.get("dispatcher") or "")
            row.receiver = str(item.get("receiver") or "")
            row.start_time = DispatchOrderSyncService._parse_datetime(item.get("start_time"))
            row.end_time = DispatchOrderSyncService._parse_datetime(item.get("end_time"))
            row.occur_time = DispatchOrderSyncService._parse_datetime(item.get("occur_time"))
            row.status = str(item.get("status") or "")
            raw_eval = item.get("eval")
            try:
                row.eval = None if raw_eval is None else float(raw_eval)
            except (TypeError, ValueError):
                row.eval = None
            row.content = str(item.get("content") or "")
            row.comment = (
                str(item.get("comment")).strip() if item.get("comment") is not None else None
            )
            row.last_synced_at = now

            if is_new:
                prompt = DispatchOrderSyncService._build_curator_prompt(row, username)
                ok = await DispatchOrderSyncService._consume_curator_stream(
                    conversation_id,
                    prompt,
                )
                row.last_triggered_at = cst_now()
                if ok:
                    row.trigger_status = "triggered"
                    row.trigger_error = None
                    triggered_count += 1
                else:
                    row.trigger_status = "failed"
                    row.trigger_error = "总管流式触发失败或未正常完成。"

            synced_count += 1

        db.commit()
        return {
            "synced_count": synced_count,
            "inserted_count": inserted_count,
            "updated_count": updated_count,
            "triggered_count": triggered_count,
        }

    @staticmethod
    def sync_and_trigger() -> dict[str, int]:
        with get_session_local()() as db:
            result = run_coro_on_main_loop(DispatchOrderSyncService._sync_once(db))
        logger.info(
            "dispatch order sync finished synced=%s inserted=%s updated=%s triggered=%s",
            result.get("synced_count"),
            result.get("inserted_count"),
            result.get("updated_count"),
            result.get("triggered_count"),
        )
        return result
