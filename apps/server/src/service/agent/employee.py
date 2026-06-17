import logging
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from langchain_community.utilities import SQLDatabase
from deepagents import create_deep_agent
from src.core.config import get_settings, is_agent_virtual_mode
from src.llm.factory import build_chat_model, resolve_output_tokens
from src.service.agent.checkpointer import get_checkpointer
from src.service.agent.paths import (
    SERVICE_DIR,
    ensure_employee_memory_file,
    list_available_skills,
    resolve_employee_memories_dir,
    resolve_skills_root,
)
from src.service.agent.prompts import build_system_prompt
from src.service.agent.skill_sources import resolve_builtin_skill_creator_source
from src.service.context_compression import build_summarization_middleware_stack
from src.service.agent.get_current_time_tool import get_current_time_tool
from src.service.agent.shell_execute_tool import create_shell_execute_tool
from src.service.agent.remember_memory_tool import create_remember_memory_tool
from src.service.agent.clarifying_questions_tool import (
    CLARIFYING_QUESTIONS_INTERRUPT_ON,
    submit_clarifying_questions,
)
from src.service.agent.document_plan_tool import submit_document_plan
from src.service.agent.bug_report_tool import submit_bug_report
from src.service.agent.hitl_interrupt_on import HITL_INTERRUPT_ON
from src.models.workspace import CST
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()

logger = logging.getLogger(__name__)


def _augment_skills_with_skill_creator(
    skill_sources: list[str], available_skills: list[str]
) -> tuple[list[str], list[str]]:
    """全员运行时注入 skill-creator：员工已自有则不重复加载，仅保证 available 含之。"""
    new_available = list(available_skills)
    if "skill-creator" in new_available:
        return list(skill_sources), new_available
    src = resolve_builtin_skill_creator_source()
    new_sources = list(skill_sources)
    if src is not None:
        new_sources.append(str(src))
    new_available.append("skill-creator")
    return new_sources, new_available


