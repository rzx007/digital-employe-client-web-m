from __future__ import annotations
import logging
import os
import json
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.chat_group import ChatGroup
from src.schemas.conversation import ConversationRead
from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.workspace import Workspace, cst_now
from src.service.employee_service import EmployeeService
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend
from langchain_openai import ChatOpenAI
from datetime import datetime  # 导入datetime模块
from urllib.request import urlopen
from deepagents.backends.utils import create_file_data
from langgraph.checkpoint.memory import MemorySaver
from src.service.agent import delete_conversation_checkpoint, get_agent


logger = logging.getLogger(__name__)


class ChatService:
    @staticmethod
    def _to_virtual_backend_path(abs_path: str, root_path: str) -> str:
        path = Path(abs_path).resolve()
        root = Path(root_path).resolve()
        try:
            relative = path.relative_to(root)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"技能目录不在工作空间下，无法转换为虚拟路径：{path}",
            ) from exc
        return "/" + relative.as_posix().rstrip("/") + "/"

    @staticmethod
    def _resolve_skills_dir(skills_payload: str | list | dict | None) -> str:
        def normalize_skills_dir(path_str: str) -> str:
            path = Path(path_str)
            if path.name.lower() == "skills":
                parent = path.parent
                if str(parent):
                    return str(parent)
            return path_str

        if not skills_payload:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未配置可用的技能目录。")

        data: Any = skills_payload
        if isinstance(skills_payload, str):
            try:
                data = json.loads(skills_payload)
            except json.JSONDecodeError:
                # 兼容直接存路径字符串的情况
                return normalize_skills_dir(skills_payload)

        if isinstance(data, dict):
            skills_dir = data.get("skills_dir") or data.get("stored_path") or data.get("path")
            if isinstance(skills_dir, str) and skills_dir:
                return normalize_skills_dir(skills_dir)
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, str) and first:
                return normalize_skills_dir(first)
            if isinstance(first, dict):
                skills_dir = first.get("skills_dir") or first.get("stored_path") or first.get("path")
                if isinstance(skills_dir, str) and skills_dir:
                    return normalize_skills_dir(skills_dir)

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="skills_json 格式不正确，无法解析技能目录。")

    @staticmethod
    def resolve_employee_skills_dir(
        skills_payload: str | list | dict | None,
        employee_id: int | None = None,
        employee_name: str | None = None,
        employee_code: str | None = None,
    ) -> str:
        try:
            resolved = ChatService._resolve_skills_dir(skills_payload)
            resolved_path = Path(resolved)
            if resolved_path.is_dir():
                EmployeeService.materialize_embedded_skills(resolved_path)
            logger.info(
                "Resolved employee skills from payload: employee_id=%s employee_name=%s employee_code=%s payload=%s resolved=%s",
                employee_id,
                employee_name,
                employee_code,
                skills_payload,
                resolved,
            )
            return resolved
        except HTTPException:
            pass

        settings = get_settings()
        skill_root = Path(os.path.expandvars(os.path.expanduser(settings.skill_path)))
        if not skill_root.is_absolute():
            skill_root = Path.cwd() / skill_root
        roots = [skill_root, Path.cwd() / "local-employees"]

        for root in roots:
            candidates: list[Path] = []
            if employee_id is not None:
                candidates.append(root / str(employee_id) / "skills")
            if employee_name:
                candidates.append(root / employee_name / "skills")
            if employee_code and employee_code != employee_name:
                candidates.append(root / employee_code / "skills")

            for candidate in candidates:
                if candidate.is_dir():
                    EmployeeService.materialize_embedded_skills(candidate.parent)
                    logger.info(
                        "Resolved employee skills from fallback root: employee_id=%s employee_name=%s employee_code=%s root=%s candidate=%s",
                        employee_id,
                        employee_name,
                        employee_code,
                        root,
                        candidate,
                    )
                    return str(candidate.parent)

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No available employee skills directory found",
        )

    @staticmethod
    def _validate_target(db: Session, workspace_id: int, target_type: str, target_id: int) -> None:
        if target_type == "curator":
            return
        if target_type == "employee":
            employee = db.get(Employee, target_id)
            if not employee or employee.workspace_id != workspace_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")
            return
        if target_type == "group":
            group = db.get(ChatGroup, target_id)
            if not group or group.workspace_id != workspace_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到群组。")
            return
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_type 仅支持 employee、group 或 curator。")

    @staticmethod
    def create_conversation(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
        title: str | None,
    ) -> Conversation:
        ChatService._validate_target(db, workspace_id, target_type, target_id)
        conversation = Conversation(
            workspace_id=workspace_id,
            target_type=target_type,
            target_id=target_id,
            title=title or None,
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
        return conversation

    @staticmethod
    def list_conversations(db: Session, workspace_id: int, target_type: str, target_id: int) -> list[Conversation]:
        ChatService._validate_target(db, workspace_id, target_type, target_id)
        stmt: Select[tuple[Conversation]] = (
            select(Conversation)
            .where(
                Conversation.workspace_id == workspace_id,
                Conversation.target_type == target_type,
                Conversation.target_id == target_id,
            )
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
        )
        return list(db.scalars(stmt).all())

    @staticmethod
    def get_conversation(db: Session, conversation_id: int) -> Conversation:
        conversation = db.get(Conversation, conversation_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到会话。")
        return conversation

    @staticmethod
    def list_messages(db: Session, conversation_id: int) -> list[ConversationMessage]:
        ChatService.get_conversation(db, conversation_id)
        stmt: Select[tuple[ConversationMessage]] = (
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation_id)
            .order_by(ConversationMessage.id.asc())
        )
        messages = list(db.scalars(stmt).all())

        return messages

    @staticmethod
    async def adelete_conversation(db: Session, conversation_id: int) -> None:
        from src.service.stream_registry import registry

        registry.cancel(conversation_id)
        await delete_conversation_checkpoint(conversation_id)

        conversation = ChatService.get_conversation(db, conversation_id)
        workspace = db.get(Workspace, conversation.workspace_id)

        dirs_to_remove: list[Path] = [
            Path(get_settings().artifacts_path) / str(conversation_id),
        ]
        if workspace:
            dirs_to_remove.append(
                Path(workspace.root_path) / "conversations" / str(conversation_id)
            )

        db.delete(conversation)
        db.commit()

        seen: set[Path] = set()
        for conversation_dir in dirs_to_remove:
            resolved = conversation_dir.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if conversation_dir.exists():
                shutil.rmtree(conversation_dir, ignore_errors=True)

    @staticmethod
    def _append_message(
        db: Session,
        conversation: Conversation,
        role: str,
        content: str | None,
        extra_meta: dict | None = None,
    ) -> ConversationMessage:
        meta = dict(extra_meta) if extra_meta else {}
        meta["created_at"] = cst_now().isoformat()
        message = ConversationMessage(
            conversation_id=conversation.id,
            role=role,
            content=content,
            extra_meta=json.dumps(meta, ensure_ascii=False),
        )
        db.add(message)
        conversation.updated_at = cst_now()
        db.add(conversation)
        db.commit()
        db.refresh(message)
        return message

    @staticmethod
    def _load_history_for_agent(
        db: Session,
        conversation_id: int,
        limit: int,
    ) -> tuple[list[dict[str, str]], int | None]:
        if limit <= 0:
            return [], None
        stmt: Select[tuple[ConversationMessage]] = (
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role.in_(["user", "assistant"]),
            )
            .order_by(ConversationMessage.id.desc())
            .limit(limit)
        )
        messages = list(db.scalars(stmt).all())
        last_input_tokens: int | None = None
        for message in messages:
            if message.role != "assistant" or not message.extra_meta:
                continue
            try:
                meta = json.loads(message.extra_meta)
            except (json.JSONDecodeError, TypeError):
                continue
            usage = meta.get("usage")
            if not isinstance(usage, dict):
                continue
            raw_tokens = usage.get("input_tokens")
            if raw_tokens is not None:
                last_input_tokens = int(raw_tokens)
                break
        payload = []
        for message in reversed(messages):
            if not message.content:
                continue
            payload.append({"role": message.role, "content": message.content})
        return payload, last_input_tokens

    @staticmethod
    def _resolve_effective_history_limit(
        settings,
        last_input_tokens: int | None,
    ) -> int:
        """若上一轮 API 报告用量已接近压缩阈值，减少加载的历史条数。"""
        base_limit = settings.chat_history_max_messages
        if last_input_tokens is None:
            return base_limit
        from src.service.model_context import resolve_max_input_tokens

        max_tokens = resolve_max_input_tokens(settings)
        threshold = int(
            max_tokens * settings.summarization_trigger_fraction
        )
        if last_input_tokens >= int(threshold * 0.9):
            return max(4, base_limit // 2)
        return base_limit


    @staticmethod
    def ensure_curator_conversation(db: Session, workspace_id: int):
        """获取或创建总管对话（每工作空间仅一条）。"""
        curator_employee = EmployeeService.ensure_curator_employee(db, workspace_id)
        conv = db.scalars(
            select(Conversation).where(
                Conversation.target_type == "curator",
                Conversation.workspace_id == workspace_id,
            ).limit(1)
        ).first()
        if conv:
            if conv.target_id != curator_employee.id:
                conv.target_id = curator_employee.id
                db.commit()
                db.refresh(conv)
            return ConversationRead.model_validate(conv)

        conv = Conversation(
            workspace_id=workspace_id,
            target_type="curator",
            target_id=curator_employee.id,
            title="总管对话",
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)
        return ConversationRead.model_validate(conv)


    @staticmethod
    def _extract_text_from_chunk(value: Any) -> str:
        """从 v2 格式的 serializable_chunk 中提取文本内容。

        v2 格式: {"type": "messages", "ns": [], "data": [[AIMessageChunk序列化, metadata]]}
        只处理 type=messages 的事件，从 data[0] 中提取 content 文本。
        """
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            # v2 格式：顶层是 {"type": ..., "data": ...}
            if "type" in value and "data" in value:
                if value["type"] != "messages":
                    return ""
                data = value["data"]
                if not isinstance(data, list) or len(data) == 0:
                    return ""
                return ChatService._extract_text_from_chunk(data[0])
            # 递归处理 kwargs 等嵌套 dict
            text_parts: list[str] = []
            for key, item in value.items():
                if key in {"content", "text"}:
                    text_parts.append(ChatService._extract_text_from_chunk(item))
                elif key in {"kwargs"}:
                    text_parts.append(ChatService._extract_text_from_chunk(item))
            return "".join(text_parts)
        if isinstance(value, list):
            return "".join(ChatService._extract_text_from_chunk(item) for item in value)
        return ""

    @staticmethod
    async def stream_conversation_answer(
        db: Session,
        conversation_id: int,
        question: str,
        skill_name: str,
        debug_content_only: bool = False,
        extra_meta: dict | None = None,
        auth_token: str | None = None,
    ):
        settings = get_settings()
        
        conversation = ChatService.get_conversation(db, conversation_id)
        history_limit = settings.chat_history_max_messages
        history_messages, last_input_tokens = ChatService._load_history_for_agent(
            db,
            conversation_id=conversation_id,
            limit=history_limit,
        )
        effective_limit = ChatService._resolve_effective_history_limit(
            settings,
            last_input_tokens,
        )
        if effective_limit < history_limit:
            history_messages, last_input_tokens = ChatService._load_history_for_agent(
                db,
                conversation_id=conversation_id,
                limit=effective_limit,
            )
            logger.info(
                "conv=%s history pre-truncated limit %s -> %s (last_input_tokens=%s)",
                conversation_id,
                history_limit,
                effective_limit,
                last_input_tokens,
            )

        ChatService._append_message(db, conversation=conversation, role="user", content=question, extra_meta=extra_meta)
        request_messages = [*history_messages, {"role": "user", "content": question}]

        # 将 extra_meta 中的文件信息注入 agent 上下文的 question（不污染 DB 中的原始消息）
        if extra_meta and extra_meta.get("files"):
            file_lines = [f"- {f.get('name', f['path'])} (路径: {f['path']})" for f in extra_meta["files"]]
            file_context = "[上传的文件]:\n" + "\n".join(file_lines)
            question = file_context + "\n\n" + question
            request_messages[-1] = {"role": "user", "content": question}
        
        # 创建一个空的 assistant 消息占位（不标记 streaming 状态，
        # 等 registry.start 成功后再标记，避免 start 失败时留下僵尸消息）
        assistant_msg = ChatService._append_message(
            db,
            conversation=conversation,
            role="assistant",
            content="",
            extra_meta=None,
        )
        
        # 根据会话ID获取会话详情，然后获取root_path
        workspace = db.get(Workspace, conversation.workspace_id)
        if not workspace:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。")
        
        target_type = conversation.target_type
        target_id = conversation.target_id
        if target_type == "curator":
            # 注入 @mention 上下文，告知 orchestrator 用户指定了哪些员工
            if extra_meta and extra_meta.get("mentions"):
                names = [m.get("name") or f"ID:{m.get('id')}" for m in extra_meta["mentions"]]
                ids = [str(m["id"]) for m in extra_meta["mentions"] if m.get("id")]
                mention_context = (
                    f"用户指定了以下员工来执行此任务：{', '.join(names)}"
                    f"（员工ID: {', '.join(ids)}）。"
                    f"请优先将任务分配给这些被@的员工。\n\n"
                )
                question = mention_context + question

            from src.service.agent.orchestrator import get_orchestrator_agent
            agent = get_orchestrator_agent(
                workspace_id=conversation.workspace_id,
                db=db,
                conversation_id=conversation_id,
                employee_id=target_id,
                auth_token=auth_token,
            )
            request_messages = [*history_messages, {"role": "user", "content": question}]
        elif target_type == "employee":
            employee = db.get(Employee, target_id)
            if not employee:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")
            skills_path_payload = employee.skills_json
            try:
                skills_path = ChatService.resolve_employee_skills_dir(
                    skills_payload=skills_path_payload,
                    employee_id=employee.id if target_type == "employee" else None,
                    employee_name=employee.name if target_type == "employee" else None,
                    employee_code=employee.employee_code if target_type == "employee" else None,
                )
            except HTTPException:
                skills_path = ""
            root_path = settings.artifacts_path
            agent = get_agent(skills_path, root_path, employee_id=employee.id if target_type == "employee" else None, conversation_id=conversation_id)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_type 仅支持 employee、group 或 curator。")
        
        try:
            skill_question = question
            if skill_name and target_type != "curator":
                skill_question = f"请使用{skill_name}技能回答这个问题：{question}"
            if request_messages:
                request_messages[-1] = {"role": "user", "content": skill_question}
            
            from src.service.stream_registry import registry
            
            # 启动后台任务
            run_config: dict = {
                "configurable": {"thread_id": conversation_id},
            }
            if last_input_tokens is not None:
                run_config["configurable"]["last_reported_input_tokens"] = (
                    last_input_tokens
                )
            started = registry.start(
                conversation_id=conversation_id,
                agent=agent,
                messages=request_messages,
                config=run_config,
                stream_msg_id=assistant_msg.id,
                skill_name=skill_name,
                debug_content_only=debug_content_only,
            )
            
            if not started:
                assistant_msg.stream_state = "error"
                assistant_msg.content = "当前会话已有正在执行的任务"
                db.commit()
                yield f"data: {json.dumps({'error': '当前会话已有正在执行的任务'}, ensure_ascii=False)}\n\n"
                return

            assistant_msg.stream_state = "streaming"
            conversation.status = "running"
            db.commit()
            try:
                from src.service.workspace_events import WorkspaceEventBus, CONVERSATION_STATUS_CHANGED
                WorkspaceEventBus.push(conversation.workspace_id, {
                    "type": CONVERSATION_STATUS_CHANGED,
                    "conversation_id": conversation_id,
                    "target_type": conversation.target_type,
                    "target_id": conversation.target_id,
                    "status": "running",
                })
            except Exception:
                logger.warning("push start conversation_status_changed failed conv=%s", conversation_id, exc_info=True)
            db.refresh(assistant_msg)
                
            # 返回恢复流的生成器
            async for chunk in ChatService.resume_conversation_stream(db, conversation_id, debug_content_only):
                yield chunk
                
        except Exception as e:
            logger.error("流式对话执行失败: %s", e, exc_info=True)
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    @staticmethod
    async def resume_conversation_stream(db: Session, conversation_id: int, debug_content_only: bool = False):
        """恢复流式会话，全量回放 buffer 历史后衔接实时事件。"""
        from src.service.stream_registry import registry
        import asyncio

        logger.info("[resume] conv=%s debug=%s", conversation_id, debug_content_only)

        status_info = registry.get_stream_status(conversation_id, db)
        if status_info:
            logger.info("[resume] conv=%s stream already ended: status=%s", conversation_id, status_info)
            yield f"data: {json.dumps({'type': 'stream_ended', 'data': {'status': status_info['status'], 'error': status_info.get('error'), 'cursor': status_info.get('cursor', 0)}}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        task = registry.get_task(conversation_id)
        if not task or not task.is_active:
            if not task:
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
                stale_msg = db.scalar(stmt)
                if stale_msg:
                    logger.warning(
                        "[resume] conv=%s stale streaming message msg_id=%s, auto-repairing to error",
                        conversation_id, stale_msg.id,
                    )
                    stale_msg.stream_state = "error"
                    stale_msg.content = stale_msg.content or "流已中断，无法恢复"
                    db.commit()
                    yield f"data: {json.dumps({'type': 'stream_ended', 'data': {'status': 'error', 'error': '流已中断，无法恢复'}}, ensure_ascii=False)}\n\n"
                    yield "data: [DONE]\n\n"
                    return

            logger.info("[resume] conv=%s no active task (task=%s, status=%s)", conversation_id, bool(task), task.status if task else None)
            yield f"data: {json.dumps({'type': 'no_stream', 'data': {'message': '无可恢复的流'}}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        logger.info("[resume] conv=%s subscribing to live task, buffer_cursor=%d", conversation_id, task.buffer.cursor)

        _to_thread = asyncio.to_thread

        async def _emit_event_payloads(event: dict) -> tuple[bool, list[str]]:
            data = event.get("data")
            if not data:
                return False, []

            seq = event.get("seq")

            def _sse_line(payload: str) -> str:
                return f"id: {seq}\ndata: {payload}\n\n" if seq is not None else f"data: {payload}\n\n"

            if isinstance(data, dict) and data.get("status") in ("completed", "cancelled", "error"):
                payloads: list[str] = []
                if data.get("status") == "error":
                    yield_text = await _to_thread(
                        json.dumps, {"error": data.get("error")}, ensure_ascii=False
                    )
                    payloads.append(_sse_line(yield_text))
                payloads.append(_sse_line("[DONE]"))
                logger.info("[resume] conv=%s terminal event in buffer: seq=%s status=%s", conversation_id, seq, data.get("status"))
                return True, payloads

            if debug_content_only:
                text_part = ChatService._extract_text_from_chunk(data)
                if text_part:
                    return False, [_sse_line(text_part)]
                return False, []
            else:
                payload_str = await _to_thread(
                    json.dumps, data, ensure_ascii=False, default=str
                )
                return False, [_sse_line(payload_str)]

        # Phase 1: 全量回放 buffer 中的所有历史事件
        all_events = list(task.buffer._events)
        last_buffered_seq = task.buffer.cursor
        logger.info("[resume] conv=%s full buffer replay: %d events", conversation_id, len(all_events))
        for event in all_events:
            done, payloads = await _emit_event_payloads(event)
            for payload in payloads:
                yield payload
            if done:
                logger.info("[resume] conv=%s terminated during full buffer replay", conversation_id)
                return

        # Phase 2: 订阅实时事件
        queue = asyncio.Queue(maxsize=5000)

        def _on_event(evt: dict):
            try:
                queue.put_nowait(evt)
            except asyncio.QueueFull:
                data = evt.get("data") if isinstance(evt, dict) else None
                if isinstance(data, dict) and data.get("status") in ("completed", "cancelled", "error"):
                    try:
                        queue.get_nowait()
                        queue.put_nowait(evt)
                    except (asyncio.QueueEmpty, asyncio.QueueFull):
                        pass

        task.subscribe(_on_event)

        # 补扫 subscribe 和 replay 之间新到达的事件
        new_since_scan = [
            e for e in list(task.buffer._events)
            if e["seq"] > last_buffered_seq
        ]
        logger.info("[resume] conv=%s after subscribe, missed=%d events after seq=%d", conversation_id, len(new_since_scan), last_buffered_seq)
        for missed_event in new_since_scan:
            done, payloads = await _emit_event_payloads(missed_event)
            for payload in payloads:
                yield payload
            if done:
                task.unsubscribe(_on_event)
                logger.info("[resume] conv=%s terminated during missed-event scan", conversation_id)
                return

        # Phase 3: 实时 Queue 循环
        logger.info("[resume] conv=%s entering queue.get() loop, waiting for live events...", conversation_id)
        try:
            while True:
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    current_task = registry.get_task(conversation_id)
                    if not current_task or not current_task.is_active:
                        logger.info(
                            "[resume] conv=%s queue.get() timeout and task no longer active, exiting",
                            conversation_id,
                        )
                        break
                    continue
                done, payloads = await _emit_event_payloads(evt)
                for payload in payloads:
                    yield payload
                if done:
                    logger.info("[resume] conv=%s terminated from queue event", conversation_id)
                    break
        finally:
            t = registry.get_task(conversation_id)
            if t:
                t.unsubscribe(_on_event)
            logger.info("[resume] conv=%s unsubscribed", conversation_id)

    @staticmethod
    def cancel_conversation_stream(conversation_id: int) -> bool:
        """手动终止正在执行的会话流。"""
        from src.service.stream_registry import registry
        logger.info("[cancel_service] conv=%s attempting cancel", conversation_id)
        success = registry.cancel(conversation_id)
        if not success:
            logger.warning("[cancel_service] conv=%s registry.cancel returned False (no active task)", conversation_id)
        return success

    @staticmethod
    def reset_conversation_status(db: Session, conversation_id: int) -> None:
        conversation = ChatService.get_conversation(db, conversation_id)
        if conversation.status != "idle":
            conversation.status = "idle"
            db.commit()
            try:
                from src.service.workspace_events import WorkspaceEventBus, CONVERSATION_STATUS_CHANGED
                WorkspaceEventBus.push(conversation.workspace_id, {
                    "type": CONVERSATION_STATUS_CHANGED,
                    "conversation_id": conversation_id,
                    "target_type": conversation.target_type,
                    "target_id": conversation.target_id,
                    "status": "idle",
                })
            except Exception:
                logger.warning("push reset status event failed conv=%s", conversation_id, exc_info=True)


    @classmethod
    def convert_to_serializable(cls, obj: Any, _seen: set[int] = None) -> Any:
        """
        将对象转换为可序列化的格式，优先使用langchain的序列化工具
        """
        if _seen is None:
            _seen = set()
        
        # 检查是否是循环引用
        obj_id = id(obj)
        if obj_id in _seen:
            return {"__type__": "circular_reference", "repr": f"<Circular reference detected: {type(obj).__name__}>"}
        
        # 首先尝试langchain的序列化工具
        try:
            # 尝试导入langchain序列化工具
            from langchain_core.load.dump import dumps
            from langchain_core.load.serializable import Serializable
            
            if isinstance(obj, (Serializable,)) or (hasattr(obj, 'to_json') and callable(getattr(obj, 'to_json'))):
                # 使用langchain的序列化功能
                return json.loads(dumps(obj))
        except ImportError as exc:
            logger.error("langchain_core 序列化不可用: %s", exc, exc_info=True)
            # 如果没有安装langchain_core，尝试langchain
            try:
                from langchain.load.dump import dumps
                from langchain.load.serializable import Serializable
                
                if isinstance(obj, (Serializable,)) or (hasattr(obj, '_as_lc_jsonable') and callable(getattr(obj, '_as_lc_jsonable'))):
                    # 使用langchain的序列化功能
                    return json.loads(dumps(obj))
            except ImportError as exc2:
                logger.error("langchain 序列化不可用: %s", exc2, exc_info=True)
        except Exception as exc:
            logger.error("langchain 序列化失败: %s", exc, exc_info=True)
        
        # 尝试直接序列化
        try:
            json.dumps(obj, ensure_ascii=False)
            return obj
        except (TypeError, ValueError):
            # 添加当前对象到已见集合
            _seen.add(obj_id)
            
            try:
                # 特别处理LangChain的消息对象
                if hasattr(obj, '_lc_kwargs') or hasattr(obj, 'content'):
                    # 这可能是LangChain的消息对象如AIMessage, HumanMessage, ToolMessage等
                    result = {"__type__": type(obj).__name__}
                    if hasattr(obj, 'content'):
                        result['content'] = obj.content
                    if hasattr(obj, 'type'):
                        result['type'] = obj.type
                    if hasattr(obj, 'name'):
                        result['name'] = obj.name
                    if hasattr(obj, 'id'):
                        result['id'] = obj.id
                    if hasattr(obj, 'additional_kwargs'):
                        result['additional_kwargs'] = cls.convert_to_serializable(obj.additional_kwargs, _seen) if obj.additional_kwargs else None
                    if hasattr(obj, 'response_metadata'):
                        result['response_metadata'] = cls.convert_to_serializable(obj.response_metadata, _seen) if obj.response_metadata else None
                    if hasattr(obj, 'tool_calls'):
                        result['tool_calls'] = cls.convert_to_serializable(obj.tool_calls, _seen) if obj.tool_calls else None
                    if hasattr(obj, 'usage_metadata'):
                        result['usage_metadata'] = cls.convert_to_serializable(obj.usage_metadata, _seen) if obj.usage_metadata else None
                    if hasattr(obj, 'tool_call_id'):
                        result['tool_call_id'] = obj.tool_call_id
                    return result
                elif isinstance(obj, (list, tuple)):
                    # 处理列表和元组
                    result = []
                    for item in obj:
                        result.append(cls.convert_to_serializable(item, _seen))
                    return result
                elif isinstance(obj, dict):
                    # 处理字典，递归转换值
                    result = {}
                    for key, value in obj.items():
                        # 确保键是可哈希的
                        try:
                            processed_key = cls.convert_to_serializable(key, _seen)
                            result[processed_key] = cls.convert_to_serializable(value, _seen)
                        except Exception as exc:
                            logger.error(
                                "序列化 dict 键值失败 key=%s: %s",
                                key,
                                exc,
                                exc_info=True,
                            )
                            result[str(key)] = cls.convert_to_serializable(value, _seen)
                    return result
                elif hasattr(obj, '__dict__'):
                    # 对于其他自定义对象，返回其字典表示
                    result = {"__type__": type(obj).__name__}
                    for attr_name, attr_value in obj.__dict__.items():
                        if not callable(attr_value) and not attr_name.startswith('_'):
                            try:
                                result[attr_name] = cls.convert_to_serializable(attr_value, _seen)
                            except Exception as exc:
                                logger.error(
                                    "序列化对象属性失败 %s: %s",
                                    attr_name,
                                    exc,
                                    exc_info=True,
                                )
                                result[attr_name] = str(attr_value)
                    return result
                elif type(obj).__name__ == 'Overwrite':
                    # 特殊处理Overwrite对象 - 尝试提取其值
                    if hasattr(obj, 'value'):
                        return {
                            '__type__': 'Overwrite',
                            'value': cls.convert_to_serializable(obj.value, _seen)
                        }
                    else:
                        return {"__type__": "Overwrite", "repr": str(obj)}
                elif type(obj).__name__ in ['Append', 'Graph']:
                    # 其他特殊处理的对象
                    return {"__type__": type(obj).__name__, "repr": str(obj)}
                elif hasattr(obj, '__iter__') and not isinstance(obj, (str, bytes)):
                    # 处理其他可迭代对象
                    try:
                        return [cls.convert_to_serializable(item, _seen) for item in obj]
                    except Exception as exc:
                        logger.error(
                            "序列化可迭代对象失败: %s", exc, exc_info=True
                        )
                        return {"__type__": "iterable", "repr": str(obj)}
                else:
                    return {"__type__": "unknown", "repr": repr(obj)}
            finally:
                # 从已见集合中移除当前对象
                _seen.discard(obj_id)
