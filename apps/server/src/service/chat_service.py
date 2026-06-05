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
from src.llm.vision import active_model_supports_vision
from src.service.employee_service import EmployeeService
from src.service.agent_message_builder import (
    build_history_user_content,
    build_user_agent_content,
    history_image_budget,
)
from src.service.image_multimodal import LLM_IMAGE_HISTORY_MESSAGE_LIMIT
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
    def update_conversation(
        db: Session,
        conversation_id: int,
        title: str,
    ) -> Conversation:
        conversation = ChatService.get_conversation(db, conversation_id)
        stripped = title.strip()
        if not stripped:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="会话标题不能为空。",
            )
        conversation.title = stripped
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
        convs = list(db.scalars(stmt).all())
        # 过滤掉群协作的内部任务会话：用户在某员工下看到的应是真正的 1:1 会话，
        # 而不是该员工在各个群里被派活产生的任务会话（那些属于群内部）。
        if target_type == "employee":
            convs = ChatService._exclude_group_internal_convs(db, convs)
        return convs

    @staticmethod
    def _exclude_group_internal_convs(
        db: Session, convs: list[Conversation]
    ) -> list[Conversation]:
        """剔除属于群协作的员工任务会话（经 TaskExecutionLog 指向群组长，
        或挂在某 GroupRoomMember 上）。"""
        if not convs:
            return convs
        from src.models.group_room import GroupRoom, GroupRoomMember
        from src.models.task_execution_log import TaskExecutionLog

        conv_ids = [c.id for c in convs]
        internal: set[int] = set()

        # @ 直接派的成员私有会话
        for row in db.execute(
            select(GroupRoomMember.conversation_id).where(
                GroupRoomMember.conversation_id.in_(conv_ids)
            )
        ).all():
            if row[0] is not None:
                internal.add(int(row[0]))

        # 组长编排派的任务会话：其 TaskExecutionLog.orchestrator_conversation_id
        # 指向某房间的组长会话
        leader_conv_ids = {
            int(r[0])
            for r in db.execute(
                select(GroupRoom.leader_conversation_id).where(
                    GroupRoom.leader_conversation_id.isnot(None)
                )
            ).all()
            if r[0] is not None
        }
        if leader_conv_ids:
            for row in db.execute(
                select(
                    TaskExecutionLog.conversation_id,
                    TaskExecutionLog.orchestrator_conversation_id,
                ).where(TaskExecutionLog.conversation_id.in_(conv_ids))
            ).all():
                cid, orch = row[0], row[1]
                if cid is not None and orch in leader_conv_ids:
                    internal.add(int(cid))

        return [c for c in convs if c.id not in internal]

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
    async def adelete_conversations_by_target(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
    ) -> list[int]:
        """按联系人（target）批量删除会话，逐条清理 checkpoint、消息与产物目录。"""
        if target_type == "curator":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不允许批量删除总管会话。",
            )

        conversations = ChatService.list_conversations(
            db, workspace_id, target_type, target_id
        )
        deleted_ids: list[int] = []
        failures: list[tuple[int, str]] = []

        for conversation in conversations:
            conv_id = conversation.id
            try:
                await ChatService.adelete_conversation(db, conv_id)
                deleted_ids.append(conv_id)
            except HTTPException:
                raise
            except Exception as exc:
                logger.error(
                    "Failed to delete conversation %s for target %s:%s: %s",
                    conv_id,
                    target_type,
                    target_id,
                    exc,
                    exc_info=True,
                )
                failures.append((conv_id, str(exc)))

        if failures:
            failed_summary = ", ".join(f"{cid}" for cid, _ in failures)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    f"部分会话删除失败（{len(failures)}/{len(conversations)}），"
                    f"失败 ID: {failed_summary}"
                ),
            )

        return deleted_ids

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
    ) -> tuple[list[dict[str, Any]], int | None]:
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
        allow_images = active_model_supports_vision()
        remaining_image_budget = history_image_budget()
        included_image_messages = 0
        enriched_messages: dict[int, dict[str, Any]] = {}

        for message in messages:
            if message.role != "user" or not message.content:
                continue
            can_include_images = (
                allow_images
                and included_image_messages < LLM_IMAGE_HISTORY_MESSAGE_LIMIT
                and remaining_image_budget > 0
            )
            enriched, used_bytes, included_image = build_history_user_content(
                message,
                artifacts_root=get_settings().artifacts_path,
                conversation_id=conversation_id,
                allow_images=allow_images,
                remaining_byte_budget=(
                    remaining_image_budget if can_include_images else 0
                ),
            )
            enriched_messages[message.id] = enriched
            if included_image:
                included_image_messages += 1
                remaining_image_budget = max(0, remaining_image_budget - used_bytes)

        payload: list[dict[str, Any]] = []
        for message in reversed(messages):
            if not message.content:
                continue
            payload.append(
                enriched_messages.get(
                    message.id,
                    {"role": message.role, "content": message.content},
                )
            )
        return payload, last_input_tokens

    @staticmethod
    def _select_head_tail(
        messages: list[dict[str, Any]],
        limit: int,
        keep_head: int = 4,
    ) -> list[dict[str, Any]]:
        """历史超限时：保留最早 keep_head 条 + 最近 (limit-keep_head) 条，丢弃中间。

        取代旧的"减半重载只留最近一半"——后者丢掉最早几条会使 [system][早段 history]
        的前缀起点整体平移、KV-cache 失效。保头让前缀更稳，同时保住任务锚点（最早的
        目标/设定）。注：语义压缩中间段由 SummarizationMiddleware 在 token 阈值另行处理；
        本函数只做计数级安全截断。
        """
        if limit <= 0:
            return []
        if len(messages) <= limit:
            return messages
        keep_head = max(0, min(keep_head, limit))
        keep_tail = limit - keep_head
        if keep_head == 0:
            return messages[-keep_tail:]
        if keep_tail <= 0:
            return messages[:limit]
        return messages[:keep_head] + messages[-keep_tail:]

    @staticmethod
    def _resolve_effective_history_limit(
        settings,
        last_input_tokens: int | None,
    ) -> int:
        """Reduce loaded message count only in the mid token band.

        When API usage is already near the summarization threshold, load the full
        message window and let SummarizationMiddleware handle semantic compression
        instead of head/tail dropping the middle twice.
        """
        from src.service.model_context import (
            resolve_summarization_token_threshold,
            should_apply_head_tail_truncation,
        )

        base_limit = settings.chat_history_max_messages
        if last_input_tokens is None:
            return base_limit
        if not should_apply_head_tail_truncation(settings, last_input_tokens):
            return base_limit
        threshold = resolve_summarization_token_threshold(settings)
        if last_input_tokens >= int(threshold * 0.6):
            return max(4, base_limit // 2)
        return base_limit


    @staticmethod
    def ensure_curator_conversation(db: Session, workspace_id: int):
        """获取或创建默认总管会话（每工作空间至少一条，允许多条 curator 会话并存）。"""
        curator_employee = EmployeeService.ensure_curator_employee(db, workspace_id)
        from sqlalchemy import case

        conv = db.scalars(
            select(Conversation)
            .where(
                Conversation.target_type == "curator",
                Conversation.workspace_id == workspace_id,
            )
            .order_by(
                case((Conversation.title == "总管对话", 0), else_=1),
                Conversation.id.asc(),
            )
            .limit(1)
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
    async def _stream_group_message(
        db: Session,
        *,
        conversation: Conversation,
        question: str,
        extra_meta: dict | None,
        auth_token: str | None,
    ):
        """群会话消息处理：写时间线 + 解析 @ + 派发成员，返回 SSE 回执。

        群的"流"语义不同于 1:1：用户 SSE 收到的是一条派发回执，
        随后群时间线由各成员投影事件（room_message，经 WorkspaceEventBus）实时驱动，
        前端订阅工作空间事件流即可看到成员陆续交付的结论。
        """
        from src.service.group_room_service import GroupRoomService

        # 1) 立即反馈：用户消息一进来先回一条「已收到，正在安排」，让前端马上有反馈，
        #    不必等 handle_group_message（同步派活、构建组长 agent、启动流，可能几秒+）
        #    整个跑完。否则发消息后会干等、卡住时永远收不到任何回应。
        ack_payload = {
            "type": "group_ack",
            "data": {"message": "已收到，正在安排组长统筹…"},
        }
        yield f"data: {json.dumps(ack_payload, ensure_ascii=False)}\n\n"

        conv_id = conversation.id

        def _dispatch_in_thread() -> dict:
            # 在独立线程用**独立 session**（SQLAlchemy session 非线程安全，不能跨线程
            # 复用请求级 db）。重新取一次 conversation 再派活。
            from src.db.session import get_session_local
            from src.models.conversation import Conversation as _Conv

            tdb = get_session_local()()
            try:
                conv = tdb.get(_Conv, conv_id)
                if conv is None:
                    raise RuntimeError(f"群会话 {conv_id} 不存在")
                return GroupRoomService.handle_group_message(
                    tdb,
                    conv,
                    question,
                    extra_meta=extra_meta,
                    auth_token=auth_token,
                )
            finally:
                tdb.close()

        try:
            # 2) 兜底：派活整体加超时保护。handle_group_message 同步、放线程跑并设
            #    墙钟上限，卡住也能返回错误反馈而不是让用户永远等。
            import asyncio

            summary = await asyncio.wait_for(
                asyncio.to_thread(_dispatch_in_thread),
                timeout=60.0,
            )
            payload = {
                "type": "group_dispatched",
                "data": summary,
            }
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except asyncio.TimeoutError:
            logger.error("群消息派活超时(>60s) conv=%s", conversation.id)
            yield (
                "data: "
                + json.dumps(
                    {"error": "组长安排任务超时，请稍后重试或检查模型服务。"},
                    ensure_ascii=False,
                )
                + "\n\n"
            )
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error("群消息处理失败: %s", e, exc_info=True)
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

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

        # 群协作：群会话没有"单一 agent"，改为路由到被 @ 的成员私有会话，
        # 群时间线通过投影 + WorkspaceEventBus(room_message) 实时更新。
        if conversation.target_type == "group":
            async for chunk in ChatService._stream_group_message(
                db,
                conversation=conversation,
                question=question,
                extra_meta=extra_meta,
                auth_token=auth_token,
            ):
                yield chunk
            return

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
        from src.service.model_context import should_apply_head_tail_truncation

        if (
            should_apply_head_tail_truncation(settings, last_input_tokens)
            and effective_limit < len(history_messages)
        ):
            # 保头+保尾、压中间：不再"减半重载"丢最早几条（那会平移前缀起点、砸 KV-cache），
            # 改为保留已加载窗口最早几条 + 最近若干条；前缀更稳且保住任务锚点。
            # 接近 token 摘要阈值时跳过，避免与 SummarizationMiddleware 双重丢中间。
            history_messages = ChatService._select_head_tail(
                history_messages, effective_limit
            )
            logger.info(
                "conv=%s history head+tail truncated %s -> %s (last_input_tokens=%s)",
                conversation_id,
                history_limit,
                effective_limit,
                last_input_tokens,
            )

        ChatService._append_message(
            db,
            conversation=conversation,
            role="user",
            content=question,
            extra_meta=extra_meta,
        )
        request_messages: list[dict[str, Any]] = [*history_messages]
        
        # 创建一个空的 assistant 消息占位（不标记 streaming 状态，
        # 等 registry.start 成功后再标记，避免 start 失败时留下僵尸消息）
        assistant_msg = ChatService._append_message(
            db,
            conversation=conversation,
            role="assistant",
            content="",
            extra_meta=None,
        )
        db.commit()
        
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
            user_content = build_user_agent_content(
                skill_question,
                extra_meta.get("files") if extra_meta else None,
                artifacts_root=settings.artifacts_path,
                conversation_id=conversation_id,
            )
            request_messages.append({"role": "user", "content": user_content})
            
            from src.service.stream_registry import registry
            from src.service.agent_stream_queue import StartResult
            
            # 启动后台任务
            run_config: dict = {
                "configurable": {"thread_id": conversation_id},
            }
            if last_input_tokens is not None:
                run_config["configurable"]["last_reported_input_tokens"] = (
                    last_input_tokens
                )
            from src.service.context_compression_checkpoint import (
                resolve_checkpoint_compact_reason,
            )

            compact_reason = resolve_checkpoint_compact_reason(
                conversation_id,
                question,
                extra_meta,
            )
            if compact_reason:
                run_config["configurable"]["force_context_compact"] = True
                run_config["configurable"]["context_compact_reason"] = compact_reason
                logger.info(
                    "conv=%s injecting context compact checkpoint reason=%s",
                    conversation_id,
                    compact_reason,
                )
            start_result = registry.request_start(
                conversation_id=conversation_id,
                agent=agent,
                messages=request_messages,
                config=run_config,
                stream_msg_id=assistant_msg.id,
                skill_name=skill_name,
                debug_content_only=debug_content_only,
                orchestrator_workspace_id=(
                    conversation.workspace_id if target_type == "curator" else None
                ),
                orchestrator_conversation_id=(
                    conversation_id if target_type == "curator" else None
                ),
                orchestrator_auth_token=(
                    auth_token if target_type == "curator" else None
                ),
                source="user_chat",
            )
            
            if start_result == StartResult.REJECTED:
                assistant_msg.stream_state = "error"
                assistant_msg.content = "当前会话已有正在执行的任务"
                db.commit()
                yield f"data: {json.dumps({'error': '当前会话已有正在执行的任务'}, ensure_ascii=False)}\n\n"
                return

            assistant_msg.stream_state = (
                "queued" if start_result == StartResult.QUEUED else "streaming"
            )
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

            if start_result == StartResult.QUEUED:
                queued_payload = {
                    "type": "agent_queued",
                    "data": {},
                    "position": registry.queue_depth(),
                    "message": "已加入执行队列，等待其他对话完成",
                }
                yield f"data: {json.dumps(queued_payload, ensure_ascii=False)}\n\n"

            # 返回恢复流的生成器
            async for chunk in ChatService.resume_conversation_stream(db, conversation_id, debug_content_only):
                yield chunk
                
        except Exception as e:
            from src.service.agent.error_messages import format_agent_error_for_user

            logger.error("流式对话执行失败: %s", e, exc_info=True)
            yield f"data: {json.dumps({'error': format_agent_error_for_user(e)}, ensure_ascii=False)}\n\n"

    @staticmethod
    async def resume_conversation_stream(
        db: Session,
        conversation_id: int,
        debug_content_only: bool = False,
        after_seq: int | None = None,
    ):
        """恢复流式会话：从 after_seq 之后增量回放 buffer，再衔接实时事件。

        after_seq=None 时回放整个 buffer（首次进入）；切回会话/重连时前端带上
        已收到的最后一个 seq，只补增量，避免超长输出全量重放压垮前端。
        """
        from src.service.stream_registry import registry
        import asyncio

        logger.info(
            "[resume] conv=%s debug=%s after_seq=%s",
            conversation_id, debug_content_only, after_seq,
        )

        status_info = registry.get_stream_status(conversation_id, db)
        if status_info:
            logger.info("[resume] conv=%s stream already ended: status=%s", conversation_id, status_info)
            if status_info.get("status") == "interrupted":
                yield f"data: {json.dumps({'type': 'stream_ended', 'data': {'status': 'interrupted', 'message_id': status_info.get('message_id')}}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return
            yield f"data: {json.dumps({'type': 'stream_ended', 'data': {'status': status_info['status'], 'error': status_info.get('error'), 'cursor': status_info.get('cursor', 0)}}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        task = registry.get_task(conversation_id)
        if not task or (not task.is_active and task.status != "queued"):
            stmt = (
                select(ConversationMessage)
                .where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                    ConversationMessage.stream_state.in_(("streaming", "queued")),
                )
                .order_by(ConversationMessage.id.desc())
                .limit(1)
            )
            stale_msg = db.scalar(stmt)
            if stale_msg:
                logger.warning(
                    "[resume] conv=%s stale %s message msg_id=%s, returning no_stream (client may retry)",
                    conversation_id,
                    stale_msg.stream_state,
                    stale_msg.id,
                )
                yield f"data: {json.dumps({'type': 'no_stream', 'data': {'message': '流尚未就绪，请稍后重试'}}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

            logger.info(
                "[resume] conv=%s no active task (task=%s, status=%s)",
                conversation_id,
                bool(task),
                task.status if task else None,
            )
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

            if isinstance(data, dict) and data.get("status") in ("completed", "cancelled", "error", "interrupted"):
                payloads: list[str] = []
                if data.get("status") == "error":
                    yield_text = await _to_thread(
                        json.dumps, {"error": data.get("error")}, ensure_ascii=False
                    )
                    payloads.append(_sse_line(yield_text))
                if data.get("status") == "interrupted":
                    interrupt_json = await _to_thread(
                        json.dumps, data, ensure_ascii=False, default=str
                    )
                    payloads.append(_sse_line(interrupt_json))
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

        # Phase 1: 回放 buffer 历史事件。带 after_seq 时只回放它之后的增量，
        # 避免超长输出（上万事件）切回会话时全量重放压垮前端。
        all_events = list(task.buffer._events)
        if after_seq is not None:
            all_events = [e for e in all_events if e.get("seq", 0) > after_seq]
        last_buffered_seq = task.buffer.cursor
        logger.info(
            "[resume] conv=%s buffer replay: %d events (after_seq=%s, total_in_buffer=%d)",
            conversation_id, len(all_events), after_seq, len(task.buffer._events),
        )
        # 历史事件一次性在单个线程里批量序列化，避免逐事件 await to_thread 造成
        # 成百上千次线程切换（超长输出回放会因此极慢、把前端拖卡）。
        def _serialize_history_batch() -> tuple[list[str], bool]:
            out: list[str] = []
            terminated = False
            for ev in all_events:
                data = ev.get("data")
                if not data:
                    continue
                seq = ev.get("seq")
                prefix = f"id: {seq}\n" if seq is not None else ""
                if (
                    isinstance(data, dict)
                    and data.get("status")
                    in ("completed", "cancelled", "error", "interrupted")
                ):
                    if data.get("status") == "error":
                        out.append(
                            prefix
                            + f"data: {json.dumps({'error': data.get('error')}, ensure_ascii=False)}\n\n"
                        )
                    elif data.get("status") == "interrupted":
                        out.append(
                            prefix
                            + f"data: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
                        )
                    out.append(prefix + "data: [DONE]\n\n")
                    terminated = True
                    break
                if debug_content_only:
                    text_part = ChatService._extract_text_from_chunk(data)
                    if text_part:
                        out.append(prefix + f"data: {text_part}\n\n")
                else:
                    out.append(
                        prefix
                        + f"data: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
                    )
            return out, terminated

        history_payloads, history_terminated = await _to_thread(
            _serialize_history_batch
        )
        for payload in history_payloads:
            yield payload
        if history_terminated:
            logger.info(
                "[resume] conv=%s terminated during buffer replay", conversation_id
            )
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
                    if not current_task or (
                        not current_task.is_active
                        and current_task.status != "queued"
                    ):
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
    async def approve_trigger(
        db: Session,
        conversation_id: int,
        message_id: int,
        decisions: list[dict],
        auth_token: str | None = None,
        destructive_hitl: dict | None = None,
    ) -> dict:
        """HITL approve：封存 interrupted 段 + 新建 assistant 行 + resume。"""
        from datetime import datetime, timezone

        from src.service.agent.destructive_hitl import set_skip_destructive_hitl
        from src.service.stream_registry import registry

        conversation = ChatService.get_conversation(db, conversation_id)

        msg = db.get(ConversationMessage, message_id)
        if not msg or msg.conversation_id != conversation_id:
            return {"accepted": False, "message": "消息不存在"}
        if msg.role != "assistant":
            return {"accepted": False, "message": "只能审批 assistant 消息"}
        if msg.stream_state != "interrupted":
            return {"accepted": False, "message": "该消息不在等待审批状态"}

        meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
        if meta.get("approved_at"):
            return {"accepted": False, "message": "该消息已审批"}

        meta["approved_at"] = datetime.now(timezone.utc).isoformat()
        msg.extra_meta = json.dumps(meta, ensure_ascii=False)

        if destructive_hitl and destructive_hitl.get("skip_for_conversation"):
            set_skip_destructive_hitl(db, conversation_id, True)

        new_msg = ChatService._append_message(
            db,
            conversation=conversation,
            role="assistant",
            content="",
            extra_meta=None,
        )
        new_msg.stream_cursor = 0
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
            pass

        # 3. 重建 agent
        settings = get_settings()
        workspace = db.get(Workspace, conversation.workspace_id)
        if not workspace:
            return {"accepted": False, "message": "未找到工作空间"}

        target_type = conversation.target_type
        target_id = conversation.target_id

        if target_type == "curator":
            from src.service.agent.orchestrator import get_orchestrator_agent
            agent = get_orchestrator_agent(
                workspace_id=conversation.workspace_id,
                db=db,
                conversation_id=conversation_id,
                employee_id=target_id,
                auth_token=auth_token,
            )
        elif target_type == "employee":
            employee = db.get(Employee, target_id)
            if not employee:
                return {"accepted": False, "message": "未找到员工"}
            skills_path = ChatService.resolve_employee_skills_dir(
                skills_payload=employee.skills_json,
                employee_id=employee.id,
                employee_name=employee.name,
                employee_code=employee.employee_code,
            )
            root_path = settings.artifacts_path
            agent = get_agent(skills_path, root_path, employee_id=employee.id, conversation_id=conversation_id)
        else:
            return {"accepted": False, "message": "不支持的 target_type"}

        config = {"configurable": {"thread_id": conversation_id}}

        # 4. 通过 registry approve_and_resume 启动新 task
        from src.service.agent_stream_queue import StartResult

        start_result = await registry.approve_and_resume(
            conversation_id=conversation_id,
            agent=agent,
            config=config,
            stream_msg_id=new_msg.id,
            decisions=decisions,
            orchestrator_workspace_id=(
                conversation.workspace_id if target_type == "curator" else None
            ),
            orchestrator_conversation_id=(
                conversation_id if target_type == "curator" else None
            ),
            orchestrator_auth_token=(
                auth_token if target_type == "curator" else None
            ),
        )

        if start_result == StartResult.REJECTED:
            new_msg.stream_state = "error"
            new_msg.content = new_msg.content or "恢复执行失败：已有活跃任务"
            db.commit()
            return {"accepted": False, "message": "恢复执行失败：已有活跃任务"}

        new_msg.stream_state = (
            "queued" if start_result == StartResult.QUEUED else "streaming"
        )
        if start_result == StartResult.QUEUED:
            new_msg.content = (
                new_msg.content or "已加入执行队列，等待其他对话完成"
            )
        db.commit()

        return {
            "accepted": True,
            "resumed": start_result == StartResult.STARTED,
            "queued": start_result == StartResult.QUEUED,
            "approved_message_id": msg.id,
            "assistant_message_id": new_msg.id,
        }

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
