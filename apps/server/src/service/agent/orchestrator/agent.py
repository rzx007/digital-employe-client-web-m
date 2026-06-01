from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy.orm import Session

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend
from src.service.agent.basic_file_backend import BasicFileFilesystemBackend
from deepagents.middleware.permissions import FilesystemPermission
from deepagents.middleware.summarization import SummarizationToolMiddleware

from src.core.config import get_settings, is_agent_virtual_mode
from src.llm.factory import build_chat_model
from src.service.agent.checkpointer import get_checkpointer
from src.service.agent.paths import (
    SERVICE_DIR,
    ensure_employee_memory_file,
    list_available_skills,
    resolve_employee_memories_dir,
    resolve_orchestrator_skills_root,
)
from src.service.agent.clarifying_questions_tool import submit_clarifying_questions
from src.service.agent.document_plan_tool import submit_document_plan
from src.service.agent.destructive_hitl import (
    build_orchestrator_interrupt_on,
    get_session_flags,
)
from src.service.agent.prompts import (
    build_filesystem_prompt_section,
    build_long_document_writing_section,
    build_memory_update_section,
)
from src.service.agent.orchestrator.prompts import (
    ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
    build_delegation_execution_context,
    build_employee_capability_context,
)
from src.service.agent.orchestrator.runtime import set_context
from src.service.agent.orchestrator.recruitment_tools import (
    hire_employee,
    hire_employees,
    recruit_employee,
)
from src.service.agent.orchestrator.employee_tools import (
    delete_employee,
    get_employee,
    list_workspace_skills,
    get_workspace_skill_detail,
    update_employee,
)
from src.service.agent.orchestrator.tools import (
    cancel_plan,
    confirm_orchestration_plan,
    create_orchestration_plan,
    delete_task,
    delete_tasks_batch,
    install_builtin_skill,
    install_market_skill,
    list_builtin_skills,
    list_tasks,
    list_workspace_employees,
    get_market_skill_detail,
    search_market_skills,
    update_task,
)
from src.service.conversation_summarization import ConversationSummarizationMiddleware
from src.service.model_context import (
    resolve_summarization_keep,
    resolve_summarization_trigger,
)
from src.service.agent.remember_memory_tool import create_remember_memory_tool
from src.service.agent.shell_execute_tool import create_shell_execute_tool
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()


