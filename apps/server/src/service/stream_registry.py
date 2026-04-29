from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from typing import Any, Callable

from sqlalchemy import select

from src.models.conversation import ConversationMessage

logger = logging.getLogger(__name__)

Subscriber = Callable[[dict], None]

FLUSH_INTERVAL_EVENTS = 20
FLUSH_INTERVAL_SECONDS = 2.0
HEARTBEAT_INTERVAL_SECONDS = 30.0
TASK_TTL_SECONDS = 300
BUFFER_MAXLEN = 5000
AGENT_CHUNK_TIMEOUT = 120.0


class ChunkJsonBuilder:
    """Incrementally builds JSON array of events without O(N²) serialization.

    Each event is stored as ``{"seq": N, "data": ...}`` (stream_json format)
    and the raw ``data`` is separately accumulated for chunk_json format.
    """

    def __init__(self) -> None:
        self._data_parts: list[str] = []   # raw data items → chunk_json("[
        self._event_parts: list[str] = []  # {seq, data} items → stream_json
        self._count: int = 0

    def add(self, event: dict) -> bool:
        """Add a buffer event ``{seq, data}``.  Returns False if serialization failed."""
        try:
            data_json = json.dumps(event["data"], ensure_ascii=False, default=str)
            event_json = json.dumps(event, ensure_ascii=False, default=str)
        except Exception:
            logger.warning("[builder] seq=%s serialization failed, skipping", event.get("seq"))
            return False
        if self._count > 0:
            self._data_parts.append(",")
            self._event_parts.append(",")
        self._data_parts.append(data_json)
        self._event_parts.append(event_json)
        self._count += 1
        return True

    def to_chunk_json(self) -> str:
        """``[data1, data2, ...]`` — frontend-compatible chunk_json format."""
        return "[" + "".join(self._data_parts) + "]"

    def to_stream_json(self) -> str:
        """``[{"seq":N,"data":...}, ...]`` — cold-path replay format."""
        return "[" + "".join(self._event_parts) + "]"

    @property
    def count(self) -> int:
        return self._count


class StreamEventBuffer:
    def __init__(self, conversation_id: int, maxlen: int = BUFFER_MAXLEN):
        self.conversation_id = conversation_id
        self._events: deque[dict] = deque()
        self._seq = 0
        self._maxlen = maxlen
        self._base_cursor: int = 0

    def add(self, data: Any) -> dict:
        self._seq += 1
        event = {"seq": self._seq, "data": data}
        self._events.append(event)
        return event

    def trim(self) -> int:
        """Drop oldest events when beyond maxlen.  Returns trimmed count."""
        trimmed = 0
        while len(self._events) > self._maxlen:
            removed = self._events.popleft()
            self._base_cursor = removed["seq"]
            trimmed += 1
        return trimmed

    def get_events_after(self, cursor: int) -> list[dict]:
        return [e for e in self._events if e["seq"] > cursor]

    @property
    def base_cursor(self) -> int:
        """Highest seq that has been trimmed from the buffer (0 if none)."""
        return self._base_cursor

    @property
    def cursor(self) -> int:
        return self._seq

    @property
    def events(self) -> list[dict]:
        """Legacy accessor (for logging / flush)."""
        return list(self._events)


class ActiveStreamTask:
    def __init__(self, conversation_id: int):
        self.conversation_id = conversation_id
        self.status: str = "streaming"
        self.buffer = StreamEventBuffer(conversation_id)
        self.subscribers: set[Subscriber] = set()
        self._asyncio_task: asyncio.Task | None = None
        self.error_message: str | None = None
        self._created_at: float = time.monotonic()

    @property
    def is_active(self) -> bool:
        return self.status == "streaming"

    def subscribe(self, fn: Subscriber) -> None:
        self.subscribers.add(fn)

    def unsubscribe(self, fn: Subscriber) -> None:
        self.subscribers.discard(fn)