def get_agent(
    skill_path,
    root_path,
    *,
    employee_id: int | None = None,
    include_sqlite_tools: bool = False,
    conversation_id: int | None = None,
    enable_hitl: bool = True,
    clarify_only_hitl: bool = False,
    max_output_tokens: int | None = None,
):
    # clarify_only_hitl：群「自动确认成员任务」开启时用——成员仍可对「模糊需求」
    # 用 submit_clarifying_questions 挂起等用户作答（澄清不能自动确认），但「文档方案
    # 确认」(submit_document_plan) 不再挂 HITL 中断、自动放行，让群任务全自动跑通。
    # 三态：enable_hitl=全量；clarify_only_hitl=只挂澄清；都为假=完全不挂。
    checkpointer = get_checkpointer()

    # 仅保留到天级：时间戳位于可缓存前缀内，秒级每轮变化会使其后的 KV-cache
    # （剩余 system + 整段 history）全部失效；降到天级后缓存可在一整天内持续命中。
    current_time = datetime.now(CST).strftime("%Y-%m-%d")
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
    # 单请求输出上限（重活/轻活的本质）：派单时按子任务预算传入；缺省走 standard。
    model = build_chat_model(max_tokens=resolve_output_tokens(max_output_tokens))

    from langchain_core.tools import tool

    _session_search_tools: list = []
    if employee_id is not None:

        def _make_session_search(emp_id: int):
            @tool
            def session_search(query: str, limit: int = 5) -> str:
                """搜索历史对话记录。当你需要回忆之前讨论过的内容时使用。"""
                from src.service.session_search import session_search as _search

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

    memories_dir = resolve_employee_memories_dir(
        employee_id=employee_id,
        skills_root=skills_root if employee_id else None,
        base_dir=base_dir,
    )
    memories_dir.mkdir(parents=True, exist_ok=True)
    ensure_employee_memory_file(memories_dir)

    # 员工工作空间模型（SP2 3.1/3.2a）：三桶拍平直挂项目产物根（root/artifacts 等），
    # 全队同写同读 root/artifacts（共享桌已消解）；公共区 root/shared/... 待 3.2b 收口。
    from src.service.agent.workspace_paths import resolve_workspace_dirs

    ws = resolve_workspace_dirs(
        root_path=root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        base_dir=base_dir,
    )
    artifacts_dir = ws.artifacts_dir
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    ws.workspace_dir.mkdir(parents=True, exist_ok=True)
    ws.public_root.mkdir(parents=True, exist_ok=True)
    ws.public_dir.mkdir(parents=True, exist_ok=True)

    draft_dir: Path | None = None
    has_draft_route = False
    uploads_dir: Path | None = None
    if conversation_id and root_path:
        draft_dir = ws.draft_dir
        draft_dir.mkdir(parents=True, exist_ok=True)
        has_draft_route = True
        uploads_dir = ws.uploads_dir
        uploads_dir.mkdir(parents=True, exist_ok=True)

    use_session_history = bool(conversation_id and root_path)
    if use_session_history:
        conversation_dir = Path(root_path) / str(conversation_id)
        conversation_dir.mkdir(parents=True, exist_ok=True)
    else:
        history_root = skills_root.parent if employee_id else base_dir
        history_dir = history_root / "conversation_history"
        history_dir.mkdir(parents=True, exist_ok=True)

    skill_sources = [str(skills_root)]
    if has_draft_route and draft_dir is not None:
        skill_sources.append(str(draft_dir))

    skill_sources, available_skills = _augment_skills_with_skill_creator(
        skill_sources, available_skills
    )

    shell_backend = SkillAwareShellBackend(
        root_dir=str(artifacts_dir),
        skills_root=skills_root,
        draft_root=draft_dir,
        memories_root=memories_dir,
        uploads_root=uploads_dir,
        workspace_root=ws.workspace_dir,
        public_dir=ws.public_dir,
        public_root=ws.public_root,
        conversation_id=conversation_id,
        virtual_mode=is_agent_virtual_mode(),
        inherit_env=True,
        timeout=settings.execute_timeout * 2,
        # 单条 shell 输出上限：从 deepagents 默认 100KB 降到 ~48KB（中文≈24k token），
        # 减少超长输出对上下文/缓存的占用；截断时给可纠偏提示。
        max_output_bytes=48_000,
    )

    # 删复合路由后端：真实路径全部由 shell-aware 后端兜底（spike 确认其已实现
    # read/write/edit/ls_info/download_files）。
    backend = shell_backend

    summarization_mw, summarization_tool_mw = build_summarization_middleware_stack(
        model=model,
        backend=backend,
        settings=settings,
        use_session_history_file=use_session_history,
    )
    # SummarizationMiddleware：token 超阈值 / 检查点 force_context_compact 时嵌套发模型
    # 压缩历史。偶发 pre-httpx 长挂；若复现可设 AGENT_SUMMARIZATION=0 关闭。
    import os as _os

    _summarization_on = _os.getenv("AGENT_SUMMARIZATION", "1").strip() == "1"
    _emp_middleware = (
        [summarization_mw, summarization_tool_mw] if _summarization_on else []
    )

    # 并行子任务总开关（设置页 SUBAGENT_ENABLED，默认开）：关时本中间件按构图时
    # 读到的热值把 `task` 工具从模型可见工具中过滤掉，员工无法 fan-out 子任务。
    # 下一个新会话/新任务生效。
    from src.core.config import read_subagent_enabled
    from src.service.agent.subagent_concurrency import DisableTaskToolMiddleware

    _emp_middleware.append(
        DisableTaskToolMiddleware(enabled=read_subagent_enabled())
    )

    shell_execute_tool = create_shell_execute_tool(
        shell_backend, artifacts_dir=str(artifacts_dir)
    )
    remember_memory_tool = create_remember_memory_tool(memories_dir)
    extra_tools: list = [shell_execute_tool, remember_memory_tool, get_current_time_tool]
    if sql_tools:
        extra_tools.extend(sql_tools)
    extra_tools.extend(_session_search_tools)
    # 工具暴露与是否挂 HITL 中断解耦：clarify_only 时两个 submit 工具仍可用
    # （submit_document_plan 不挂中断=调用即返回、自动放行），但只对澄清挂中断。
    if enable_hitl or clarify_only_hitl:
        extra_tools.extend(
            [submit_clarifying_questions, submit_document_plan, submit_bug_report]
        )

    agent = create_deep_agent(
        model=model,
        memory=[str(base_dir / "AGENTS.md"), str(memories_dir / "AGENTS.md")],
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
            virtual_mode=is_agent_virtual_mode(),
        ),
        backend=backend,
        checkpointer=checkpointer,
        tools=extra_tools,
        interrupt_on=(
            HITL_INTERRUPT_ON
            if enable_hitl
            else (dict(CLARIFYING_QUESTIONS_INTERRUPT_ON) if clarify_only_hitl else {})
        ),
        middleware=_emp_middleware,
        # 去虚拟路径后全部用真实绝对路径；deepagents 的 FilesystemPermission 仅支持
        # `/` 开头的虚拟路径 glob，无法表达 Windows 盘符路径，且与「技能全放开」诉求
        # 一致，故不再设写禁用。如需保护 AGENTS.md，应在 backend.write() 内按路径拦截。
        permissions=[],
    )
    return agent
