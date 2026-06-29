from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.orm import Session

from deepagents import create_deep_agent

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
    get_session_flags,
    resolve_orchestrator_interrupt_on,
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
    build_delegation_execution_context,
)
from src.service.agent.orchestrator.runtime import set_context
from src.service.agent.orchestrator.tools import (
    add_workbench_widget,
    update_workbench_widget,
    cancel_plan,
    confirm_orchestration_plan,
    create_orchestration_plan,
    delete_employee,
    delete_employees_batch,
    delete_task,
    delete_tasks_batch,
    delete_workspace_skill,
    delete_workspace_skills_batch,
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
    redispatch_task,
    search_market_skills,
    update_employee,
    update_task,
)
from src.service.context_compression import build_summarization_middleware_stack
from src.service.agent.remember_memory_tool import create_remember_memory_tool
from src.service.agent.get_current_time_tool import get_current_time_tool
from src.service.agent.web_search import create_web_search_tool
from src.service.agent.shell_execute_tool import (
    create_shell_execute_tool,
    create_shell_kill_tool,
    create_shell_poll_tool,
    create_shell_wait_tool,
)
from src.models.workspace import CST
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()

logger = logging.getLogger(__name__)

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
    user_id: str | None = None,
    bind_context: bool = True,
    enable_hitl: bool = True,
    clarify_only_hitl: bool = False,
    max_output_tokens: int | None = None,
):
    if bind_context:
        set_context(
            db,
            workspace_id,
            conversation_id,
            auth_token=auth_token,
            bind_auth_token=True,
            user_id=user_id,
        )

    settings = get_settings()
    # 组长/总管自身的输出（拆解派活/简短汇总）默认 standard 即够；不传则走默认。
    model = build_chat_model(max_tokens=resolve_output_tokens(max_output_tokens))

    base_dir = SERVICE_DIR
    # SP2: 产物根改为会话所钉项目的 per-project 根（不再全局 settings.artifacts_path）。
    # 有 conversation_id 时优先按会话解析（最精确，且覆盖定时/再入旁路——它们都带 conv_id）；
    # 否则退回按 workspace 解析；workspace 行缺失（已删）时回落孤儿目录，绝不回退 legacy 全局。
    from src.models.conversation import Conversation
    from src.models.workspace import Workspace
    from src.service.agent.workspace_paths import resolve_workspace_product_root
    from src.service.product_paths import (
        orphan_root_for_workspace,
        resolve_conversation_product_root,
    )

    product_root: Path | None = None
    if db is not None:
        if conversation_id is not None:
            _conv = db.get(Conversation, conversation_id)
            if _conv is not None:
                product_root = resolve_conversation_product_root(db, _conv)
        if product_root is None:
            _ws = db.get(Workspace, workspace_id)
            if _ws is not None:
                product_root = resolve_workspace_product_root(_ws.root_path)
    if product_root is None:
        # db is None 仅测试入参；生产恒非空（签名 db: Session）。
        # db 缺失或工作空间已删 → 确定性孤儿目录，绝不回退 legacy 全局产物目录。
        product_root = orphan_root_for_workspace(workspace_id)
    artifacts_path = product_root
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

    # 总管自身的技能源：原固定目录（orchestrator_skills：使用手册/找技能等）之外，
    # 叠加当前工作区的本地技能库（local-skills/<workspace_id>），与员工对称——总管
    # 能给员工装/分配的技能，自己也能直接用，不再「只能分给别人、唯独自己用不了」。
    # 全量自动加载：装了就能用，配合 find-skills 按需发现，无需逐个手动分配。
    orchestrator_skill_sources = [str(skills_root)]
    try:
        from src.service.local_skill_service import LocalSkillService

        workspace_skills_root = LocalSkillService._resolve_local_root(workspace_id)
        if workspace_skills_root.is_dir():
            orchestrator_skill_sources.append(str(workspace_skills_root))
            for name in list_available_skills(workspace_skills_root):
                if name not in available_skills:
                    available_skills.append(name)
    except Exception:  # noqa: BLE001 - 工作区技能解析失败不致命，退回仅固定技能
        pass

    # 总管与员工一致：产物三桶拍平直挂项目产物根。
    # SP2 3.2a/3.2b：共享桌已消解、公共区已收敛——总管与被派员工同写同读 root/artifacts，无需 override。
    from src.service.agent.workspace_paths import resolve_workspace_dirs

    ws = resolve_workspace_dirs(
        root_path=str(artifacts_path),
        base_dir=base_dir,
    )
    artifacts_dir = ws.artifacts_dir
    uploads_dir = ws.uploads_dir if conversation_id else None
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    ws.workspace_dir.mkdir(parents=True, exist_ok=True)
    ws.public_root.mkdir(parents=True, exist_ok=True)
    ws.public_dir.mkdir(parents=True, exist_ok=True)
    if uploads_dir is not None:
        uploads_dir.mkdir(parents=True, exist_ok=True)
    # 会话历史目录（保留旧位置，与摘要 history 一致）
    conversation_dir = (
        artifacts_path / str(conversation_id)
        if conversation_id
        else artifacts_path / "orchestrator"
    )
    conversation_dir.mkdir(parents=True, exist_ok=True)

    # 删虚拟路由：agent 全部用真实绝对路径，由 shell_backend 统管。目录已在上文 mkdir。
    shell_backend = SkillAwareShellBackend(
        root_dir=str(artifacts_dir),
        skills_root=skills_root,
        draft_root=None,
        memories_root=memories_dir,
        uploads_root=uploads_dir,
        workspace_root=ws.workspace_dir,
        public_dir=ws.public_dir,
        public_root=ws.public_root,
        conversation_id=conversation_id,
        workspace_id=workspace_id,
        virtual_mode=is_agent_virtual_mode(),
        inherit_env=True,
        timeout=settings.execute_timeout * 2,
        # 单条 shell 输出上限：从 deepagents 默认 100KB 降到 ~48KB（见 employee.py 同处说明）。
        max_output_bytes=48_000,
    )
    # 删复合路由后端：真实路径全部由 shell-aware 后端兜底。
    backend = shell_backend

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
    # 整盘执行快照：本会话已委派子任务的最新状态，每次用户发消息时随 system prompt 刷新。
    # conversation_id 即 orchestrator_conversation_id；无会话时跳过（空历史不注入）。
    delegation_snapshot = ""
    if conversation_id is not None:
        # 信息性增强：取数失败不应拖垮总管 agent 构建，容错降级为不注入。
        try:
            snapshot_text = build_delegation_execution_context(
                db, workspace_id, conversation_id
            )
        except Exception:
            logger.warning(
                "build_delegation_execution_context failed conv=%s",
                conversation_id,
                exc_info=True,
            )
            snapshot_text = ""
        if snapshot_text:
            delegation_snapshot = (
                "\n\n## 本会话整盘执行快照（随每轮用户消息刷新）\n" + snapshot_text
            )

    system_prompt = (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE
        + fs_section
        + build_memory_update_section()
        + build_clarifying_questions_section()
        + build_long_document_writing_section(for_orchestrator=True)
        + runtime_context
        + delegation_snapshot
    )

    checkpointer = get_checkpointer()

    summarization_mw, summarization_tool_mw = build_summarization_middleware_stack(
        model=model,
        backend=backend,
        settings=settings,
        use_session_history_file=use_session_history,
    )

    # SummarizationMiddleware 与员工侧同源开关 AGENT_SUMMARIZATION（默认开）。
    # 若组长/总管 pre-httpx 长挂可设 AGENT_SUMMARIZATION=0 关闭。
    import os as _os

    _orch_summarization_on = _os.getenv("AGENT_SUMMARIZATION", "1").strip() == "1"
    _orch_middleware = (
        [summarization_mw, summarization_tool_mw] if _orch_summarization_on else []
    )

    shell_execute_tool = create_shell_execute_tool(
        shell_backend, artifacts_dir=str(artifacts_dir)
    )
    remember_memory_tool = create_remember_memory_tool(memories_dir)

    orchestrator_tools: list = [
        shell_execute_tool,
        create_shell_poll_tool(),
        create_shell_wait_tool(),
        create_shell_kill_tool(),
        remember_memory_tool,
        get_current_time_tool,
        create_web_search_tool(),
    ]

    # 工作区外目录写授权：与员工对称接线。登记本会话合法写入根集合 + workspace_id，
    # 供 write_file/edit_file 守卫反查；并挂显式申请工具 request_external_dir_access
    # （已并入 interrupt_on，故 enable_hitl 时调用会被挂起等用户授权）。
    # 后台子任务（enable_hitl=False）暂不挂此守卫：后台路径无人弹卡片授权，
    # 不注册则守卫 fail-open 放行，优先保可用性，待后续支持后台预授权后再收紧。
    # 延迟导入：write_guard_registry 在模块级从 orchestrator.runtime 导入，
    # 若提升为顶层 import 会与 orchestrator/__init__ → agent.py 形成循环导入。
    # 会话外部目录模式（ask/auto/deny）：在构造期读一次，既决定 request 工具的回执
    # 话术，也决定它是否登记在 interrupt_on（auto/deny 时移出=不弹卡）。
    external_dir_mode = "ask"
    if enable_hitl and conversation_id is not None and workspace_id is not None:
        from src.service.agent.external_dir_request_tool import (
            build_request_external_dir_tool,
        )
        from src.service.agent.path_authorization import (
            collect_workspace_roots,
            get_external_dir_mode,
        )
        from src.service.agent.write_guard_registry import register_write_guard

        try:
            external_dir_mode = get_external_dir_mode(db, conversation_id)
        except Exception:  # noqa: BLE001 - 取不到/异常默认 ask（保留弹卡，安全默认）
            external_dir_mode = "ask"

        # 幂等覆盖：register 按 conv_id 覆写旧条目，重建 agent（如 HITL resume）不残留。
        register_write_guard(
            conversation_id,
            roots=collect_workspace_roots(
                str(artifacts_path), skills_root, memories_dir
            ),
            workspace_id=workspace_id,
        )
        orchestrator_tools.append(
            build_request_external_dir_tool(external_dir_mode)
        )
        system_prompt = (
            system_prompt
            + "\n\n写工作区外目录前必须先调用 request_external_dir_access(path=目标父目录)"
            "申请授权，获批后再写；未获授权时 write_file 会被拒绝。"
        )

    session_flags = (
        get_session_flags(db, conversation_id)
        if (enable_hitl and conversation_id)
        else {}
    )
    interrupt_on = resolve_orchestrator_interrupt_on(
        enable_hitl=enable_hitl,
        clarify_only_hitl=clarify_only_hitl,
        session_flags=session_flags,
    )
    # mode=auto/deny 时把 request_external_dir_access 移出 interrupt_on（不挂起、不弹卡）；
    # ask 时保留弹卡。interrupt_on 为 None（无 HITL）时无需处理。
    if interrupt_on is not None:
        from src.service.agent.external_dir_request_tool import (
            strip_external_dir_interrupt,
        )

        interrupt_on = strip_external_dir_interrupt(interrupt_on, external_dir_mode)

    agent = create_deep_agent(
        model=model,
        memory=[str(base_dir / "AGENTS.md"), str(memories_dir / "AGENTS.md")],
        skills=orchestrator_skill_sources,
        tools=[
            *orchestrator_tools,
            # DB 类工具：包会话级串行锁，杜绝并发工具线程同时用共享 leader_db 连接致
            # sqlite3.InterfaceError。非 DB / 走网络的工具（shell/memory/time、市场技能
            # 搜索安装）不包，避免长操作占锁。
            _serialize_db_tool(list_workspace_employees),
            _serialize_db_tool(list_workspace_skills),
            _serialize_db_tool(get_workspace_skill_detail),
            _serialize_db_tool(delete_workspace_skill),
            _serialize_db_tool(delete_workspace_skills_batch),
            _serialize_db_tool(get_employee),
            _serialize_db_tool(update_employee),
            _serialize_db_tool(delete_employee),
            _serialize_db_tool(delete_employees_batch),
            _serialize_db_tool(recruit_employee),
            _serialize_db_tool(hire_employee),
            _serialize_db_tool(hire_employees),
            _serialize_db_tool(create_orchestration_plan),
            _serialize_db_tool(confirm_orchestration_plan),
            _serialize_db_tool(update_task),
            _serialize_db_tool(redispatch_task),
            _serialize_db_tool(delete_task),
            _serialize_db_tool(delete_tasks_batch),
            _serialize_db_tool(cancel_plan),
            _serialize_db_tool(list_tasks),
            _serialize_db_tool(add_workbench_widget),
            _serialize_db_tool(update_workbench_widget),
            # 用户明确要求总管亲自执行（含长文档）时与员工 agent 相同的 HITL 门
            submit_clarifying_questions,
            submit_document_plan,
            # 技能发现与安装（ClawHub 镜像市场 + 内置技能）
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
        # 去虚拟路径后用真实绝对路径；FilesystemPermission 仅支持 / 开头虚拟路径 glob，
        # 无法表达 Windows 盘符路径，且与「技能全放开」一致，故不再设写禁用（同 employee）。
        permissions=[],
    )
    return agent
