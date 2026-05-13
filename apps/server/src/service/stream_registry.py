from __future__ import annotations

import asyncio
import atexit
import json
import logging
import time
from collections import deque
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from src.models.conversation import ConversationMessage

logger = logging.getLogger(__name__)

Subscriber = Callable[[dict], None]

HEARTBEAT_INTERVAL_SECONDS = 30.0
TASK_TTL_SECONDS = 20
BUFFER_CHECKPOINT_LEN = 10000
AGENT_CHUNK_TIMEOUT = 1800.0
DB_LOCK_RETRY_COUNT = 2
DB_LOCK_RETRY_SLEEP_SECONDS = 0.05


class StreamEventBuffer:
    def __init__(self, conversation_id: int):
        self.conversation_id = conversation_id
        self._events: deque[dict] = deque()
        self._seq = 0

    def add(self, data: Any) -> dict:
        self._seq += 1
        event = {"seq": self._seq, "data": data}
        self._events.append(event)
        return event

    def get_events_after(self, cursor: int) -> list[dict]:
        return [e for e in self._events if e["seq"] > cursor]

    @property
    def cursor(self) -> int:
        return self._seq

    @property
    def events(self) -> list[dict]:
        return list(self._events)


class ActiveStreamTask:
    def __init__(self, conversation_id: int):
        self.conversation_id = conversation_id
        self.status: str = "streaming"
        self.buffer = StreamEventBuffer(conversation_id)
        self.subscribers: set[Subscriber] = set()
        self._asyncio_task: asyncio.Task | None = None
        self._cleanup_task: asyncio.Task | None = None
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
        self.on_task_finalized: Callable[[int, str, int, int], None] | None = None

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

        if existing and existing._cleanup_task and not existing._cleanup_task.done():
            existing._cleanup_task.cancel()
            logger.info(
                "start: cancelled stale cleanup for conversation %s", conversation_id
            )

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

        if task._asyncio_task and not task._asyncio_task.done():
            task._asyncio_task.cancel()
            logger.info("[cancel] conv=%s task.cancel() called, asyncio_task will raise CancelledError", conversation_id)
        else:
            logger.warning("[cancel] conv=%s asyncio_task already done before cancel()", conversation_id)

        return True

    def _schedule_cleanup(self, conversation_id: int) -> None:
        task = self._tasks.get(conversation_id)

        async def _cleanup() -> None:
            await asyncio.sleep(TASK_TTL_SECONDS)
            current = self._tasks.get(conversation_id)
            if current is task:
                self._tasks.pop(conversation_id, None)
                logger.info(
                    "cleanup: removed task for conversation %s", conversation_id
                )
            else:
                logger.info(
                    "cleanup: conversation %s task replaced, skipping removal",
                    conversation_id,
                )

        cleanup_task = asyncio.create_task(_cleanup())
        if task:
            task._cleanup_task = cleanup_task

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
        from src.service.message_parts_extractor import extract_message_parts_from_buffer

        db = get_session_local()()

        assistant_text_parts: list[str] = []
        latest_updates_text: str | None = None
        last_heartbeat_time = time.monotonic()
        state_final = "completed"
        _last_checkpoint_count = 0

        async def _heartbeat_loop():
            hb_db = get_session_local()()
            try:
                while True:
                    await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                    try:
                        _flush_heartbeat(hb_db, conversation_id)
                    except Exception:
                        pass
            except asyncio.CancelledError:
                pass
            finally:
                hb_db.close()

        _heartbeat_task = asyncio.create_task(_heartbeat_loop())

        def _extract_updates_content(event: Any) -> str | None:
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

        _agent_it = None
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
                        self.broadcast(conversation_id, evt)
                    continue

                text_part = ChatService._extract_text_from_chunk(serializable)
                if text_part:
                    assistant_text_parts.append(text_part)

                if not debug_content_only:
                    evt = task.buffer.add(serializable)
                    self.broadcast(conversation_id, evt)

                if (
                    len(task.buffer._events) - _last_checkpoint_count > BUFFER_CHECKPOINT_LEN
                ):
                    _last_checkpoint_count = len(task.buffer._events)
                    checkpoint_parts = extract_message_parts_from_buffer(
                        list(task.buffer._events)
                    )
                    if checkpoint_parts:
                        current_text = "".join(assistant_text_parts)
                        await self._flush_to_db(
                            db, stream_msg_id, task.buffer,
                            state="streaming",
                            content=current_text or None,
                            message_parts=json.dumps(
                                checkpoint_parts, ensure_ascii=False
                            ),
                        )

                _maybe_heartbeat()

            final_text = latest_updates_text or "模型已完成调用。"

            logger.info(
                "[run] conv=%s stream completed normally, event_count=%d, text_len=%d",
                conversation_id, task.buffer.cursor, len(final_text),
            )
            evt = task.buffer.add({"status": "completed"})
            logger.info(
                "[run] conv=%s broadcasting completed event: seq=%d, subscribers=%d",
                conversation_id, evt["seq"], len(task.subscribers),
            )
            self.broadcast(conversation_id, evt)

            await self._flush_terminal(
                db, stream_msg_id, task.buffer, state="completed",
                content=final_text,
            )

        except asyncio.CancelledError:
            state_final = "cancelled"
            partial_text = latest_updates_text or None
            logger.info(
                "[run] conv=%s CancelledError caught, event_count=%d, text_len=%s, task.status=%s",
                conversation_id, task.buffer.cursor,
                len(partial_text) if partial_text else "None",
                task.status,
            )
            evt = task.buffer.add({"status": "cancelled"})
            logger.info(
                "[run] conv=%s broadcasting cancelled event: seq=%d, subscribers=%d",
                conversation_id, evt["seq"], len(task.subscribers),
            )
            self.broadcast(conversation_id, evt)

            await self._flush_terminal(
                db, stream_msg_id, task.buffer, state="cancelled",
                content=partial_text,
            )
            raise

        except Exception as e:
            logger.error(
                "[run] conv=%s agent FAILED: %s, event_count=%d, text_len=%s",
                conversation_id, e, task.buffer.cursor,
                len("".join(assistant_text_parts)) if assistant_text_parts else "0",
                exc_info=True,
            )
            state_final = "error"
            task.error_message = str(e)
            partial_text = latest_updates_text or None

            evt = task.buffer.add({"status": "error", "error": str(e)})
            self.broadcast(conversation_id, evt)

            await self._flush_terminal(
                db, stream_msg_id, task.buffer, state="error",
                content=partial_text,
                error_message=str(e),
            )

        finally:
            _heartbeat_task.cancel()
            try:
                await _heartbeat_task
            except asyncio.CancelledError:
                pass

            if _agent_it is not None:
                try:
                    await asyncio.wait_for(_agent_it.aclose(), timeout=5.0)
                except Exception:
                    pass

            if task.status == "cancelled" and state_final != "cancelled":
                logger.warning(
                    "[run] conv=%s finally: task.status=cancelled but state_final=%s, doing fallback flush",
                    conversation_id, state_final,
                )
                state_final = "cancelled"
                partial_text = latest_updates_text or None
                await self._flush_terminal(
                    db, stream_msg_id, task.buffer, state="cancelled",
                    content=partial_text,
                )
            logger.info(
                "[run] conv=%s finally: state_final=%s, buffer_cursor=%d",
                conversation_id, state_final, task.buffer.cursor,
            )
            task.status = state_final
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _finalize_task_stream, conversation_id, state_final)

            task.subscribers.clear()
            db.close()
            self._schedule_cleanup(conversation_id)

    async def _flush_terminal(
        self,
        db: Any,
        stream_msg_id: int,
        buffer: StreamEventBuffer,
        state: str,
        content: str | None,
        error_message: str | None = None,
    ) -> None:
        from src.service.message_parts_extractor import extract_message_parts_from_buffer

        message_parts_json: str | None = None
        try:
            parts = extract_message_parts_from_buffer(list(buffer._events))
            if parts:
                message_parts_json = json.dumps(parts, ensure_ascii=False)
        except Exception:
            logger.warning(
                "[flush] msg_id=%s message_parts extraction failed",
                stream_msg_id,
                exc_info=True,
            )

        await self._flush_to_db(
            db, stream_msg_id, buffer, state=state,
            content=content,
            error_message=error_message,
            message_parts=message_parts_json,
        )

    async def _flush_to_db(
        self,
        db: Any,
        stream_msg_id: int,
        buffer: StreamEventBuffer,
        state: str | None = None,
        content: str | None = None,
        error_message: str | None = None,
        message_parts: str | None = None,
    ) -> bool:
        for attempt in range(DB_LOCK_RETRY_COUNT):
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
                if message_parts is not None:
                    msg.message_parts = message_parts
                db.commit()
                logger.info(
                    "[flush] msg_id=%s committed: state=%s, content_len=%s, parts_len=%s",
                    stream_msg_id, state,
                    len(content) if content else None,
                    len(message_parts) if message_parts else None,
                )
                return True
            except OperationalError as e:
                db.rollback()
                is_locked = "database is locked" in str(e).lower()
                if not is_locked:
                    logger.warning("[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True)
                    return False
                if attempt >= DB_LOCK_RETRY_COUNT - 1:
                    logger.warning(
                        "[flush] msg_id=%s FAILED after lock retries=%d",
                        stream_msg_id,
                        DB_LOCK_RETRY_COUNT,
                        exc_info=True,
                    )
                    return False
                await asyncio.sleep(DB_LOCK_RETRY_SLEEP_SECONDS * (attempt + 1))
            except Exception:
                logger.warning("[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True)
                db.rollback()
                return False
        return False


def _finalize_task_stream(conversation_id: int, stream_state: str) -> None:
    try:
        from src.db.session import get_session_local
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.conversation import ConversationMessage
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
        elif stream_state == "cancelled":
            log.run_status = "cancelled"
            log.run_result = "任务已取消"
        else:
            log.run_status = "failed"
            log.run_result = "执行异常"
            log.error_message = "agent stream error"

        db.commit()

        if registry.on_task_finalized:
            try:
                registry.on_task_finalized(
                    conversation_id, stream_state, log.task_id, log.workspace_id
                )
            except Exception:
                logger.warning(
                    "on_task_finalized callback failed conv=%s", conversation_id, exc_info=True
                )

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


def _emergency_flush_all() -> None:
    from src.service.message_parts_extractor import extract_message_parts_from_buffer
    from src.db.session import get_session_local

    for cid, task in list(registry._tasks.items()):
        if not task.is_active:
            continue
        try:
            db = get_session_local()()
            events = list(task.buffer._events)
            parts = extract_message_parts_from_buffer(events)
            stmt = (
                select(ConversationMessage)
                .where(
                    ConversationMessage.conversation_id == cid,
                    ConversationMessage.role == "assistant",
                    ConversationMessage.stream_state == "streaming",
                )
                .order_by(ConversationMessage.id.desc())
                .limit(1)
            )
            msg = db.scalar(stmt)
            if msg:
                msg.stream_state = "error"
                msg.stream_cursor = task.buffer.cursor
                if parts:
                    msg.message_parts = json.dumps(parts, ensure_ascii=False)
                db.commit()
                logger.info(
                    "[emergency] conv=%s flushed on exit: parts_count=%d",
                    cid, len(parts) if parts else 0,
                )
            db.close()
        except Exception:
            pass


atexit.register(_emergency_flush_all)

registry = StreamRegistry()
