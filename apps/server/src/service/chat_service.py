from __future__ import annotations
import logging
import os
import re
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
from src.service.agent import get_agent, is_artifact_file, build_artifact_event


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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_type 仅支持 employee 或 group。")

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
        return list(db.scalars(stmt).all())

    @staticmethod
    def delete_conversation(db: Session, conversation_id: int) -> None:
        conversation = ChatService.get_conversation(db, conversation_id)
        workspace = db.get(Workspace, conversation.workspace_id)
        conversation_memory_root: Path | None = None
        if workspace:
            conversation_memory_root = Path(workspace.root_path) / "conversations" / str(conversation_id)

        db.delete(conversation)
        db.commit()

        if conversation_memory_root and conversation_memory_root.exists():
            shutil.rmtree(conversation_memory_root, ignore_errors=True)

    @staticmethod
    def _append_message(
        db: Session,
        conversation: Conversation,
        role: str,
        content: str | None,
        chunk_json: str | None = None,
        extra_meta: dict | None = None,
    ) -> ConversationMessage:
        message = ConversationMessage(
            conversation_id=conversation.id,
            role=role,
            content=content,
            chunk_json=chunk_json,
            extra_meta=json.dumps(extra_meta, ensure_ascii=False) if extra_meta else None,
        )
        db.add(message)
        conversation.updated_at = cst_now()
        db.add(conversation)
        db.commit()
        db.refresh(message)
        return message

    @staticmethod
    def _load_history_for_agent(db: Session, conversation_id: int, limit: int) -> list[dict[str, str]]:
        if limit <= 0:
            return []
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
        payload = []
        for message in reversed(messages):
            if not message.content:
                continue
            payload.append({"role": message.role, "content": message.content})
        return payload


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
    def _try_extract_artifact(chunk: Any, conversation_id: int, pending_tool_calls: dict) -> dict | None:
        """从 agent.astream v2 chunk 中检测文件操作并生成 artifact 事件。

        v2 格式: {"type": "messages"|"updates", "ns": [...], "data": ...}

        处理两种事件：
        - messages 事件中的 ToolMessage：记录 pending 信息（工具名、file_path、tool_call_id）
        - updates 事件中的 tools files：获取文件完整内容，与 pending 合并后发出 artifact

        Args:
            chunk: agent.astream v2 格式的 dict {"type", "ns", "data"}
            conversation_id: 会话 ID
            pending_tool_calls: 挂起的工具调用映射 {tool_call_id -> {tool_name, file_path}}
        """
        if not isinstance(chunk, dict) or "type" not in chunk or "data" not in chunk:
            return None
        stream_mode = chunk["type"]
        payload = chunk["data"]

        # 处理 messages 事件：检测 write_file / edit_file 的 ToolMessage
        if stream_mode == "messages":
            if not isinstance(payload, (list, tuple)) or len(payload) == 0:
                return None
            message = payload[0]
            msg_type = getattr(message, "type", None)
            if msg_type != "tool":
                return None

            tool_name = getattr(message, "name", None)
            tool_call_id = getattr(message, "tool_call_id", None) or ""
            content = getattr(message, "content", "") or ""

            if tool_name not in ("write_file", "edit_file"):
                return None

            # write_file 返回 "Updated file /path"，edit_file 返回 "Successfully replaced ..."
            file_path = ChatService._extract_file_path_from_tool_output(content)
            if file_path and is_artifact_file(file_path):
                pending_tool_calls[tool_call_id] = {
                    "tool_name": tool_name,
                    "file_path": file_path,
                }
                logger.info("artifact pending: tool=%s file=%s call_id=%s", tool_name, file_path, tool_call_id)
            return None

        # 处理 updates 事件：从 tools.files 中提取文件内容
        if stream_mode == "updates":
            if not isinstance(payload, dict):
                return None
            tools_data = payload.get("tools")
            if not isinstance(tools_data, dict):
                return None
            files = tools_data.get("files")
            if not isinstance(files, dict):
                return None

            for file_path, file_info in files.items():
                if not isinstance(file_info, dict):
                    continue
                file_content = file_info.get("content")
                if file_content is None or not is_artifact_file(file_path):
                    continue

                # 查找匹配的 pending tool call
                tool_call_id = ""
                tool_name = ""
                for tid, info in list(pending_tool_calls.items()):
                    if info["file_path"] == file_path:
                        tool_call_id = tid
                        tool_name = info["tool_name"]
                        del pending_tool_calls[tid]
                        break

                if not tool_call_id:
                    # 没有对应的 pending，用文件路径生成 ID
                    tool_call_id = f"file:{conversation_id}:{file_path}"

                status = "completed" if tool_name == "write_file" or not tool_name else "updated"
                return build_artifact_event(
                    file_path=file_path,
                    content=str(file_content),
                    conversation_id=conversation_id,
                    tool_call_id=tool_call_id,
                    status=status,
                )

            return None

        return None

    @staticmethod
    def _extract_file_path_from_tool_output(content: str) -> str | None:
        """从工具输出文本中提取文件路径。

        write_file 返回 "Updated file /path"
        edit_file 返回 "Successfully replaced N instance(s) of the string in '/path'"
        """
        if not content:
            return None
        # write_file: "Updated file /path"
        if content.startswith("Updated file"):
            return content.replace("Updated file", "").strip() or None
        # edit_file: 匹配单引号中的路径 "Successfully replaced ... in '/path'"
        match = re.search(r"in\s+'([^']+)'", content)
        if match:
            return match.group(1)
        # edit_file: 匹配双引号中的路径
        match = re.search(r'in\s+"([^"]+)"', content)
        if match:
            return match.group(1)
        # edit_file: 匹配 /path 格式
        match = re.search(r"in\s+(/\S+)", content)
        if match:
            return match.group(1)
        return None

    @staticmethod
    async def stream_conversation_answer(
        db: Session,
        conversation_id: int,
        question: str,
        skill_name: str,
        debug_content_only: bool = False,
        extra_meta: dict | None = None,
    ):
        settings = get_settings()
        
        conversation = ChatService.get_conversation(db, conversation_id)
        history_messages = ChatService._load_history_for_agent(
            db,
            conversation_id=conversation_id,
            limit=settings.chat_history_max_messages,
        )

        ChatService._append_message(db, conversation=conversation, role="user", content=question, extra_meta=extra_meta)
        request_messages = [*history_messages, {"role": "user", "content": question}]
        
        # 创建一个空的 assistant 消息，标记为 streaming
        assistant_msg = ChatService._append_message(
            db,
            conversation=conversation,
            role="assistant",
            content="",
            extra_meta=None,
        )
        assistant_msg.stream_state = "streaming"
        db.commit()
        db.refresh(assistant_msg)
        
        # 根据会话ID获取会话详情，然后获取root_path
        workspace = db.get(Workspace, conversation.workspace_id)
        if not workspace:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到工作空间。")
        
        target_type = conversation.target_type
        target_id = conversation.target_id
        if target_type == "employee":
            employee = db.get(Employee, target_id)
            if not employee:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")
            skills_path_payload = employee.skills_json
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_type 仅支持 employee 或 group。")
        
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
        
        try:
            skill_question = question
            if skill_name:
                skill_question = f"请使用{skill_name}技能回答这个问题：{question}"
            if request_messages:
                request_messages[-1] = {"role": "user", "content": skill_question}
            
            from src.service.stream_registry import registry
            
            # 启动后台任务
            started = registry.start(
                conversation_id=conversation_id,
                agent=agent,
                messages=request_messages,
                config={"configurable": {"thread_id": conversation_id}},
                stream_msg_id=assistant_msg.id,
                skill_name=skill_name,
                debug_content_only=debug_content_only,
            )
            
            if not started:
                yield f"data: {json.dumps({'error': '当前会话已有正在执行的任务'}, ensure_ascii=False)}\n\n"
                return
                
            # 返回恢复流的生成器
            async for chunk in ChatService.resume_conversation_stream(db, conversation_id, debug_content_only):
                yield chunk
                
        except Exception as e:
            logger.error("流式对话执行失败: %s", e, exc_info=True)
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    @staticmethod
    async def resume_conversation_stream(db: Session, conversation_id: int, debug_content_only: bool = False):
        """恢复流式会话，从数据库加载历史事件并订阅新事件。"""
        from src.service.stream_registry import registry
        import asyncio
        
        last_seq = 0

        def _emit_event_payloads(event: dict) -> tuple[bool, list[str]]:
            nonlocal last_seq
            if not isinstance(event, dict):
                return False, []
            seq = event.get("seq")
            if isinstance(seq, int):
                if seq <= last_seq:
                    return False, []
                last_seq = seq

            data = event.get("data")
            if not data:
                return False, []
                
            if isinstance(data, dict) and data.get("status") in ("completed", "cancelled", "error"):
                payloads: list[str] = []
                if data.get("status") == "error":
                    yield_text = json.dumps({"error": data.get("error")}, ensure_ascii=False)
                    payloads.append(f"data: {yield_text}\n\n")
                payloads.append("data: [DONE]\n\n")
                return True, payloads
                
            if debug_content_only:
                text_part = ChatService._extract_text_from_chunk(data)
                if text_part:
                    return False, [f"data: {text_part}\n\n"]
                return False, []
            else:
                return False, [f"data: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"]
        
        # 尝试从内存或数据库获取 buffer
        buffer = registry.get_buffer(conversation_id)
        if not buffer:
            buffer = registry.load_buffer_from_db(conversation_id, db)
            
        if not buffer:
            yield "data: [DONE]\n\n"
            return
            
        # 发送历史事件
        for event in buffer.events:
            done, payloads = _emit_event_payloads(event)
            for payload in payloads:
                yield payload
            if done:
                return
                
        # 如果任务仍在运行，订阅新事件
        if registry.is_active(conversation_id):
            queue = asyncio.Queue()
            
            def _on_event(evt: dict):
                queue.put_nowait(evt)
                
            task = registry.get_task(conversation_id)
            if not task:
                yield "data: [DONE]\n\n"
                return
            task.subscribe(_on_event)
            # 补齐订阅窗口期间遗漏事件
            for missed_event in task.buffer.get_events_after(last_seq):
                done, payloads = _emit_event_payloads(missed_event)
                for payload in payloads:
                    yield payload
                if done:
                    return
            
            try:
                while True:
                    evt = await queue.get()
                    done, payloads = _emit_event_payloads(evt)
                    for payload in payloads:
                        yield payload
                    if done:
                        break
            finally:
                task = registry.get_task(conversation_id)
                if task:
                    task.unsubscribe(_on_event)
        else:
            yield "data: [DONE]\n\n"

    @staticmethod
    def cancel_conversation_stream(db: Session, conversation_id: int) -> bool:
        """手动终止正在执行的会话流。"""
        from src.service.stream_registry import registry
        return registry.cancel(conversation_id)


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