class StreamRegistry:
    def __init__(self) -> None:
        self._tasks: dict[int, ActiveStreamTask] = {}

    def is_active(self, conversation_id: int) -> bool:
        task = self._tasks.get(conversation_id)
        return task is not None and task.is_active

    def get_task(self, conversation_id: int) -> ActiveStreamTask | None:
        return self._tasks.get(conversation_id)

    def get_buffer(self, conversation_id: int) -> StreamEventBuffer | None:
        task = self._tasks.get(conversation_id)
        return task.buffer if task else None

    def get_stream_status(self, conversation_id: int, db: Any) -> dict | None:
        task = self._tasks.get(conversation_id)
        if task:
            if not task.is_active:
                return {
                    "status": task.status,
                    "error": task.error_message,
                    "cursor": task.buffer.cursor,
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
            # Stale: no active task but DB still says streaming.
            # Return None so the caller (resume_conversation_stream)
            # handles auto-repair via its own stale detection.
            return None

        return {
            "status": msg.stream_state,
            "error": None,
            "cursor": msg.stream_cursor or 0,
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
        if existing and existing.is_active:
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
        if not task.is_active:
            logger.warning("[cancel] conv=%s task not active (status=%s), cancel missed", conversation_id, task.status)
            return False

        task.status = "cancelled"
        # The background task's CancelledError handler will flush DB,
        # add a buffer terminal event, and broadcast it.
        # The finally block will finalize task.status and clean up.
        # This prevents resume hang (broadcast uses buffer format) and
        # race (DB flush happens before status becomes non-streaming).

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

        chunk_builder = ChunkJsonBuilder()
        assistant_text_parts: list[str] = []
        latest_updates_text: str | None = None
        last_flush_time = time.monotonic()
        last_heartbeat_time = time.monotonic()
        state_final = "completed"

        def _extract_updates_content(event: Any) -> str | None:
            """Extract latest non-empty kwargs.content from type=updates payload."""
            if not isinstance(event, dict) or event.get("type") != "updates":
                return None
            data = event.get("data")
            if not isinstance(data, dict):
                return None
            tools_payload = data.get("model")
            if not isinstance(tools_payload, dict):
                return None
            messages_payload = tools_payload.get("messages")
            if not isinstance(messages_payload, list):
                return None

            latest_content: str | None = None
            for message in messages_payload:
                if not isinstance(message, dict):
                    continue
                kwargs_payload = message.get("kwargs")
                if not isinstance(kwargs_payload, dict):
                    continue
                content = kwargs_payload.get("content")
                if isinstance(content, str):
                    content = content.strip()
                    if content:
                        latest_content = content
            return latest_content

        def _maybe_heartbeat() -> None:
            nonlocal last_heartbeat_time
            now_hb = time.monotonic()
            if now_hb - last_heartbeat_time < HEARTBEAT_INTERVAL_SECONDS:
                return
            last_heartbeat_time = now_hb
            try:
                _flush_heartbeat(db, conversation_id)
            except Exception:
                pass

        def _maybe_flush() -> None:
            nonlocal last_flush_time
            if chunk_builder.count == 0:
                return
            chunk_json = chunk_builder.to_chunk_json()
            ok = self._flush_to_db(
                db, stream_msg_id, task.buffer, chunk_json=chunk_json,
            )
            if ok:
                task.buffer.trim()
            last_flush_time = time.monotonic()

        try:
            _agent_it = agent.astream(
                {"messages": messages},
                stream_mode=["messages", "updates", "custom"],
                config=config,
                version="v2",
            ).__aiter__()

            while True:
                try:
                    chunk = await asyncio.wait_for(
                        _agent_it.__anext__(),
                        timeout=AGENT_CHUNK_TIMEOUT,
                    )
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError:
                    raise Exception(
                        f"Agent stream timed out after {AGENT_CHUNK_TIMEOUT}s"
                    )
                serializable = ChatService.convert_to_serializable(chunk)
                updates_content = _extract_updates_content(serializable)
                if updates_content:
                    latest_updates_text = updates_content

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
                        chunk_builder.add(evt)
                        self.broadcast(conversation_id, evt)
                    continue

                text_part = ChatService._extract_text_from_chunk(serializable)
                if text_part:
                    assistant_text_parts.append(text_part)

                if not debug_content_only:
                    evt = task.buffer.add(serializable)
                    chunk_builder.add(evt)
                    self.broadcast(conversation_id, evt)

                now = time.monotonic()
                if (
                    task.buffer.cursor % FLUSH_INTERVAL_EVENTS == 0
                    or now - last_flush_time >= FLUSH_INTERVAL_SECONDS
                ):
                    _maybe_flush()
                    _maybe_heartbeat()

            final_text = latest_updates_text or "模型已完成调用。"

            logger.info(
                "[run] conv=%s stream completed normally, event_count=%d, text_len=%d",
                conversation_id, chunk_builder.count, len(final_text),
            )
            self._flush_terminal(
                db, stream_msg_id, task.buffer, state="completed",
                content=final_text,
                chunk_json=chunk_builder.to_chunk_json(),
            )

            evt = task.buffer.add({"status": "completed"})
            logger.info(
                "[run] conv=%s broadcasting completed event: seq=%d, subscribers=%d",
                conversation_id, evt["seq"], len(task.subscribers),
            )
            self.broadcast(conversation_id, evt)

        except asyncio.CancelledError:
            state_final = "cancelled"
            partial_text = latest_updates_text or None
            logger.info(
                "[run] conv=%s CancelledError caught, event_count=%d, text_len=%s, task.status=%s",
                conversation_id, chunk_builder.count,
                len(partial_text) if partial_text else "None",
                task.status,
            )
            self._flush_terminal(
                db, stream_msg_id, task.buffer, state="cancelled",
                content=partial_text,
                chunk_json=chunk_builder.to_chunk_json(),
            )
            evt = task.buffer.add({"status": "cancelled"})
            logger.info(
                "[run] conv=%s broadcasting cancelled event: seq=%d, subscribers=%d",
                conversation_id, evt["seq"], len(task.subscribers),
            )
            self.broadcast(conversation_id, evt)
            raise

        except Exception as e:
            logger.error(
                "[run] conv=%s agent FAILED: %s, event_count=%d, text_len=%s",
                conversation_id, e, chunk_builder.count,
                len("".join(assistant_text_parts)) if assistant_text_parts else "0",
                exc_info=True,
            )
            state_final = "error"
            task.error_message = str(e)
            partial_text = latest_updates_text or None
            self._flush_terminal(
                db, stream_msg_id, task.buffer, state="error",
                content=partial_text,
                chunk_json=chunk_builder.to_chunk_json(),
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
                partial_text = latest_updates_text or None
                self._flush_terminal(
                    db, stream_msg_id, task.buffer, state="cancelled",
                    content=partial_text,
                    chunk_json=chunk_builder.to_chunk_json(),
                )
            logger.info(
                "[run] conv=%s finally: state_final=%s, event_count=%d, buffer_cursor=%d",
                conversation_id, state_final, chunk_builder.count, task.buffer.cursor,
            )
            task.status = state_final
            print(f"1111111111111state_final: {state_final}")
            _finalize_task_stream(conversation_id, state_final)

            task.subscribers.clear()
            db.close()
            self._schedule_cleanup(conversation_id)

    def _flush_terminal(
        self,
        db: Any,
        stream_msg_id: int,
        buffer: StreamEventBuffer,
        state: str,
        content: str | None,
        chunk_json: str | None,
        error_message: str | None = None,
        max_retries: int = 3,
    ) -> None:
        """Flush terminal state with retry to avoid stuck streaming on transient DB errors."""
        for attempt in range(max_retries):
            self._flush_to_db(
                db, stream_msg_id, buffer, state=state,
                content=content, chunk_json=chunk_json,
                error_message=error_message,
            )
            try:
                msg = db.get(ConversationMessage, stream_msg_id)
                if msg and msg.stream_state == state:
                    return
            except Exception:
                db.rollback()
            if attempt < max_retries - 1:
                logger.warning(
                    "[flush] msg_id=%s terminal state=%s not persisted, retrying %d/%d",
                    stream_msg_id, state, attempt + 1, max_retries,
                )
                time.sleep(0.3)
        logger.error(
            "[flush] msg_id=%s terminal state=%s FAILED after %d retries",
            stream_msg_id, state, max_retries,
        )

    def _flush_to_db(
        self,
        db: Any,
        stream_msg_id: int,
        buffer: StreamEventBuffer,
        state: str | None = None,
        content: str | None = None,
        chunk_json: str | None = None,
        error_message: str | None = None,
    ) -> bool:
        """Persist stream progress to DB.  Returns True on success."""
        try:
            msg = db.get(ConversationMessage, stream_msg_id)
            if not msg:
                logger.warning("[flush] msg_id=%s not found in DB, skip", stream_msg_id)
                return False
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
                "[flush] msg_id=%s committed: state=%s, content_len=%s, chunk_json_len=%s",
                stream_msg_id, state,
                len(content) if content else None,
                len(chunk_json) if chunk_json else None,
            )
            return True
        except Exception:
            logger.warning("[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True)
            db.rollback()
            return False


def _finalize_task_stream(conversation_id: int, stream_state: str) -> None:
    """流结束时回写 TaskExecutionLog + 推送 workspace 事件。
    使用独立 session，不依赖调用方 session 状态。"""
    try:
        from src.db.session import get_session_local
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.conversation import ConversationMessage
        from src.service.workspace_events import WorkspaceEventBus
        from src.models.workspace import cst_now

        db = get_session_local()()

        log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.conversation_id == conversation_id,
                TaskExecutionLog.run_status == "running",
            )
        ).first()
        if not log:
            db.close()
            return

        log.ended_at = cst_now()
        if log.started_at and log.ended_at:
            log.duration_ms = int(
                (log.ended_at.replace(tzinfo=None) - log.started_at.replace(tzinfo=None)).total_seconds() * 1000
            )

        if stream_state == "completed":
            last_msg = db.scalars(
                select(ConversationMessage).where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                ).order_by(ConversationMessage.id.desc())
            ).first()
            final_text = last_msg.content if last_msg else ""
            log.run_status = "success"
            log.run_result = "任务执行成功"
            log.output_json = json.dumps({"content": final_text}, ensure_ascii=False)

            WorkspaceEventBus.push(log.workspace_id, {
                "type": "task_completed",
                "task_id": log.task_id,
                "conversation_id": conversation_id,
            })
        elif stream_state == "cancelled":
            log.run_status = "cancelled"
            log.run_result = "任务已取消"
        else:
            log.run_status = "failed"
            log.run_result = "执行异常"
            log.error_message = "agent stream error"

        db.commit()
        db.close()
    except Exception:
        logger.error(
            "_finalize_task_stream failed conv=%s state=%s",
            conversation_id, stream_state, exc_info=True
        )


