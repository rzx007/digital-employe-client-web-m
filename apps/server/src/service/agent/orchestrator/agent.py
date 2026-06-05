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

from src.core.config import get_settings, is_agent_virtual_mode
from src.llm.factory import build_chat_model, resolve_output_tokens
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
    build_clarifying_questions_section,
    build_filesystem_prompt_section,
    build_long_document_writing_section,
    build_memory_update_section,
)
from src.service.agent.orchestrator.prompts import (
    ORCHESTRATOR_RUNTIME_CONTEXT_TEMPLATE,
    ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
)
from src.service.agent.orchestrator.runtime import set_context
from src.service.agent.orchestrator.tools import (
    cancel_plan,
    confirm_orchestration_plan,
    create_group_and_dispatch,
    create_orchestration_plan,
    delete_employee,
    delete_employees_batch,
    delete_task,
    delete_tasks_batch,
    get_employee,
    get_market_skill_detail,
    get_workspace_skill_detail,
    hire_employee,
    hire_employees,
    install_builtin_skill,
    install_market_skill,
    list_builtin_skills,
    list_tasks,
    list_workspace_employees,
    list_workspace_skills,
    recruit_employee,
    search_market_skills,
    update_employee,
    update_task,
)
from src.service.context_compression import build_summarization_middleware_stack
from src.service.agent.remember_memory_tool import create_remember_memory_tool
from src.service.agent.get_current_time_tool import get_current_time_tool
from src.service.agent.shell_execute_tool import create_shell_execute_tool
from src.models.workspace import CST
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()

import threading as _threading
from functools import wraps as _wraps

# orchestrator 工具 DB 串行锁（按会话隔离）。根因：组长把一条共享 Session(leader_db)
# 交给并发工具线程用（deepagents 一轮里多个工具走 asyncio.gather 并发执行），多个
# 线程同时在该连接上 execute/fetch → `sqlite3.InterfaceError: bad parameter or other
# API misuse`，组长流崩溃。给 DB 类工具加锁，让同一会话的工具整段(execute+fetch+commit)
# 串行独占连接。用**专用** RLock（非 db.session.SQLITE_ACCESS_LOCK），只串行本会话自己的
# 工具，不阻塞其它流的 flush、不影响成员流。按 conversation_id 隔离，不同组长互不串。
_ORCH_DB_TOOL_LOCKS: dict[int, _threading.RLock] = {}
_ORCH_DB_TOOL_LOCKS_GUARD = _threading.Lock()


def _orch_db_tool_lock():
    from src.service.agent.orchestrator.runtime import get_conversation_id

    try:
        cid = get_conversation_id()
    except Exception:
        cid = None
    key = cid if cid is not None else -1
    with _ORCH_DB_TOOL_LOCKS_GUARD:
        lock = _ORCH_DB_TOOL_LOCKS.get(key)
        if lock is None:
            lock = _ORCH_DB_TOOL_LOCKS[key] = _threading.RLock()
        return lock


def _serialize_db_tool(tool):
    """就地把工具的同步执行包进会话级 DB 锁（幂等；只包 .func，工具均为同步）。"""
    fn = getattr(tool, "func", None)
    if fn is None or getattr(fn, "_orch_db_serialized", False):
        return tool

    @_wraps(fn)
    def _guarded(*args, **kwargs):
        with _orch_db_tool_lock():
            return fn(*args, **kwargs)

    _guarded._orch_db_serialized = True
    try:
        tool.func = _guarded
    except Exception:
        pass  # 工具对象不可改则跳过（不影响功能，仅该工具未串行化）
    return tool


