from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from sqlalchemy.orm import Session

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend
from deepagents.middleware.permissions import FilesystemPermission
from deepagents.middleware.summarization import SummarizationToolMiddleware

from src.core.config import get_settings
from src.service.agent.checkpointer import get_checkpointer
from src.service.agent.paths import SERVICE_DIR, ensure_employee_memory_file, resolve_employee_memories_dir
from src.service.agent.prompts import build_filesystem_prompt_section
from src.service.agent.orchestrator.prompts import (
    ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    build_employee_capability_context,
)
from src.service.agent.orchestrator.runtime import set_context
from src.service.agent.orchestrator.tools import (
    cancel_plan,
    confirm_orchestration_plan,
    create_orchestration_plan,
    delete_task,
    list_tasks,
    list_workspace_employees,
    update_task,
)
from src.service.conversation_summarization import ConversationSummarizationMiddleware
from src.service.model_context import apply_model_profile, resolve_max_input_tokens
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()


def get_orchestrator_agent(
    workspace_id: int,
    db: Session,
    conversation_id: int | None = None,
    employee_id: int | None = None,
):
    set_context(db, workspace_id, conversation_id)

    settings = get_settings()
    model = ChatOpenAI(
        model=settings.deepagent_model or "qwen2.5-72b-instruct",
        temperature=0,
        api_key=settings.api_key,
        base_url=settings.base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    apply_model_profile(model, resolve_max_input_tokens(settings))

    base_dir = SERVICE_DIR
    artifacts_path = Path(settings.artifacts_path)
    use_session_history = bool(conversation_id)

    memories_dir = resolve_employee_memories_dir(
        employee_id=employee_id,
        skills_root=None,
        base_dir=base_dir,
    )
    memories_dir.mkdir(parents=True, exist_ok=True)
    ensure_employee_memory_file(memories_dir)

    skills_placeholder = memories_dir.parent / "skills"
    skills_placeholder.mkdir(parents=True, exist_ok=True)

    if conversation_id:
        artifacts_dir = artifacts_path / str(conversation_id) / "artifacts"
        conversation_dir = artifacts_path / str(conversation_id)
    else:
        artifacts_dir = artifacts_path / "orchestrator" / "artifacts"
        conversation_dir = artifacts_path / "orchestrator"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    conversation_dir.mkdir(parents=True, exist_ok=True)

    agent_fs = FilesystemBackend(root_dir=str(base_dir), virtual_mode=True)
    memories_fs = FilesystemBackend(root_dir=str(memories_dir), virtual_mode=True)
    routes: dict[str, Any] = {
        "/memories/": memories_fs,
        "/agent/": agent_fs,
        "/artifacts/": FilesystemBackend(
            root_dir=str(artifacts_dir), virtual_mode=True
        ),
    }
    if use_session_history:
        routes["/conversation_history/"] = FilesystemBackend(
            root_dir=str(conversation_dir),
            virtual_mode=True,
        )

    shell_backend = SkillAwareShellBackend(
        root_dir=str(artifacts_dir),
        skills_root=skills_placeholder,
        draft_root=None,
        memories_root=memories_dir,
        virtual_mode=True,
        inherit_env=True,
        timeout=settings.execute_timeout * 2,
    )
    backend = CompositeBackend(default=shell_backend, routes=routes)

    employee_context = build_employee_capability_context(db, workspace_id)
    orchestrator_prompt = ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE.format(
        current_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        employee_table=employee_context,
    )
    fs_section = build_filesystem_prompt_section(
        artifacts_real_path=str(artifacts_dir),
        memories_real_path=str(memories_dir),
        agent_real_path=str(base_dir),
        use_session_history=use_session_history,
    )
    system_prompt = orchestrator_prompt + fs_section

    checkpointer = get_checkpointer()

    summarization_mw = ConversationSummarizationMiddleware(
        model=model,
        backend=backend,
        trigger=("fraction", 0.85),
        keep=("fraction", 0.10),
    )
    summarization_mw.use_session_history_file = use_session_history
    summarization_tool_mw = SummarizationToolMiddleware(summarization_mw)

    agent = create_deep_agent(
        model=model,
        memory=["/agent/AGENTS.md", "/memories/AGENTS.md"],
        tools=[
            list_workspace_employees,
            create_orchestration_plan,
            confirm_orchestration_plan,
            update_task,
            delete_task,
            cancel_plan,
            list_tasks,
        ],
        system_prompt=system_prompt,
        backend=backend,
        checkpointer=checkpointer,
        middleware=[summarization_mw, summarization_tool_mw],
        subagents=[],
        permissions=[
            FilesystemPermission(
                operations=["write"],
                paths=["/agent/**"],
                mode="deny",
            ),
        ],
    )
    return agent
