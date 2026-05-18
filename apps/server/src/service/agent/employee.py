import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from langchain_community.utilities import SQLDatabase
from langchain_openai import ChatOpenAI
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend
from deepagents.middleware.permissions import FilesystemPermission
from deepagents.middleware.summarization import SummarizationToolMiddleware

from src.core.config import get_settings
from src.service.agent.checkpointer import get_checkpointer
from src.service.agent.paths import (
    SERVICE_DIR,
    ensure_employee_memory_file,
    list_available_skills,
    resolve_employee_memories_dir,
    resolve_skills_root,
)
from src.service.agent.prompts import build_system_prompt
from src.service.conversation_summarization import ConversationSummarizationMiddleware
from src.service.model_context import (
    apply_model_profile,
    resolve_max_input_tokens,
    resolve_summarization_keep,
    resolve_summarization_trigger,
)
from src.service.agent.shell_execute_tool import create_shell_execute_tool
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()

logger = logging.getLogger(__name__)


def get_agent(
    skill_path,
    root_path,
    *,
    employee_id: int | None = None,
    include_sqlite_tools: bool = False,
    conversation_id: int | None = None,
):
    checkpointer = get_checkpointer()

    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    skills_root = resolve_skills_root(skill_path)
    available_skills = list_available_skills(skills_root)
    logger.info(
        "get_agent skill_path=%s skills_root=%s available_skills=%s employee_id=%s conversation_id=%s",
        skill_path,
        skills_root,
        available_skills,
        employee_id,
        conversation_id,
    )
    base_dir = SERVICE_DIR
    settings = get_settings()
    model = ChatOpenAI(
        model=settings.deepagent_model or "qwen2.5-72b-instruct",
        temperature=0,
        api_key=settings.api_key,
        base_url=settings.base_url
        or "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    apply_model_profile(model, resolve_max_input_tokens(settings))

    from langchain_core.tools import tool

    _session_search_tools: list = []
    if employee_id is not None:

        def _make_session_search(emp_id: int):
            @tool
            def session_search(
                query: str,
                limit: int = 5,
                intent: str | None = None,
            ) -> str:
                """搜索历史对话记录。当你需要回忆之前讨论过的内容时使用。

                参数:
                  intent: 可选，界面展示用中文短句（20字内），如「检索过往讨论」
                """
                from src.service.agent.tool_intent import drop_intent
                from src.service.session_search import session_search as _search

                drop_intent(intent)
                return _search(query=query, employee_id=emp_id, limit=limit)

            return session_search

        _session_search_tools.append(_make_session_search(employee_id))

    sql_tools: list = []
    if include_sqlite_tools:
        try:
            from src.db.session import get_engine

            db_uri = str(get_engine().url)
            sqldb = SQLDatabase.from_uri(db_uri)
            toolkit = SQLDatabaseToolkit(db=sqldb, llm=model)
            sql_tools = list(toolkit.get_tools())
            logger.info(
                "get_agent 已挂载应用 SQLite SQL 工具，共 %s 个工具", len(sql_tools)
            )
        except Exception as exc:
            logger.error("初始化 SQLDatabaseToolkit 失败: %s", exc, exc_info=True)

    skills_fs = FilesystemBackend(root_dir=str(skills_root), virtual_mode=True)
    agent_fs = FilesystemBackend(root_dir=str(base_dir), virtual_mode=True)

    memories_dir = resolve_employee_memories_dir(
        employee_id=employee_id,
        skills_root=skills_root if employee_id else None,
        base_dir=base_dir,
    )
    memories_dir.mkdir(parents=True, exist_ok=True)
    ensure_employee_memory_file(memories_dir)
    memories_fs = FilesystemBackend(root_dir=str(memories_dir), virtual_mode=True)

    if conversation_id and root_path:
        artifacts_dir = Path(root_path) / str(conversation_id) / "artifacts"
    elif employee_id:
        artifacts_dir = skills_root.parent / "artifacts"
    else:
        artifacts_dir = base_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    routes: dict[str, Any] = {
        "/memories/": memories_fs,
        "/skills/": skills_fs,
        "/agent/": agent_fs,
        "/artifacts/": FilesystemBackend(root_dir=str(artifacts_dir), virtual_mode=True),
    }

    draft_dir: Path | None = None
    has_draft_route = False
    if conversation_id and root_path:
        draft_dir = Path(root_path) / str(conversation_id) / "skills-draft"
        draft_dir.mkdir(parents=True, exist_ok=True)
        routes["/skills-draft/"] = FilesystemBackend(
            root_dir=str(draft_dir), virtual_mode=True
        )
        has_draft_route = True

    uploads_dir: Path | None = None
    if conversation_id and root_path:
        uploads_dir = Path(root_path) / str(conversation_id) / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        routes["/uploads/"] = FilesystemBackend(
            root_dir=str(uploads_dir), virtual_mode=True
        )

    use_session_history = bool(conversation_id and root_path)
    if use_session_history:
        conversation_dir = Path(root_path) / str(conversation_id)
        conversation_dir.mkdir(parents=True, exist_ok=True)
        routes["/conversation_history/"] = FilesystemBackend(
            root_dir=str(conversation_dir),
            virtual_mode=True,
        )
    else:
        if employee_id:
            history_root = skills_root.parent
        else:
            history_root = base_dir
        history_dir = history_root / "conversation_history"
        history_dir.mkdir(parents=True, exist_ok=True)
        routes["/conversation_history/"] = FilesystemBackend(
            root_dir=str(history_dir),
            virtual_mode=True,
        )

    skill_sources = ["/skills/", "/skills-draft/"] if has_draft_route else ["/skills/"]

    shell_backend = SkillAwareShellBackend(
        root_dir=str(artifacts_dir),
        skills_root=skills_root,
        draft_root=draft_dir,
        memories_root=memories_dir,
        virtual_mode=True,
        inherit_env=True,
        timeout=settings.execute_timeout * 2,
    )

    backend = CompositeBackend(default=shell_backend, routes=routes)

    summarization_mw = ConversationSummarizationMiddleware(
        model=model,
        backend=backend,
        trigger=resolve_summarization_trigger(settings),
        keep=resolve_summarization_keep(settings),
    )
    summarization_mw.use_session_history_file = use_session_history
    summarization_tool_mw = SummarizationToolMiddleware(summarization_mw)

    shell_execute_tool = create_shell_execute_tool(shell_backend)
    extra_tools: list = [shell_execute_tool]
    if sql_tools:
        extra_tools.extend(sql_tools)
    extra_tools.extend(_session_search_tools)

    agent = create_deep_agent(
        model=model,
        memory=["/agent/AGENTS.md", "/memories/AGENTS.md"],
        skills=skill_sources,
        subagents=[],
        system_prompt=build_system_prompt(
            current_time,
            available_skills,
            has_draft_route=has_draft_route,
            skills_real_path=str(skills_root),
            draft_skills_real_path=str(draft_dir) if draft_dir is not None else "",
            uploads_real_path=str(uploads_dir) if uploads_dir is not None else "",
            artifacts_real_path=str(artifacts_dir),
            memories_real_path=str(memories_dir),
            agent_real_path=str(base_dir),
            use_session_history=use_session_history,
        ),
        backend=backend,
        checkpointer=checkpointer,
        tools=extra_tools,
        middleware=[summarization_mw, summarization_tool_mw],
        permissions=[
            FilesystemPermission(
                operations=["write"],
                paths=["/skills/**", "/agent/**"],
                mode="deny",
            ),
        ],
    )
    return agent
