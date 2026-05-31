from __future__ import annotations

import asyncio
import atexit
import json
import logging
import time
from collections import deque
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session
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


def _extract_last_usage_from_buffer(events: list[dict]) -> dict | None:
    """从 buffer 倒序取最后一次 AIMessageChunk 的 usage_metadata。"""
    for event in reversed(events):
        if not isinstance(event, dict):
            continue
        raw = event.get("data")
        if not isinstance(raw, dict):
            continue
        if raw.get("usage_metadata"):
            return raw["usage_metadata"]
        if raw.get("type") != "messages":
            continue
        inner = raw.get("data")
        if not isinstance(inner, list) or not inner:
            continue
        first = inner[0]
        if not isinstance(first, dict):
            continue
        if first.get("usage_metadata"):
            return first["usage_metadata"]
        kwargs = first.get("kwargs")
        if isinstance(kwargs, dict) and kwargs.get("usage_metadata"):
            return kwargs["usage_metadata"]
    return None


def _flush_to_db_sync(
    stream_msg_id: int,
    buffer_cursor: int,
    state: str | None = None,
    content: str | None = None,
    error_message: str | None = None,
    message_parts: str | None = None,
    usage_metadata: dict | None = None,
    elapsed_ms: int | None = None,
) -> bool:
    """同步写入会话消息流状态；在 asyncio.to_thread 中调用，勿跨线程复用 Session。"""
    from src.db.session import get_session_local

    db = get_session_local()()
    try:
        for attempt in range(DB_LOCK_RETRY_COUNT):
            try:
                msg = db.get(ConversationMessage, stream_msg_id)
                if not msg:
                    logger.warning(
                        "[flush] msg_id=%s not found in DB, skip", stream_msg_id
                    )
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
                msg.stream_cursor = buffer_cursor
                if message_parts is not None:
                    msg.message_parts = message_parts
                if usage_metadata is not None:
                    try:
                        meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                    meta["usage"] = usage_metadata
                    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
                if elapsed_ms is not None:
                    try:
                        meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                    meta["elapsed_ms"] = elapsed_ms
                    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
                db.commit()
                logger.info(
                    "[flush] msg_id=%s committed: state=%s, content_len=%s, parts_len=%s",
                    stream_msg_id,
                    state,
                    len(content) if content else None,
                    len(message_parts) if message_parts else None,
                )
                return True
            except OperationalError as e:
                db.rollback()
                is_locked = "database is locked" in str(e).lower()
                if not is_locked:
                    logger.warning(
                        "[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True
                    )
                    return False
                if attempt >= DB_LOCK_RETRY_COUNT - 1:
                    logger.warning(
                        "[flush] msg_id=%s FAILED after lock retries=%d",
                        stream_msg_id,
                        DB_LOCK_RETRY_COUNT,
                        exc_info=True,
                    )
                    return False
                time.sleep(DB_LOCK_RETRY_SLEEP_SECONDS * (attempt + 1))
            except Exception:
                logger.warning(
                    "[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True
                )
                db.rollback()
                return False
        return False
    finally:
        db.close()


def _flush_heartbeat_sync(conversation_id: int) -> None:
    from src.db.session import get_session_local
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now

    db = get_session_local()()
    try:
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
    finally:
        db.close()


def _checkpoint_flush_sync(
    stream_msg_id: int,
    buffer_cursor: int,
    buffer_events_snapshot: list[dict],
    content: str | None,
) -> bool:
    from src.service.message_parts_extractor import extract_message_parts_from_buffer

    checkpoint_parts = extract_message_parts_from_buffer(buffer_events_snapshot)
    if not checkpoint_parts:
        return _flush_to_db_sync(
            stream_msg_id,
            buffer_cursor,
            state="streaming",
            content=content,
        )
    message_parts_json = json.dumps(checkpoint_parts, ensure_ascii=False)
    return _flush_to_db_sync(
        stream_msg_id,
        buffer_cursor,
        state="streaming",
        content=content,
        message_parts=message_parts_json,
    )


def _extract_interrupt_payload(interrupts: list) -> dict:
    """从 LangGraph state.tasks[].interrupts 提取 HITL 载荷。"""
    action_requests = []
    review_configs = []
    for interrupt_item in interrupts:
        value = getattr(interrupt_item, "value", None)
        if isinstance(value, dict):
            if "action_requests" in value:
                action_requests.extend(value["action_requests"])
            if "review_configs" in value:
                review_configs.extend(value["review_configs"])
    return {
        "action_requests": action_requests,
        "review_configs": review_configs,
    }


