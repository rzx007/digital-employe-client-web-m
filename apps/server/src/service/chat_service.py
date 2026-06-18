from __future__ import annotations
import asyncio
import logging
import os
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from src.core.config import get_settings
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
from src.service.product_paths import resolve_conversation_product_root
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend
from langchain_openai import ChatOpenAI
from datetime import datetime  # 导入datetime模块
from urllib.request import urlopen
from deepagents.backends.utils import create_file_data
from langgraph.checkpoint.memory import MemorySaver
from src.service.agent import delete_conversation_checkpoint, get_agent


logger = logging.getLogger(__name__)


async def _commit_db_off_loop(db: Session) -> None:
    """把同步 db.commit() 放到 DB 写线程，避免阻塞事件循环。

    SQLite 写锁竞争时 commit 可阻塞 30s，期间事件循环无法调度任何协程/I/O，
    导致 agent.astream() 无法发起 httpx 请求、run_coro_on_main_loop 超时。
    """
    from src.service.stream_registry import _DB_WRITE_EXECUTOR

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(_DB_WRITE_EXECUTOR, db.commit)


async def _refresh_db_off_loop(db: Session, obj: Any) -> None:
    """把同步 db.refresh() 放到 DB 写线程，避免阻塞事件循环。"""
    from src.service.stream_registry import _DB_WRITE_EXECUTOR

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(_DB_WRITE_EXECUTOR, db.refresh, obj)


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
            ws = db.get(Workspace, workspace_id)
            owner = ws.user_id if ws is not None else None
            if not employee or employee.user_id != owner:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")
            return
        if target_type == "group":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="群组功能已下线。")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_type 仅支持 employee 或 curator。")

    @staticmethod
    def create_conversation(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
        title: str | None,
    ) -> Conversation:
        ChatService._validate_target(db, workspace_id, target_type, target_id)
        ws = db.get(Workspace, workspace_id)
        _uid = ws.user_id if ws is not None else None
        if _uid is None:
            # owner 缺失（workspace 不存在/未认领）→ 会话进不了用户级侧边栏(list_user_conversations)
            # 的 WHERE user_id 过滤，成为孤儿。正常不该发生（离线默认用户 "1"、空间建时即认领）。
            logger.warning(
                "create_conversation: workspace_id=%s 缺 owner，会话将以 user_id=None 落库（孤儿）",
                workspace_id,
            )
        conversation = Conversation(
            workspace_id=workspace_id,
            user_id=_uid,
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
        # 故意保持 workspace+target 级：批量删除(adelete_conversations_by_target)依赖此范围，
        # 改成 user 级会跨项目误删。跨项目的用户级侧边栏列表见 list_user_conversations。
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
        return convs

    @staticmethod
    def list_user_conversations(
        db: Session, user_id: str, target_type: str | None = None
    ) -> list[Conversation]:
        """列出某用户的全部会话（跨工作空间/项目），每条带其 workspace_id。"""
        stmt = select(Conversation).where(Conversation.user_id == user_id)
        if target_type is not None:
            stmt = stmt.where(Conversation.target_type == target_type)
        stmt = stmt.order_by(Conversation.updated_at.desc(), Conversation.id.desc())
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

        # file 后端：用进度 sidecar 覆盖在流消息的瞬时 state/cursor/content（更新鲜）。
        # 终态落库后 sidecar 已删，历史消息读不到文件 → 走行上永久值。overlay 仅供
        # 序列化展示，expunge_all 防止内存改动被 flush 回 DB（终态才是唯一落库点）。
        from src.core.config import get_settings

        if get_settings().stream_progress_backend != "sqlite":
            from src.service.stream_progress_store import get_progress_store

            store = get_progress_store()
            overlaid = False
            for m in messages:
                if m.role != "assistant":
                    continue
                prog = store.read(m.id)
                if not prog:
                    continue
                if prog.get("stream_state") is not None:
                    m.stream_state = prog["stream_state"]
                if prog.get("stream_cursor") is not None:
                    m.stream_cursor = prog["stream_cursor"]
                if prog.get("content") is not None:
                    m.content = prog["content"]
                overlaid = True
            if overlaid:
                db.expunge_all()

        return messages

    @staticmethod
    async def adelete_conversation(
        db: Session, conversation_id: int, *, cascade_artifacts: bool = True
    ) -> None:
        # 产物现为项目级共享(SP2)：一个项目下所有会话共用同一份
        # `<product_root>/{artifacts,uploads,skills-draft}`（含 uploads），删单个会话
        # 不能删这些共享产物——否则会抹掉同项目其它会话仍在引用的产物。
        # 因此本方法只清理「会话私有态」：DB 行（含级联消息）、checkpoint、
        # 以及 stream/registry 取消；不再 rmtree 任何产物目录。
        # 整个项目的产物随 WorkspaceService.delete_workspace 统一清理。
        # `cascade_artifacts` 参数保留（API `cascade` 查询参数 + 批量删除调用方仍传入），
        # 但在新扁平共享模型下对共享产物目录无操作——故意 no-op，不再删任何磁盘目录。
        from src.service.stream_registry import registry

        registry.cancel(conversation_id)
        await delete_conversation_checkpoint(conversation_id)

        conversation = ChatService.get_conversation(db, conversation_id)

        db.delete(conversation)
        db.commit()

    @staticmethod
    async def adelete_conversations_by_target(
        db: Session,
        workspace_id: int,
        target_type: str,
        target_id: int,
        *,
        cascade_artifacts: bool = True,
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
                await ChatService.adelete_conversation(
                    db, conv_id, cascade_artifacts=cascade_artifacts
                )
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
        # 注意：不再在此处 commit/refresh，由调用方统一提交（避免事件循环上同步 SQLite 写）
        return message

    @staticmethod
    def _load_history_for_agent(
        db: Session,
        conversation_id: int,
        limit: int,
        artifacts_root: str | Path,
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
                artifacts_root=artifacts_root,
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
    def ensure_curator_conversation(
        db: Session, user_id: str | None, workspace_id: int
    ):
        """获取或创建默认总管会话（每用户·每工作空间至少一条，允许多条 curator 会话并存）。"""
        curator_employee = EmployeeService.ensure_curator_employee(
            db, user_id, workspace_id
        )
        from sqlalchemy import case

        conv = db.scalars(
            select(Conversation)
            .where(
                Conversation.target_type == "curator",
                Conversation.workspace_id == workspace_id,
                Conversation.user_id == user_id,
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
            user_id=user_id,
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

        # 阶段计时：first-yield 前全是同步调用，任一步阻塞都会卡住事件循环→所有请求一起卡。
        # 这组 [stream-phase] 日志精确钉出卡在哪一步（构建 agent / 加载历史 / request_start / ...）。
        import time as _time

        _t_start = _time.monotonic()
        _t_last = _t_start

        def _phase(name: str):
            nonlocal _t_last
            _now = _time.monotonic()
            logger.info(
                "[stream-phase] conv=%s %s (本段 +%.3fs, 累计 %.3fs)",
                conversation_id, name, _now - _t_last, _now - _t_start,
            )
            _t_last = _now

        _phase("enter")
        conversation = ChatService.get_conversation(db, conversation_id)
        _phase("got_conversation")

        # SP2：产物落会话所钉项目根（uploads/artifacts 直挂其下），不再用全局 artifacts_path。
        product_root = resolve_conversation_product_root(db, conversation)

        history_limit = settings.chat_history_max_messages
        history_messages, last_input_tokens = ChatService._load_history_for_agent(
            db,
            conversation_id=conversation_id,
            limit=history_limit,
            artifacts_root=product_root,
        )
        _phase(f"loaded_history(n={len(history_messages)}, last_input_tokens={last_input_tokens})")
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
        # 两条消息都已 add 到 session，统一一次 commit（不阻塞事件循环）
        await _commit_db_off_loop(db)
        await _refresh_db_off_loop(db, assistant_msg)
        _phase("appended_user+assistant_msg+commit")

        # 根据会话ID获取会话详情，然后获取root_path
        workspace = db.get(Workspace, conversation.workspace_id)
        if not workspace:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。")
        
        target_type = conversation.target_type
        target_id = conversation.target_id
        _phase(f"building_agent(target_type={target_type})")
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
            # 注意：必须在本协程上下文同步构建——get_orchestrator_agent 内部用 ContextVar
            # (_db_session_ctx) 绑定 db，挪到线程池会绑到工作线程上下文、后台任务读不到
            # → "orchestrator DB session not set"。构建耗时优化走「缓存 agent」而非线程池。
            agent = get_orchestrator_agent(
                workspace_id=conversation.workspace_id,
                db=db,
                conversation_id=conversation_id,
                employee_id=target_id,
                auth_token=auth_token,
                user_id=conversation.user_id,
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
            # SP2：员工对话产物根 = 会话所钉项目根（取代全局 settings.artifacts_path）；
            # Phase3 已拍平为项目级扁平共享三桶（artifacts/uploads/skills-draft）。
            root_path = product_root
            agent = get_agent(
                skills_path,
                root_path,
                employee_id=employee.id if target_type == "employee" else None,
                conversation_id=conversation_id,
            )
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_type 仅支持 employee 或 curator。")
        _phase("built_agent")

        try:
            skill_question = question
            if skill_name and target_type != "curator":
                skill_question = f"请使用{skill_name}技能回答这个问题：{question}"
            user_content = build_user_agent_content(
                skill_question,
                extra_meta.get("files") if extra_meta else None,
                artifacts_root=product_root,
                conversation_id=conversation_id,
            )
            # 技能预路由（软提示，尾部注入；不碰系统前缀=不伤 prefill）。仅 employee
            # 自动模式（未显式 skill_name）；任何异常退化为不注入，绝不影响正常对话。
            try:
                if (
                    target_type == "employee"
                    and settings.agent_skill_preroute
                    and not skill_name
                ):
                    from src.service.agent.paths import (
                        list_available_skills,
                        resolve_skills_root,
                    )
                    from src.service.agent.skill_prerouter import (
                        build_route_hint,
                        match_skills,
                    )

                    _avail = list_available_skills(resolve_skills_root(skills_path))
                    _hint = build_route_hint(match_skills(question, _avail))
                    if _hint:
                        user_content = f"{user_content}{_hint}"
            except Exception:
                logger.warning("skill preroute failed, skip", exc_info=True)
            request_messages.append({"role": "user", "content": user_content})
            _phase("built_user_content")

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
                # 用户主动发消息=明确放弃上一轮：抢占本会话仍在跑/卡死但未到超时墙的旧流，
                # 不让用户干等 3-5 分钟才能重试（见 stream_registry.request_start preempt）。
                preempt=True,
            )
            _phase(f"request_start_returned({start_result})")

            if start_result == StartResult.REJECTED:
                assistant_msg.stream_state = "error"
                assistant_msg.content = "当前会话已有正在执行的任务"
                await _commit_db_off_loop(db)
                yield f"data: {json.dumps({'error': '当前会话已有正在执行的任务'}, ensure_ascii=False)}\n\n"
                return

            assistant_msg.stream_state = (
                "queued" if start_result == StartResult.QUEUED else "streaming"
            )
            conversation.status = "running"
            await _commit_db_off_loop(db)
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
            await _refresh_db_off_loop(db, assistant_msg)
            _phase("marked_running+pushed+refresh")

            if start_result == StartResult.QUEUED:
                queued_payload = {
                    "type": "agent_queued",
                    "data": {},
                    "position": registry.queue_depth(),
                    "message": "已加入执行队列，等待其他对话完成",
                }
                yield f"data: {json.dumps(queued_payload, ensure_ascii=False)}\n\n"

            # 返回恢复流的生成器
            _phase("entering_resume_stream(以下进入实时流；若卡在这之后=卡在 buffer 回放/等首包)")
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
                    # 同步 json.dumps：JSON 序列化是持 GIL 的 CPU 活，丢进 asyncio 默认
                    # 线程池只增加调度开销、且会与「模型异步建连(anyio 在某些操作上需 worker
                    # 线程)」「群派活 to_thread」抢同一个无大小限制的默认池。runaway 流(单条
                    # 流可产上万事件、单 payload 达数十万字符)反复回放时，海量 to_thread 把默认
                    # 池占满 → 新对话的 model 调用在 pre-httpx 阶段拿不到线程而永久挂死。
                    yield_text = json.dumps({"error": data.get("error")}, ensure_ascii=False)
                    payloads.append(_sse_line(yield_text))
                if data.get("status") == "interrupted":
                    interrupt_json = json.dumps(data, ensure_ascii=False, default=str)
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
                # 同理改同步，避免每个实时 chunk 一次 to_thread 毒化默认线程池（见上）。
                payload_str = json.dumps(data, ensure_ascii=False, default=str)
                return False, [_sse_line(payload_str)]

        # Phase 1: 回放 buffer 历史事件。带 after_seq 时只回放它之后的增量；
        # 不带 cursor（冷启，after_seq=None）时**全量回放整个 buffer**——streaming 中
        # 前端不渲染 DB content，进行中内容全靠这次冷回放从头重建，截断前面会让画面
        # 从中间冒字、显示残缺，所以这里必须从头放全。
        all_events = list(task.buffer._events)
        if after_seq is not None:
            all_events = [e for e in all_events if e.get("seq", 0) > after_seq]
        else:
            # 冷启（前端未带 cursor）默认全量重放整个 buffer。runaway 流 buffer 可达
            # 上万事件，反复切窗口全量重放会占满线程池/主循环致卡死。冷启回放上限由
            # 系统设置 RESUME_COLD_REPLAY_CAP 控制（<=0 不限制）：超过只回放最近 N 条。
            #
            # 但**正在 streaming 的活流**绝不能截断：用户此刻正切过来看进行中的执行，
            # streaming 中前端不渲染 DB content、完全靠这次冷回放从头重建画面；截掉开头会
            # 让工具调用配对错位、markdown 结构断裂 → 整段渲染残缺（实测"切换查看长任务
            # 漏很多东西"即此因）。故 cap 只对**已结束的历史流**生效（防超长历史反复重放
            # 卡死），活流一律全量回放。
            cold_cap = get_settings().resume_cold_replay_cap
            if task.is_active:
                if cold_cap > 0 and len(all_events) > cold_cap:
                    logger.info(
                        "[resume] conv=%s 活流冷回放全量保留 buffer=%d（>cap %d，"
                        "不截断以保进行中画面完整）",
                        conversation_id, len(all_events), cold_cap,
                    )
            elif cold_cap > 0 and len(all_events) > cold_cap:
                dropped = len(all_events) - cold_cap
                logger.warning(
                    "[resume] conv=%s 冷重放截断 buffer=%d → 只回放最近 %d 条"
                    "（丢弃 %d 早期事件，防切窗口反复全量重放卡死；仅已结束历史流）",
                    conversation_id, len(all_events), cold_cap, dropped,
                )
                all_events = all_events[-cold_cap:]
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
                    # 心跳保活：model 在 token 间隙思考时这条 SSE 长时间无数据，
                    # 中间层（代理/网关）会判连接「空闲」而 buffer 住或掐断——连接仍
                    # ESTABLISHED 但前端 reader.read() 永久 pending（「SSE 还在但收不到」）。
                    # 每次 5s 空转吐一个 SSE 注释行（`: ...`）保活、冲破代理 buffer。
                    # 注释行不带 id/seq、不进 buffer、EventSource 与我方 flushEvent 都忽略它，
                    # 故不影响 after_seq 增量续流与终止判定，只用于让连接「有声音」。
                    yield ": heartbeat\n\n"
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
        await _commit_db_off_loop(db)
        await _refresh_db_off_loop(db, new_msg)
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
                user_id=conversation.user_id,
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
            # SP2：HITL approve 恢复时重建员工 agent，产物根须与流式回合一致，
            # 同样落会话所钉项目根（否则恢复段产物会写回全局根 → 分裂）。
            root_path = resolve_conversation_product_root(db, conversation)
            agent = get_agent(
                skills_path,
                root_path,
                employee_id=employee.id,
                conversation_id=conversation_id,
            )
        else:
            return {"accepted": False, "message": "不支持的 target_type"}

        config = {"configurable": {"thread_id": conversation_id}}

        # 4. 通过 registry approve_and_resume 启动新 task
        from src.service.agent_stream_queue import StartResult

        _is_orch = target_type == "curator"
        start_result = await registry.approve_and_resume(
            conversation_id=conversation_id,
            agent=agent,
            config=config,
            stream_msg_id=new_msg.id,
            decisions=decisions,
            orchestrator_owned_db=None,
            orchestrator_workspace_id=(
                conversation.workspace_id if _is_orch else None
            ),
            orchestrator_conversation_id=(
                conversation_id if _is_orch else None
            ),
            orchestrator_auth_token=(
                auth_token if _is_orch else None
            ),
        )

        if start_result == StartResult.REJECTED:
            new_msg.stream_state = "error"
            new_msg.content = new_msg.content or "恢复执行失败：已有活跃任务"
            await _commit_db_off_loop(db)
            return {"accepted": False, "message": "恢复执行失败：已有活跃任务"}

        new_msg.stream_state = (
            "queued" if start_result == StartResult.QUEUED else "streaming"
        )
        if start_result == StartResult.QUEUED:
            new_msg.content = (
                new_msg.content or "已加入执行队列，等待其他对话完成"
            )
        await _commit_db_off_loop(db)

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
