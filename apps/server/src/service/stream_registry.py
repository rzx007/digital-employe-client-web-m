from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Callable

from sqlalchemy import select

from src.models.conversation import ConversationMessage

logger = logging.getLogger(__name__)

Subscriber = Callable[[dict], None]

FLUSH_INTERVAL_EVENTS = 20
FLUSH_INTERVAL_SECONDS = 2.0
TASK_TTL_SECONDS = 300


class StreamEventBuffer:
    def __init__(self, conversation_id: int):
        self.conversation_id = conversation_id
        self.events: list[dict] = []
        self._seq = 0

    def add(self, data: Any) -> dict:
        self._seq += 1
        event = {
            "seq": self._seq,
            "data": data,
        }
        self.events.append(event)
        return event

    def format_sse(self, event: dict) -> str:
        lines = [
            f"id: {self.conversation_id}:{event['seq']}",
            f"data: {json.dumps(event['data'], ensure_ascii=False, default=str)}",
        ]
        return "\n".join(lines) + "\n\n"

    def get_events_after(self, cursor: int) -> list[dict]:
        return [e for e in self.events if e["seq"] > cursor]

    @property
    def cursor(self) -> int:
        return self._seq


class ActiveStreamTask:
    def __init__(self, conversation_id: int):
        self.conversation_id = conversation_id
        self.status: str = "streaming"
        self.completed: bool = False
        self.buffer = StreamEventBuffer(conversation_id)
        self.subscribers: set[Subscriber] = set()
        self._asyncio_task: asyncio.Task | None = None
        self.error_message: str | None = None
        self._created_at: float = time.monotonic()

    def subscribe(self, fn: Subscriber) -> None:
        self.subscribers.add(fn)

    def unsubscribe(self, fn: Subscriber) -> None:
        self.subscribers.discard(fn)


