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

    def get_stream_status(self, conversation_id: int, db: Any) -> dict | None:
        task = self._tasks.get(conversation_id)
        if task:
            if task.completed:
                return {
                    "status": task.status,
                    "error": task.error_message,
                }
            return None

        stmt = (
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role == "assistant",
                ConversationMessage.stream_state.isnot(None),
            )
            .order_by(ConversationMessage.id.desc())
            .limit(1)
        )
        msg = db.scalar(stmt)
        if not msg:
            return None

        if msg.stream_state == "streaming":
            return None

        return {
            "status": msg.stream_state,
            "error": None,
        }

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
        if not task:
            logger.warning("[cancel] conv=%s no active task in registry, cancel missed", conversation_id)
            return False
        if task.completed:
            logger.warning("[cancel] conv=%s task already completed (status=%s), cancel missed", conversation_id, task.status)
            return False

        task.status = "cancelled"
        # NOTE: Do NOT set task.completed or clear subscribers here.
        # The background task's CancelledError handler will flush DB first,
        # then add a buffer terminal event and broadcast it.
        # The finally block will then set task.completed and clean up subscribers.
        # This prevents:
        #  (1) resume hang: broadcast must use buffer format so
        #      _emit_event_payloads can detect terminal status correctly
        #  (2) race: task.completed must only be set after DB flush so
        #      resume+message fetch always sees chunk_json

        if task._asyncio_task and not task._asyncio_task.done():
            task._asyncio_task.cancel()
            logger.info("[cancel] conv=%s task.cancel() called, asyncio_task will raise CancelledError", conversation_id)
        else:
            logger.warning("[cancel] conv=%s asyncio_task already done before cancel()", conversation_id)

        return True

    def _schedule_cleanup(self, conversation_id: int) -> None:
        async def _cleanup() -> None:
            await asyncio.sleep(TASK_TTL_SECONDS)
            self._tasks.pop(conversation_id, None)

        asyncio.create_task(_cleanup())

    @staticmethod
    def _safe_serialize_chunks(chunks: list[Any]) -> str | None:
        try:
            result = json.dumps(chunks, ensure_ascii=False, default=str)
            logger.debug("[serialize] chunks=%d items, json_len=%d", len(chunks), len(result))
            return result
        except Exception:
            logger.warning("[serialize] FAILED chunks=%d items", len(chunks), exc_info=True)
            return None

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
        last_flush_time = time.monotonic()
        state_final = "completed"

        try:
            async for chunk in agent.astream(
                {"messages": messages},
                stream_mode=["messages", "updates", "custom"],
                config=config,
                version="v2",
            ):
                serializable = ChatService.convert_to_serializable(chunk)
                collected_chunks.append(serializable)

                if (
                    isinstance(serializable, dict)
                    and serializable.get("type") == "custom"
                ):
                    custom_data = serializable.get("data")
                    if (
                        isinstance(custom_data, dict)
                        and custom_data.get("type") == "tool_output"
                    ):
                        evt = task.buffer.add(custom_data)
                        self.broadcast(conversation_id, evt)
                    continue

                text_part = ChatService._extract_text_from_chunk(serializable)
                if text_part:
                    assistant_text_parts.append(text_part)

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

            logger.info(
                "[run] conv=%s stream completed normally, chunks=%d, text_len=%d",
                conversation_id, len(collected_chunks), len(final_text),
            )
            self._flush_to_db(
                db, stream_msg_id, task.buffer, state="completed",
                content=final_text,
                chunk_json=self._safe_serialize_chunks(collected_chunks),
            )

            evt = task.buffer.add({"status": "completed"})
            logger.info(
                "[run] conv=%s broadcasting completed event: seq=%d, subscribers=%d",
                conversation_id, evt["seq"], len(task.subscribers),
            )
            self.broadcast(conversation_id, evt)

        except asyncio.CancelledError:
            state_final = "cancelled"
            partial_text = "".join(assistant_text_parts).strip() or None
            logger.info(
                "[run] conv=%s CancelledError caught, chunks=%d, text_len=%s, task.status=%s",
                conversation_id, len(collected_chunks),
                len(partial_text) if partial_text else "None",
                task.status,
            )
            self._flush_to_db(
                db, stream_msg_id, task.buffer, state="cancelled",
                content=partial_text,
                chunk_json=self._safe_serialize_chunks(collected_chunks),
            )
            # Add terminal event to buffer after DB flush, then broadcast
            # so resume subscribers receive it in recognisable buffer format
            evt = task.buffer.add({"status": "cancelled"})
            logger.info(
                "[run] conv=%s broadcasting cancelled event: seq=%d, subscribers=%d",
                conversation_id, evt["seq"], len(task.subscribers),
            )
            self.broadcast(conversation_id, evt)
            raise

        except Exception as e:
            logger.error(
                "[run] conv=%s agent FAILED: %s, chunks=%d, text_len=%s",
                conversation_id, e, len(collected_chunks),
                len("".join(assistant_text_parts)) if assistant_text_parts else "0",
                exc_info=True,
            )
            state_final = "error"
            task.error_message = str(e)
            partial_text = "".join(assistant_text_parts).strip() or None
            self._flush_to_db(
                db, stream_msg_id, task.buffer, state="error",
                content=partial_text,
                chunk_json=self._safe_serialize_chunks(collected_chunks),
                error_message=str(e),
            )
            evt = task.buffer.add({"status": "error", "error": str(e)})
            self.broadcast(conversation_id, evt)

        finally:
            if task.status == "cancelled" and state_final != "cancelled":
                logger.warning(
                    "[run] conv=%s finally: task.status=cancelled but state_final=%s, doing fallback flush",
                    conversation_id, state_final,
                )
                state_final = "cancelled"
                partial_text = "".join(assistant_text_parts).strip() or None
                self._flush_to_db(
                    db, stream_msg_id, task.buffer, state="cancelled",
                    content=partial_text,
                    chunk_json=self._safe_serialize_chunks(collected_chunks),
                )
            logger.info(
                "[run] conv=%s finally: state_final=%s, chunks=%d, buffer_cursor=%d",
                conversation_id, state_final, len(collected_chunks), task.buffer.cursor,
            )
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
                logger.warning("[flush] msg_id=%s not found in DB, skip", stream_msg_id)
                return
            if state is not None:
                msg.stream_state = state
            if content is not None:
                msg.content = content
            if error_message is not None:
                try:
                    meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
                except (json.JSONDecodeError, TypeError):
                    meta = {}
                meta["error_message"] = error_message
                msg.extra_meta = json.dumps(meta, ensure_ascii=False)
            # stream_cursor tracks how many events have been flushed;
            # resume uses in-memory buffer, not DB stream_chunks, so we
            # skip intermediate event serialization to avoid O(n²) overhead.
            msg.stream_cursor = buffer.cursor
            msg.stream_chunks = None
            if chunk_json is not None:
                try:
                    msg.chunk_json = chunk_json
                except Exception:
                    logger.warning("[flush] msg_id=%s set chunk_json failed", stream_msg_id, exc_info=True)
            else:
                logger.info("[flush] msg_id=%s chunk_json=None, state=%s, buffer_cursor=%d", stream_msg_id, state, buffer.cursor)
            db.commit()
            logger.info(
                "[flush] msg_id=%s committed: state=%s, content_len=%s, chunk_json_len=%s, stream_chunks=%s",
                stream_msg_id, state,
                len(content) if content else None,
                len(chunk_json) if chunk_json else None,
                "cleared" if state in ("completed", "error", "cancelled") else f"{buffer.cursor} events",
            )
        except Exception:
            logger.warning("[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True)
            db.rollback()


registry = StreamRegistry()