def _flush_terminal_sync(
    stream_msg_id: int,
    buffer_cursor: int,
    buffer_events_snapshot: list[dict],
    state: str,
    content: str | None,
    error_message: str | None = None,
    elapsed_ms: int | None = None,
    interrupt_payload: dict | None = None,
) -> bool:
    from src.service.hitl_pending_parts import extract_message_parts_for_interrupt
    from src.service.message_parts_extractor import extract_message_parts_from_buffer

    message_parts_json: str | None = None
    try:
        if interrupt_payload:
            parts = extract_message_parts_for_interrupt(
                buffer_events_snapshot,
                interrupt_payload,
                stream_msg_id,
            )
        else:
            parts = extract_message_parts_from_buffer(buffer_events_snapshot)
        if parts:
            message_parts_json = json.dumps(parts, ensure_ascii=False)
    except Exception:
        logger.warning(
            "[flush] msg_id=%s message_parts extraction failed",
            stream_msg_id,
            exc_info=True,
        )

    usage_meta = _extract_last_usage_from_buffer(buffer_events_snapshot)

    return _flush_to_db_sync(
        stream_msg_id,
        buffer_cursor,
        state=state,
        content=content,
        error_message=error_message,
        message_parts=message_parts_json,
        usage_metadata=usage_meta,
        elapsed_ms=elapsed_ms,
    )


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
        self.on_task_finalized: Callable[..., None] | None = None

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

        result: dict = {
            "status": msg.stream_state,
            "error": None,
            "cursor": msg.stream_cursor or 0,
        }
        if msg.stream_state == "interrupted":
            result["message_id"] = msg.id
        return result

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
        *,
        orchestrator_owned_db: Session | None = None,
        orchestrator_workspace_id: int | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestrator_auth_token: str | None = None,
    ) -> bool:
        """启动Agent流式任务。

        为指定的会话创建并启动一个后台Agent执行任务，用于处理流式响应。
        如果该会话已有活跃的任务，则拒绝启动新任务。

        Args:
            conversation_id: 会话ID，用于标识和追踪流式任务
            agent: Agent实例，负责处理消息和生成响应
            messages: 消息列表，包含对话历史或当前需要处理的消息
            config: 配置字典，包含Agent运行所需的配置参数
            stream_msg_id: 流式消息ID，用于关联流式输出的消息记录
            skill_name: 技能名称，标识当前使用的Agent技能
            debug_content_only: 是否仅返回调试内容，用于开发调试模式
            orchestrator_owned_db: 可选，协调器拥有的数据库会话对象
            orchestrator_workspace_id: 可选，协调器工作空间ID
            orchestrator_conversation_id: 可选，协调器会话ID

        Returns:
            bool: 任务是否成功启动。如果会话已有活跃任务则返回False，否则返回True
        """
        # 检查是否已存在活跃任务，避免重复启动
        existing = self._tasks.get(conversation_id)
        if existing and existing.is_active:
            logger.warning(
                "start refused: conversation %s already has active stream",
                conversation_id,
            )
            return False

        # 清理未完成的历史清理任务，防止资源泄漏
        if existing and existing._cleanup_task and not existing._cleanup_task.done():
            existing._cleanup_task.cancel()
            logger.info(
                "start: cancelled stale cleanup for conversation %s", conversation_id
            )

        # 创建新的活动流任务并注册到任务管理器
        task = ActiveStreamTask(conversation_id)
        self._tasks[conversation_id] = task

        # 构建后台运行协程并启动异步任务
        coro = self._run_agent_background(
            conversation_id=conversation_id,
            agent=agent,
            messages=messages,
            config=config,
            stream_msg_id=stream_msg_id,
            skill_name=skill_name,
            debug_content_only=debug_content_only,
            task=task,
            orchestrator_owned_db=orchestrator_owned_db,
            orchestrator_workspace_id=orchestrator_workspace_id,
            orchestrator_conversation_id=orchestrator_conversation_id,
            orchestrator_auth_token=orchestrator_auth_token,
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

    async def approve_and_resume(
        self,
        conversation_id: int,
        agent: Any,
        config: dict,
        stream_msg_id: int,
        decisions: list[dict],
        *,
        orchestrator_owned_db: Session | None = None,
        orchestrator_workspace_id: int | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestrator_auth_token: str | None = None,
    ) -> bool:
        """HITL approve: 新建 task + 新 buffer，用 Command(resume) 继续 agent 执行。"""
        from langgraph.types import Command

        existing = self._tasks.get(conversation_id)
        if existing and existing.is_active:
            logger.warning(
                "[approve] conv=%s refused: active task exists (status=%s)",
                conversation_id, existing.status,
            )
            return False

        if existing and existing._cleanup_task and not existing._cleanup_task.done():
            existing._cleanup_task.cancel()

        task = ActiveStreamTask(conversation_id)
        self._tasks[conversation_id] = task

        resume_input = Command(resume={"decisions": decisions})

        coro = self._run_agent_background(
            conversation_id=conversation_id,
            agent=agent,
            messages=[],
            config=config,
            stream_msg_id=stream_msg_id,
            skill_name="",
            debug_content_only=False,
            task=task,
            agent_input=resume_input,
            orchestrator_owned_db=orchestrator_owned_db,
            orchestrator_workspace_id=orchestrator_workspace_id,
            orchestrator_conversation_id=orchestrator_conversation_id,
            orchestrator_auth_token=orchestrator_auth_token,
        )
        task._asyncio_task = asyncio.create_task(coro)
        logger.info(
            "[approve] conv=%s resume task created with Command(resume)",
            conversation_id,
        )
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
        agent_input: Any | None = None,
        orchestrator_owned_db: Session | None = None,
        orchestrator_workspace_id: int | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestrator_auth_token: str | None = None,
    ) -> None:
        from src.service.chat_service import ChatService

        stream_conv_id = orchestrator_conversation_id or conversation_id
        if orchestrator_workspace_id is not None:
            from src.service.agent.orchestrator.runtime import (
                register_stream_session,
                set_context,
            )

            register_stream_session(
                stream_conv_id,
                workspace_id=orchestrator_workspace_id,
                auth_token=orchestrator_auth_token,
            )

        if orchestrator_owned_db is not None:
            if orchestrator_workspace_id is None:
                raise ValueError(
                    "orchestrator_workspace_id required when orchestrator_owned_db is set"
                )
            from src.service.agent.orchestrator.runtime import set_context

            set_context(
                orchestrator_owned_db,
                orchestrator_workspace_id,
                orchestrator_conversation_id,
                auth_token=orchestrator_auth_token,
                bind_auth_token=True,
            )

        stream_start_time = time.monotonic()
        assistant_text_parts: list[str] = []
        latest_updates_text: str | None = None
        state_final = "completed"
        _last_checkpoint_count = 0

        async def _heartbeat_loop():
            try:
                while True:
                    await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                    try:
                        await asyncio.to_thread(
                            _flush_heartbeat_sync, conversation_id
                        )
                    except Exception:
                        pass
            except asyncio.CancelledError:
                pass

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

        _agent_it = None
        try:
            stream_input = agent_input if agent_input is not None else {"messages": messages}
            _agent_it = agent.astream(
                stream_input,
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
                    len(task.buffer._events) - _last_checkpoint_count
                    > BUFFER_CHECKPOINT_LEN
                ):
                    _last_checkpoint_count = len(task.buffer._events)
                    events_snapshot = list(task.buffer._events)
                    cursor_snapshot = task.buffer.cursor
                    current_text = "".join(assistant_text_parts)
                    ok = await asyncio.to_thread(
                        _checkpoint_flush_sync,
                        stream_msg_id,
                        cursor_snapshot,
                        events_snapshot,
                        current_text or None,
                    )
                    if not ok:
                        logger.warning(
                            "[run] conv=%s checkpoint flush FAILED at cursor=%d",
                            conversation_id, cursor_snapshot,
                        )

            final_text = latest_updates_text or "模型已完成调用。"

            is_interrupted = False
            interrupt_payload = None
            try:
                state = await agent.aget_state(config)
                if state.next:
                    for task_item in state.tasks:
                        if task_item.interrupts:
                            is_interrupted = True
                            interrupt_payload = _extract_interrupt_payload(
                                task_item.interrupts
                            )
                            break
            except Exception:
                logger.warning(
                    "[run] conv=%s aget_state failed after stream end",
                    conversation_id,
                    exc_info=True,
                )

            if is_interrupted and interrupt_payload:
                state_final = "interrupted"
                final_text = latest_updates_text or "等待用户确认..."
                logger.info(
                    "[run] conv=%s HITL interrupt detected, event_count=%d, payload=%s",
                    conversation_id, task.buffer.cursor, list(interrupt_payload.keys()),
                )
                events_snapshot = list(task.buffer._events)
                from src.service.hitl_pending_parts import (
                    extract_message_parts_for_interrupt,
                )

                interrupt_parts = extract_message_parts_for_interrupt(
                    events_snapshot,
                    interrupt_payload,
                    stream_msg_id,
                )
                evt = task.buffer.add({
                    "status": "interrupted",
                    "message_id": stream_msg_id,
                    "message_parts": interrupt_parts,
                })
                self.broadcast(conversation_id, evt)
                elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
                ok = await self._flush_terminal(
                    stream_msg_id,
                    task,
                    state="interrupted",
                    content=final_text,
                    elapsed_ms=elapsed_ms,
                    interrupt_payload=interrupt_payload,
                )
                if not ok:
                    await self._ensure_terminal_state(stream_msg_id, "interrupted")
            else:
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

                elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
                ok = await self._flush_terminal(
                    stream_msg_id,
                    task,
                    state="completed",
                    content=final_text,
                    elapsed_ms=elapsed_ms,
                )
                if not ok:
                    await self._ensure_terminal_state(stream_msg_id, "completed")

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

            elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
            ok = await self._flush_terminal(
                stream_msg_id,
                task,
                state="cancelled",
                content=partial_text,
                elapsed_ms=elapsed_ms,
            )
            if not ok:
                await self._ensure_terminal_state(stream_msg_id, "cancelled")
            raise

        except Exception as e:
            from src.service.agent.error_messages import format_agent_error_for_user

            user_error = format_agent_error_for_user(e)
            logger.error(
                "[run] conv=%s agent FAILED: %s, event_count=%d, text_len=%s",
                conversation_id, e, task.buffer.cursor,
                len("".join(assistant_text_parts)) if assistant_text_parts else "0",
                exc_info=True,
            )
            state_final = "error"
            task.error_message = user_error
            partial_text = latest_updates_text or None

            evt = task.buffer.add({"status": "error", "error": user_error})
            self.broadcast(conversation_id, evt)

            elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
            ok = await self._flush_terminal(
                stream_msg_id,
                task,
                state="error",
                content=partial_text,
                error_message=user_error,
                elapsed_ms=elapsed_ms,
            )
            if not ok:
                await self._ensure_terminal_state(stream_msg_id, "error")

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
                elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
                ok = await self._flush_terminal(
                    stream_msg_id,
                    task,
                    state="cancelled",
                    content=partial_text,
                    elapsed_ms=elapsed_ms,
                )
                if not ok:
                    await self._ensure_terminal_state(stream_msg_id, "cancelled")
            logger.info(
                "[run] conv=%s finally: state_final=%s, buffer_cursor=%d",
                conversation_id, state_final, task.buffer.cursor,
            )
            task.status = state_final
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _finalize_task_stream, conversation_id, state_final)

            task.subscribers.clear()
            self._schedule_cleanup(conversation_id)

            if orchestrator_owned_db is not None:
                from src.service.agent.orchestrator.runtime import reset_context

                reset_context()
                orchestrator_owned_db.close()
            elif orchestrator_workspace_id is not None:
                from src.service.agent.orchestrator.runtime import (
                    unregister_stream_session,
                )

                unregister_stream_session(stream_conv_id)

    async def _ensure_terminal_state(self, stream_msg_id: int, state: str) -> None:
        """flush 失败兜底：仅写 stream_state，不写 content/parts，保证不卡在 streaming。"""
        def _do():
            from src.db.session import get_session_local
            db = get_session_local()()
            try:
                msg = db.get(ConversationMessage, stream_msg_id)
                if msg and msg.stream_state == "streaming":
                    msg.stream_state = state
                    msg.stream_cursor = 0
                    db.commit()
                    logger.info(
                        "[ensure] msg_id=%s terminal state set to %s (fallback after flush failure)",
                        stream_msg_id, state,
                    )
            except Exception:
                pass
            finally:
                db.close()
        await asyncio.to_thread(_do)

    async def _flush_terminal(
        self,
        stream_msg_id: int,
        task: ActiveStreamTask,
        state: str,
        content: str | None,
        error_message: str | None = None,
        elapsed_ms: int | None = None,
        interrupt_payload: dict | None = None,
    ) -> bool:
        events_snapshot = list(task.buffer._events)
        cursor_snapshot = task.buffer.cursor
        ok = await asyncio.to_thread(
            _flush_terminal_sync,
            stream_msg_id,
            cursor_snapshot,
            events_snapshot,
            state,
            content,
            error_message,
            elapsed_ms,
            interrupt_payload,
        )
        if not ok:
            logger.error(
                "[flush] conv=%s terminal state=%s FLUSH FAILED",
                task.conversation_id, state,
            )
        return ok