def get_orchestrator_agent(
    workspace_id: int,
    db: Session,
    conversation_id: int | None = None,
    employee_id: int | None = None,
    auth_token: str | None = None,
    *,
    bind_context: bool = True,
    shared_artifacts_dir: str | None = None,
    enable_hitl: bool = True,
    max_output_tokens: int | None = None,
):
    if bind_context:
        set_context(
            db,
            workspace_id,
            conversation_id,
            auth_token=auth_token,
            bind_auth_token=True,
        )

    settings = get_settings()
    # 组长/总管自身的输出（拆解派活/简短汇总）默认 standard 即够；不传则走默认。
    model = build_chat_model(max_tokens=resolve_output_tokens(max_output_tokens))

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
    # 群协作：组长用房间共享产物目录，才能读到成员产出做汇总
    if shared_artifacts_dir:
        artifacts_dir = Path(shared_artifacts_dir)
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
        # 单条 shell 输出上限：从 deepagents 默认 100KB 降到 ~48KB（见 employee.py 同处说明）。
        max_output_bytes=48_000,
    )
    backend = CompositeBackend(default=shell_backend, routes=routes)

    available_skills_str = ", ".join(available_skills) if available_skills else "无"
    # 团队名册（employee_table）与委派执行快照（delegation_executions）原本每轮变化、
    # 注入可缓存前缀会毒化缓存；现移出前缀，改由总管按需用 list_workspace_employees /
    # list_tasks 实时查（这两个工具已挂载）。前缀只保留天级日期 + 总管自身技能两项稳定信息。
    runtime_context = ORCHESTRATOR_RUNTIME_CONTEXT_TEMPLATE.format(
        current_time=datetime.now(CST).strftime("%Y-%m-%d"),
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
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE
        + fs_section
        + build_memory_update_section()
        + build_clarifying_questions_section()
        + build_long_document_writing_section(for_orchestrator=True)
        + runtime_context
    )

    checkpointer = get_checkpointer()

    summarization_mw, summarization_tool_mw = build_summarization_middleware_stack(
        model=model,
        backend=backend,
        settings=settings,
        use_session_history_file=use_session_history,
    )

    # 【二分定位 2026-06-05】临时默认关闭 orchestrator 的 SummarizationMiddleware：
    # 排查“组长模型调用卡在 pre-httpx 的 await、httpx 超时不触发、循环正常”的死锁——
    # 最大嫌疑是上下文大时 summarization 嵌套发模型调用卡住。设 ORCH_SUMMARIZATION=1 恢复。
    # 若关掉后群聊不再卡 → 锁定是 summarization；仍卡 → 排除它，再查别处。
    import os as _os

    _orch_summarization_on = _os.getenv("AGENT_SUMMARIZATION", "0").strip() == "1"
    _orch_middleware = (
        [summarization_mw, summarization_tool_mw] if _orch_summarization_on else []
    )

    shell_execute_tool = create_shell_execute_tool(
        shell_backend, artifacts_dir=str(artifacts_dir)
    )
    remember_memory_tool = create_remember_memory_tool(memories_dir)

    orchestrator_tools: list = [
        shell_execute_tool,
        remember_memory_tool,
        get_current_time_tool,
    ]

    if enable_hitl:
        session_flags = (
            get_session_flags(db, conversation_id) if conversation_id else {}
        )
        interrupt_on = build_orchestrator_interrupt_on(session_flags)
    else:
        # 群组长等「自动驱动、无真人确认」场景：关闭所有 HITL 中断（澄清问题/文档方案/
        # 删除类工具）。否则组长一旦调 submit_clarifying_questions / submit_document_plan /
        # delete_* 就会 interrupt 挂起等人审，群里没人点确认 → 该会话永久停在 interrupted。
        # None = create_deep_agent 默认「无 HITL」（不挂 HumanInTheLoopMiddleware）。
        interrupt_on = None

    agent = create_deep_agent(
        model=model,
        memory=["/agent/AGENTS.md", "/memories/AGENTS.md"],
        skills=["/skills/"],
        tools=[
            *orchestrator_tools,
            # DB 类工具：包会话级串行锁，杜绝并发工具线程同时用共享 leader_db 连接致
            # sqlite3.InterfaceError。非 DB / 走网络的工具（shell/memory/time、市场技能
            # 搜索安装）不包，避免长操作占锁。
            _serialize_db_tool(list_workspace_employees),
            _serialize_db_tool(list_workspace_skills),
            _serialize_db_tool(get_workspace_skill_detail),
            _serialize_db_tool(get_employee),
            _serialize_db_tool(update_employee),
            _serialize_db_tool(delete_employee),
            _serialize_db_tool(delete_employees_batch),
            _serialize_db_tool(recruit_employee),
            _serialize_db_tool(hire_employee),
            _serialize_db_tool(hire_employees),
            _serialize_db_tool(create_orchestration_plan),
            _serialize_db_tool(confirm_orchestration_plan),
            create_group_and_dispatch,
            _serialize_db_tool(update_task),
            _serialize_db_tool(delete_task),
            _serialize_db_tool(delete_tasks_batch),
            _serialize_db_tool(cancel_plan),
            _serialize_db_tool(list_tasks),
            # 用户明确要求总管亲自执行（含长文档）时与员工 agent 相同的 HITL 门
            submit_clarifying_questions,
            submit_document_plan,
            # 技能发现与安装（SkillsMP 仓库 + 内置技能）
            list_builtin_skills,
            _serialize_db_tool(install_builtin_skill),
            search_market_skills,
            get_market_skill_detail,
            install_market_skill,
        ],
        system_prompt=system_prompt,
        backend=backend,
        checkpointer=checkpointer,
        interrupt_on=interrupt_on,
        middleware=_orch_middleware,
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