def _flush_heartbeat(db: Any, conversation_id: int) -> None:
    try:
        from sqlalchemy import select
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.workspace import cst_now

        log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.conversation_id == conversation_id,
                TaskExecutionLog.run_status == "running",
            )
        ).first()
        if not log:
            return
        log.last_heartbeat_at = cst_now()
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def cleanup_zombie_executions(db: Any) -> int:
    """启动时清理僵尸运行状态：超过10分钟无心跳的 running 任务标记为 timeout。"""
    try:
        from sqlalchemy import select
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.workspace import cst_now
        from datetime import timedelta

        now = cst_now()
        threshold = now - timedelta(minutes=10)

        zombies = list(
            db.scalars(
                select(TaskExecutionLog).where(
                    TaskExecutionLog.run_status == "running",
                    (
                        TaskExecutionLog.last_heartbeat_at.is_(None)
                        | (TaskExecutionLog.last_heartbeat_at < threshold)
                    ),
                )
            ).all()
        )
        for log in zombies:
            log.run_status = "timeout"
            log.run_result = "任务超时"
            log.error_message = "进程重启时检测到任务无心跳超时"
            log.ended_at = now
            if log.started_at:
                log.duration_ms = int(
                    (now.replace(tzinfo=None) - log.started_at.replace(tzinfo=None)).total_seconds() * 1000
                )

        if zombies:
            db.commit()
            logger.info("cleanup_zombie_executions: cleaned %d zombie tasks", len(zombies))
        return len(zombies)
    except Exception:
        logger.error("cleanup_zombie_executions failed", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        return 0


registry = StreamRegistry()