def _finalize_task_stream(conversation_id: int, stream_state: str) -> None:
    try:
        from src.db.session import get_session_local
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.conversation import Conversation, ConversationMessage
        from src.models.workspace import cst_now

        db = get_session_local()()

        # 1. 更新会话状态 + 推 SSE 事件（必须在 log 检查之前，确保普通聊天也能更新）
        conv = db.get(Conversation, conversation_id)
        if conv:
            if stream_state in ("completed", "cancelled"):
                conv.status = "idle"
            elif stream_state == "error":
                conv.status = "error"
            elif stream_state == "interrupted":
                conv.status = "interrupted"
            db.commit()
            try:
                from src.service.workspace_events import WorkspaceEventBus, CONVERSATION_STATUS_CHANGED
                WorkspaceEventBus.push(conv.workspace_id, {
                    "type": CONVERSATION_STATUS_CHANGED,
                    "conversation_id": conversation_id,
                    "target_type": conv.target_type,
                    "target_id": conv.target_id,
                    "status": conv.status,
                })
            except Exception:
                logger.warning("push conversation_status_changed failed conv=%s", conversation_id, exc_info=True)

        # 2. 后执行反思（仅 completed，从 Conversation 获取 employee_id）
        if stream_state == "completed":
            employee_id = None
            if conv and conv.target_type == "employee":
                employee_id = conv.target_id
            if employee_id is not None:
                try:
                    from src.service.reflection_engine import run_reflection

                    run_reflection(conversation_id, employee_id, db)
                except Exception:
                    logger.warning("reflection failed conv=%s", conversation_id, exc_info=True)

        # 3. 更新 TaskExecutionLog（仅当存在时）
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
            from src.service.orchestrator_execution_summary import (
                resolve_assistant_delivery_text,
            )

            last_msg = db.scalars(
                select(ConversationMessage).where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                ).order_by(ConversationMessage.id.desc())
            ).first()
            final_text = resolve_assistant_delivery_text(last_msg)
            log.run_status = "success"
            log.run_result = "任务执行成功"
            log.output_json = json.dumps({"content": final_text}, ensure_ascii=False)
        elif stream_state == "cancelled":
            log.run_status = "cancelled"
            log.run_result = "任务已取消"
        else:
            log.run_status = "failed"
            log.run_result = "任务执行失败"
            err_text = "agent stream error"
            last_msg = db.scalars(
                select(ConversationMessage).where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                ).order_by(ConversationMessage.id.desc())
            ).first()
            if last_msg and last_msg.extra_meta:
                try:
                    meta = json.loads(last_msg.extra_meta)
                    if isinstance(meta, dict) and meta.get("error_message"):
                        err_text = str(meta["error_message"])[:2000]
                except (json.JSONDecodeError, TypeError):
                    pass
            log.error_message = err_text

        db.commit()
        db.refresh(log)

        summary_message = None
        orch_conv_id = log.orchestrator_conversation_id
        try:
            from src.service.orchestrator_execution_summary import (
                append_orchestrator_execution_summary,
                resolve_log_orchestrator_conversation_id,
            )

            summary_message = append_orchestrator_execution_summary(
                db, log, stream_state
            )
            if orch_conv_id is None:
                orch_conv_id = resolve_log_orchestrator_conversation_id(db, log)
        except Exception:
            logger.warning(
                "orchestrator execution summary failed conv=%s",
                conversation_id,
                exc_info=True,
            )

        if registry.on_task_finalized:
            try:
                registry.on_task_finalized(
                    conversation_id,
                    stream_state,
                    log.task_id,
                    log.workspace_id,
                    orchestrator_conversation_id=orch_conv_id,
                    summary_message_id=(
                        summary_message.id if summary_message else None
                    ),
                    execution_log_id=log.id,
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