def get_orchestrator_agent(
    workspace_id: int,
    db: Session,
    conversation_id: int | None = None,
    employee_id: int | None = None,
    auth_token: str | None = None,
):
    set_context(
        db,
        workspace_id,
        conversation_id,
        auth_token=auth_token,
        bind_auth_token=True,
    )

    settings = get_settings()
    model = build_chat_model()

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

    skills_root = resolve_orchestrator_skills_root()
    available_skills = list_available_skills(skills_root)
    skills_fs = FilesystemBackend(root_dir=str(skills_root), virtual_mode=True)

    uploads_dir: Path | None = None
    if conversation_id:
        conversation_dir = artifacts_path / str(conversation_id)
        artifacts_dir = conversation_dir / "artifacts"
        uploads_dir = conversation_dir / "uploads"
    else:
        conversation_dir = artifacts_path / "orchestrator"
        artifacts_dir = conversation_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    conversation_dir.mkdir(parents=True, exist_ok=True)
    if uploads_dir is not None:
        uploads_dir.mkdir(parents=True, exist_ok=True)

    agent_fs = FilesystemBackend(root_dir=str(base_dir), virtual_mode=True)
    memories_fs = FilesystemBackend(root_dir=str(memories_dir), virtual_mode=True)
    routes: dict[str, Any] = {
        "/memories/": memories_fs,
        "/skills/": skills_fs,
        "/agent/": agent_fs,
        "/artifacts/": BasicFileFilesystemBackend(
            root_dir=str(artifacts_dir), virtual_mode=True
        ),
    }
    if uploads_dir is not None:
        routes["/uploads/"] = BasicFileFilesystemBackend(
            root_dir=str(uploads_dir), virtual_mode=True
        )
    if use_session_history:
        routes["/conversation_history/"] = FilesystemBackend(
            root_dir=str(conversation_dir),
            virtual_mode=True,
        )

    shell_backend = SkillAwareShellBackend(
        root_dir=str(artifacts_dir),
        skills_root=skills_root,
        draft_root=None,
        memories_root=memories_dir,
        uploads_root=uploads_dir,
        virtual_mode=is_agent_virtual_mode(),
        inherit_env=True,
        timeout=settings.execute_timeout * 2,
    )
    backend = CompositeBackend(default=shell_backend, routes=routes)

    employee_context = build_employee_capability_context(db, workspace_id)
    available_skills_str = ", ".join(available_skills) if available_skills else "无"
    if conversation_id:
        from src.service.orchestrator_execution_summary import (
            backfill_missing_orchestrator_summaries,
        )

        backfill_missing_orchestrator_summaries(
            db, workspace_id, conversation_id, limit=10
        )
    delegation_context = (
        build_delegation_execution_context(
            db, workspace_id, conversation_id, output_max_chars=600
        )
        if conversation_id
        else "（无会话上下文）"
    )
    orchestrator_prompt = ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE.format(
        current_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        employee_table=employee_context,
        delegation_executions=delegation_context,
        available_skills=available_skills_str,
    )
    fs_section = build_filesystem_prompt_section(
        skills_real_path=str(skills_root),
        uploads_real_path=str(uploads_dir) if uploads_dir is not None else "",
        artifacts_real_path=str(artifacts_dir),
        memories_real_path=str(memories_dir),
        agent_real_path=str(base_dir),
        use_session_history=use_session_history,
        virtual_mode=is_agent_virtual_mode(),
    )
    system_prompt = (
        orchestrator_prompt
        + fs_section
        + build_memory_update_section()
        + build_long_document_writing_section(for_orchestrator=True)
    )

    checkpointer = get_checkpointer()

    summarization_mw = ConversationSummarizationMiddleware(
        model=model,
        backend=backend,
        trigger=resolve_summarization_trigger(settings),
        keep=resolve_summarization_keep(settings),
    )
    summarization_mw.use_session_history_file = use_session_history
    summarization_tool_mw = SummarizationToolMiddleware(summarization_mw)

    shell_execute_tool = create_shell_execute_tool(
        shell_backend, artifacts_dir=str(artifacts_dir)
    )
    remember_memory_tool = create_remember_memory_tool(memories_dir)

    orchestrator_tools: list = [shell_execute_tool, remember_memory_tool]

    session_flags = (
        get_session_flags(db, conversation_id) if conversation_id else {}
    )
    interrupt_on = build_orchestrator_interrupt_on(session_flags)

    agent = create_deep_agent(
        model=model,
        memory=["/agent/AGENTS.md", "/memories/AGENTS.md"],
        skills=["/skills/"],
        tools=[
            *orchestrator_tools,
            list_workspace_employees,
            list_workspace_skills,
            get_workspace_skill_detail,
            get_employee,
            update_employee,
            delete_employee,
            recruit_employee,
            hire_employee,
            hire_employees,
            create_orchestration_plan,
            confirm_orchestration_plan,
            update_task,
            delete_task,
            delete_tasks_batch,
            cancel_plan,
            list_tasks,
            # 用户明确要求总管亲自执行（含长文档）时与员工 agent 相同的 HITL 门
            submit_clarifying_questions,
            submit_document_plan,
            # 技能发现与安装（SkillsMP 仓库 + 内置技能）
            list_builtin_skills,
            install_builtin_skill,
            search_market_skills,
            get_market_skill_detail,
            install_market_skill,
        ],
        system_prompt=system_prompt,
        backend=backend,
        checkpointer=checkpointer,
        interrupt_on=interrupt_on,
        middleware=[summarization_mw, summarization_tool_mw],
        subagents=[],
        permissions=[
            FilesystemPermission(
                operations=["write"],
                paths=["/agent/**"],
                mode="deny",
            ),
            FilesystemPermission(
                operations=["write"],
                paths=["/memories/AGENTS.md"],
                mode="deny",
            ),
        ],
    )
    return agent