class StreamRegistry:
    def __init__(self) -> None:
        self._tasks: dict[int, ActiveStreamTask] = {}

    def is_active(self, conversation_id: int) -> bool:
        task = self._tasks.get(conversation_id)
        return task is not None and not task.completed

    def get_task(self, conversation_id: int) -> ActiveStreamTask | None:
        return self._tasks.get(conversation_id)

    def get_buffer(self, conversation_id: int) -> StreamEventBuffer | None:
        task = self._tasks.get(conversation_id)
        return task.buffer if task else None

    def load_buffer_from_db(self, conversation_id: int, db: Any) -> StreamEventBuffer | None:
        """从数据库加载历史事件到 buffer，用于断线重连或重启恢复。"""
        from src.models.conversation import ConversationMessage
        from sqlalchemy import select

        stmt = (
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role == "assistant",
                ConversationMessage.stream_state == "streaming",
            )
            .order_by(ConversationMessage.id.desc())
            .limit(1)
        )
        msg = db.scalar(stmt)
        if not msg or not msg.stream_chunks:
            return None

        try:
            events = json.loads(msg.stream_chunks)
            if not isinstance(events, list):
                return None
            buffer = StreamEventBuffer(conversation_id)
            buffer.events = events
            if events:
                buffer._seq = events[-1].get("seq", 0)
            return buffer
        except json.JSONDecodeError:
            logger.warning("Failed to decode stream_chunks for msg %s", msg.id)
            return None

    def broadcast(self, conversation_id: int, event: dict) -> None:
        task = self._tasks.get(conversation_id)
        if not task:
            return
        for sub in list(task.subscribers):
            try:
                sub(event)
            except Exception:
                task.subscribers.discard(sub)

    def start(
        self,
        conversation_id: int,
        agent: Any,
        messages: list[dict],
        config: dict,
        stream_msg_id: int,
        skill_name: str,
        debug_content_only: bool,
    ) -> bool:
        existing = self._tasks.get(conversation_id)
        if existing and not existing.completed:
            logger.warning(
                "start refused: conversation %s already has active stream",
                conversation_id,
            )
            return False

        task = ActiveStreamTask(conversation_id)
        self._tasks[conversation_id] = task

        coro = self._run_agent_background(
            conversation_id=conversation_id,
            agent=agent,
            messages=messages,
            config=config,
            stream_msg_id=stream_msg_id,
            skill_name=skill_name,
            debug_content_only=debug_content_only,
            task=task,
        )
        task._asyncio_task = asyncio.create_task(coro)
        return True

    def cancel(self, conversation_id: int) -> bool:
        task = self._tasks.get(conversation_id)
        if not task or task.completed:
            return False

        task.status = "cancelled"
        task.completed = True

        if task._asyncio_task and not task._asyncio_task.done():
            task._asyncio_task.cancel()

        self.broadcast(conversation_id, {"type": "cancelled"})
        task.subscribers.clear()
        self._schedule_cleanup(conversation_id)
        return True

    def _schedule_cleanup(self, conversation_id: int) -> None:
        async def _cleanup() -> None:
            await asyncio.sleep(TASK_TTL_SECONDS)
            self._tasks.pop(conversation_id, None)

        asyncio.create_task(_cleanup())

    async def _run_agent_background(
        self,
        conversation_id: int,
        agent: Any,
        messages: list[dict],
        config: dict,
        stream_msg_id: int,
        skill_name: str,
        debug_content_only: bool,
        task: ActiveStreamTask,
    ) -> None:
        from src.db.session import get_session_local
        from src.service.chat_service import ChatService

        db = get_session_local()()

        collected_chunks: list[Any] = []
        assistant_text_parts: list[str] = []
        pending_tool_calls: dict[str, dict] = {}
        last_flush_time = time.monotonic()
        state_final = "completed"

        try:
            async for chunk in agent.astream(
                {"messages": messages},
                stream_mode=["messages", "updates"],
                config=config,
                version="v2",
            ):
                serializable = ChatService.convert_to_serializable(chunk)
                collected_chunks.append(serializable)
                text_part = ChatService._extract_text_from_chunk(serializable)
                if text_part:
                    assistant_text_parts.append(text_part)

                artifact_event = ChatService._try_extract_artifact(
                    chunk, conversation_id, pending_tool_calls,
                )
                if artifact_event:
                    evt = task.buffer.add(artifact_event)
                    self.broadcast(conversation_id, evt)

                if not debug_content_only:
                    evt = task.buffer.add(serializable)
                    self.broadcast(conversation_id, evt)

                now = time.monotonic()
                if (
                    task.buffer.cursor % FLUSH_INTERVAL_EVENTS == 0
                    or now - last_flush_time >= FLUSH_INTERVAL_SECONDS
                ):
                    self._flush_to_db(db, stream_msg_id, task.buffer)
                    last_flush_time = now

            final_text = "".join(assistant_text_parts).strip() or "模型已完成调用。"
            state_final = "completed"

            self._flush_to_db(
                db,
                stream_msg_id,
                task.buffer,
                state="completed",
                content=final_text,
                chunk_json=json.dumps(
                    collected_chunks, ensure_ascii=False, default=str,
                ),
            )

            evt = task.buffer.add({"status": "completed"})
            self.broadcast(conversation_id, evt)

        except asyncio.CancelledError:
            state_final = "cancelled"
            self._flush_to_db(
                db, stream_msg_id, task.buffer, state="cancelled",
            )
            raise

        except Exception as e:
            logger.error(
                "后台 agent 执行失败: conv=%s err=%s",
                conversation_id, e, exc_info=True,
            )
            state_final = "error"
            task.error_message = str(e)
            self._flush_to_db(
                db, stream_msg_id, task.buffer, state="error",
                error_message=str(e),
            )
            evt = task.buffer.add({"error": str(e)})
            self.broadcast(conversation_id, evt)

        finally:
            task.status = state_final
            task.completed = True
            task.subscribers.clear()
            db.close()
            self._schedule_cleanup(conversation_id)

    def _flush_to_db(
        self,
        db: Any,
        stream_msg_id: int,
        buffer: StreamEventBuffer,
        state: str | None = None,
        content: str | None = None,
        chunk_json: str | None = None,
        error_message: str | None = None,
    ) -> None:
        try:
            msg = db.get(ConversationMessage, stream_msg_id)
            if not msg:
                return
            if state is not None:
                msg.stream_state = state
            if content is not None:
                msg.content = content
            if chunk_json is not None:
                msg.chunk_json = chunk_json
            msg.stream_cursor = buffer.cursor
            msg.stream_chunks = json.dumps(
                buffer.events, ensure_ascii=False, default=str,
            )
            db.commit()
        except Exception:
            logger.warning("flush_to_db failed", exc_info=True)
            db.rollback()


registry = StreamRegistry()
