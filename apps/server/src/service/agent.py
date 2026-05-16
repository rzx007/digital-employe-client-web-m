import logging
import os
from pathlib import Path
from typing import Any
from dotenv import load_dotenv
from langchain_community.utilities import SQLDatabase
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from deepagents.backends import (
    CompositeBackend,
    FilesystemBackend,
)
from langchain_openai import ChatOpenAI
from datetime import datetime
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from deepagents import (
    create_deep_agent,
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    register_harness_profile,
)
from deepagents.middleware.permissions import FilesystemPermission
from deepagents.middleware.summarization import SummarizationToolMiddleware
from src.core.config import get_settings
from src.service.conversation_summarization import (
    ConversationSummarizationMiddleware,
)
from src.service.model_context import apply_model_profile, resolve_max_input_tokens
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()

logger = logging.getLogger(__name__)

# 禁用 deepagents 内置通用子代理（task tool），避免代理在未授权情况下
# 通过 task tool 调用子代理来执行 shell 命令等操作
_settings = get_settings()
register_harness_profile(
    f"openai:{_settings.deepagent_model or 'qwen2.5-72b-instruct'}",
    HarnessProfile(
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
        excluded_middleware={"SummarizationMiddleware"},
    ),
)

# 全局的异步 SqliteSaver 实例，将在应用启动时初始化
_CHECKPOINTER: AsyncSqliteSaver | MemorySaver | None = None

def init_checkpointer(conn) -> None:
    """初始化全局的检查点保存器"""
    global _CHECKPOINTER
    _CHECKPOINTER = AsyncSqliteSaver(conn)

def get_checkpointer() -> AsyncSqliteSaver | MemorySaver:
    """获取全局的检查点保存器，如果未初始化则回退到 MemorySaver"""
    global _CHECKPOINTER
    if _CHECKPOINTER is None:
        logger.warning("AsyncSqliteSaver 未初始化，回退到 MemorySaver")
        _CHECKPOINTER = MemorySaver()
    return _CHECKPOINTER


async def delete_conversation_checkpoint(conversation_id: int) -> None:
    """删除 LangGraph 中与 conversation_id 对应的 thread checkpoint。"""
    checkpointer = get_checkpointer()
    if not hasattr(checkpointer, "adelete_thread"):
        logger.warning(
            "checkpointer has no adelete_thread, skip cleanup conv=%s",
            conversation_id,
        )
        return
    try:
        await checkpointer.adelete_thread(str(conversation_id))
        logger.info("Deleted LangGraph checkpoint for conversation %s", conversation_id)
    except Exception:
        logger.warning(
            "Failed to delete LangGraph checkpoint for conversation %s",
            conversation_id,
            exc_info=True,
        )


def _resolve_skills_root(skill_path: str) -> Path:
    raw = (skill_path or "").strip()
    if not raw:
        return Path(__file__).resolve().parent / "skills"

    p = Path(raw).resolve()
    if p.is_file() and p.name.lower() == "skill.md":
        return p.parent.parent
    if p.is_dir() and p.name.lower() == "skills":
        return p
    if p.is_dir() and (p / "SKILL.md").exists():
        return p.parent
    if p.is_dir() and (p / "skills").is_dir():
        return p / "skills"
    return p


def _list_available_skills(skills_root: Path) -> list[str]:
    if not skills_root.is_dir():
        return []
    return sorted(
        child.name
        for child in skills_root.iterdir()
        if child.is_dir() and (child / "SKILL.md").is_file()
    )


_EMPLOYEE_MEMORY_TEMPLATE = """# 员工长期记忆

## 用户偏好
（暂无）

## 已知事实与约定
（暂无）

---
说明：用户明确要求「记住」的信息请更新本文件；可另建 /memories/ 下其他 .md，但本文件会在每次对话开始时自动加载，请保持简洁。
"""


def ensure_employee_memory_file(memories_dir: Path) -> None:
    """若员工记忆文件不存在则写入默认模板（不覆盖已有内容）。"""
    memory_file = memories_dir / "AGENTS.md"
    if memory_file.is_file():
        return
    memory_file.write_text(_EMPLOYEE_MEMORY_TEMPLATE, encoding="utf-8")
    logger.info("Seeded employee memory file: %s", memory_file)


def resolve_employee_memories_dir(
    *,
    employee_id: int | None = None,
    skills_root: Path | None = None,
    base_dir: Path | None = None,
) -> Path:
    """解析员工长期记忆目录（/memories/ 物理根）。"""
    if employee_id is not None and skills_root is not None:
        resolved_skills = skills_root.resolve()
        if resolved_skills.is_dir() and resolved_skills.name.lower() == "skills":
            return resolved_skills.parent / "memories"
    if employee_id is not None:
        settings = get_settings()
        skill_root = Path(os.path.expandvars(os.path.expanduser(settings.skill_path)))
        if not skill_root.is_absolute():
            skill_root = (Path.cwd() / skill_root).resolve()
        employee_root = skill_root / str(employee_id)
        employee_root.mkdir(parents=True, exist_ok=True)
        return employee_root / "memories"
    base = (base_dir or Path(__file__).resolve().parent).resolve()
    return base / "memories"


def build_filesystem_prompt_section(
    *,
    skills_real_path: str = "",
    draft_skills_real_path: str = "",
    uploads_real_path: str = "",
    artifacts_real_path: str = "",
    memories_real_path: str = "",
    agent_real_path: str = "",
    use_session_history: bool = False,
    has_draft_route: bool = False,
) -> str:
    path_mappings = []
    if skills_real_path:
        path_mappings.append(f"  /skills/       → {skills_real_path}")
    if draft_skills_real_path:
        path_mappings.append(f"  /skills-draft/ → {draft_skills_real_path}")
    if uploads_real_path:
        path_mappings.append(f"  /uploads/      → {uploads_real_path}")
    if artifacts_real_path:
        path_mappings.append(f"  /artifacts/    → {artifacts_real_path}")
    if memories_real_path:
        path_mappings.append(f"  /memories/     → {memories_real_path}")
    if agent_real_path:
        path_mappings.append(f"  /agent/        → {agent_real_path}")

    path_table = "\n".join(path_mappings) if path_mappings else "无"

    draft_instruction = ""
    if has_draft_route:
        draft_instruction = """
        如果用户要求创建新技能或修改已有技能，将技能文件写入 /skills-draft/ 路径下，
        例如 write_file("/skills-draft/my-skill/SKILL.md", "...")。
        草稿技能会立即生效，可以像正式技能一样调用和调试。
        注意：/skills/ 下的正式技能是只读的，不要尝试修改，只能通过 /skills-draft/ 覆盖。
        """

    history_hint = (
        "/conversation_history/history.md（与会话目录下 history.md 对应）"
        if use_session_history
        else "/conversation_history/（按 thread 分文件）"
    )

    return f"""
        ## 路径规则（重要）

        虚拟路径与真实物理路径映射（仅供理解；文件工具见下表用法）：
{path_table}

        ### 文件工具（read_file / write_file / edit_file / ls）
        - **一律使用虚拟路径**，例如 /artifacts/report.md、/memories/AGENTS.md
        - **禁止**在虚拟路径前拼接磁盘绝对路径（如 /artifacts/Users/...、/artifacts/C:/...）
        - **禁止**把上表「真实物理路径」当作 write_file 的路径（那是磁盘路径，不是虚拟路径）

        ### shell execute（python、cmd 等）
        - **必须使用上表中的真实物理路径**，不要使用 /memories/ 等虚拟路径
        - 若 execute 返回 exit code=0 但输出为空，先判断为命令可能是静默成功，不要立刻改用 python -c 重跑

        ### 用户可见产物（/artifacts/）
        - 代码、报告、导出数据等交付给用户看的文件：write_file("/artifacts/文件名", ...)
        - 仅 /artifacts/ 下简短相对路径（如 /artifacts/report.md），**不要**在 /artifacts/ 下创建 Users、.digital-employee 等目录镜像

        ### 长期记忆（/memories/，每次开聊已自动加载，不在会话资源列表中展示）
        - /agent/AGENTS.md：产品级说明（只读，已注入上下文）
        - /memories/AGENTS.md：本员工跨会话记忆（可读写，已注入上下文）；用户说「记住…」时 **仅用** edit_file("/memories/AGENTS.md", ...)
        - /memories/ 下其他 .md：补充记忆，按需 read_file("/memories/xxx.md")
        - **禁止**用 write_file("/artifacts/...") 或磁盘绝对路径保存记忆；**禁止**把用户交付物写入 /memories/
        {draft_instruction}

        ## 上下文管理
        - 你可以调用 `compact_conversation` 工具来压缩对话历史，释放上下文空间
        - 以下情况适合主动压缩：
          - 一个复杂任务执行完毕，用户开始讨论新话题前
          - 工具返回内容很长（如执行结果、文件内容），且后续不再需要这些细节
          - 感觉对话轮次较多、响应变慢时
        - 压缩不会丢失关键信息，旧消息会被摘要替代；完整历史 offload 在 {history_hint}，可用 read_file 查阅
        """


def _build_system_prompt(
    current_time: str,
    available_skills: list[str],
    *,
    has_draft_route: bool = False,
    skills_real_path: str = "",
    draft_skills_real_path: str = "",
    uploads_real_path: str = "",
    artifacts_real_path: str = "",
    memories_real_path: str = "",
    agent_real_path: str = "",
    use_session_history: bool = False,
) -> str:
    skills_line = ", ".join(available_skills) if available_skills else "无"

    fs_section = build_filesystem_prompt_section(
        skills_real_path=skills_real_path,
        draft_skills_real_path=draft_skills_real_path,
        uploads_real_path=uploads_real_path,
        artifacts_real_path=artifacts_real_path,
        memories_real_path=memories_real_path,
        agent_real_path=agent_real_path,
        use_session_history=use_session_history,
        has_draft_route=has_draft_route,
    )

    return f"""今天的时间是{current_time}

        Skills available at /skills/. Use /memories/ for persistent context.
        我的默认环境是windows环境，所以你执行命令的时候要注意windows的命令规范
        在生成命令的时候不要添加引号，例如正确的命令是：python script.py 而不是 python "script.py"
        执行 Python 脚本时优先使用无缓冲模式：python -u <script.py> ...
        当前已加载的技能名单：{skills_line}
        如果用户询问"你有没有某个技能"或"你有哪些技能"，必须严格基于当前已加载的技能名单回答，不要猜测，不要遗漏名单中的技能。
        {fs_section}
        无特殊说明，总是用中文回答用户问题。
        """

_ARTIFACT_CODE_EXTENSIONS = {"ts", "tsx", "js", "jsx", "json", "py", "sql", "css", "html", "java", "go", "rs", "cpp", "c", "h"}
_ARTIFACT_SHEET_EXTENSIONS = {"csv", "tsv"}
_ARTIFACT_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"}
_ARTIFACT_LANGUAGE_MAP = {
    "css": "css", "html": "html", "js": "javascript", "json": "json",
    "md": "markdown", "py": "python", "sql": "sql", "ts": "typescript",
    "tsx": "tsx", "jsx": "jsx", "java": "java", "go": "go", "rs": "rust",
    "cpp": "cpp", "c": "c",
}


def infer_artifact_type(file_path: str) -> str:
    normalized = file_path.replace("\\", "/")
    if normalized.startswith("/skills-draft/"):
        return "skill-draft"
    ext = Path(file_path).suffix.lstrip(".").lower()
    if ext in _ARTIFACT_CODE_EXTENSIONS:
        return "code"
    if ext in _ARTIFACT_SHEET_EXTENSIONS:
        return "sheet"
    if ext in _ARTIFACT_IMAGE_EXTENSIONS:
        return "image"
    return "text"


def infer_artifact_language(file_path: str) -> str | None:
    ext = Path(file_path).suffix.lstrip(".").lower()
    return _ARTIFACT_LANGUAGE_MAP.get(ext)


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
    skills_root = _resolve_skills_root(skill_path)
    available_skills = _list_available_skills(skills_root)
    logger.info(
        "get_agent skill_path=%s skills_root=%s available_skills=%s employee_id=%s conversation_id=%s",
        skill_path,
        skills_root,
        available_skills,
        employee_id,
        conversation_id,
    )
    base_dir = Path(__file__).resolve().parent
    settings = get_settings()
    model = ChatOpenAI(
        model=settings.deepagent_model or "qwen2.5-72b-instruct",
        temperature=0,
        api_key=settings.api_key,
        base_url=settings.base_url
        or "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    apply_model_profile(model, resolve_max_input_tokens(settings))

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

    # /artifacts/ 始终挂载：聊天场景按会话隔离，其他场景按员工隔离
    if conversation_id and root_path:
        artifacts_dir = Path(root_path)  / str(conversation_id) / "artifacts"
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

    # /skills-draft/ 仅在会话场景挂载，跟会话走
    draft_dir: Path | None = None
    has_draft_route = False
    if conversation_id and root_path:
        draft_dir = Path(root_path)  / str(conversation_id) / "skills-draft"
        draft_dir.mkdir(parents=True, exist_ok=True)
        routes["/skills-draft/"] = FilesystemBackend(root_dir=str(draft_dir), virtual_mode=True)
        has_draft_route = True

    # /uploads/ 仅在会话场景挂载（用户上传的文件）
    uploads_dir: Path | None = None
    if conversation_id and root_path:
        uploads_dir = Path(root_path) / str(conversation_id) / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        routes["/uploads/"] = FilesystemBackend(root_dir=str(uploads_dir), virtual_mode=True)

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
        trigger=("fraction", 0.85),
        keep=("fraction", 0.10),
    )
    summarization_mw.use_session_history_file = use_session_history
    summarization_tool_mw = SummarizationToolMiddleware(summarization_mw)

    agent = create_deep_agent(
        model=model,
        memory=["/agent/AGENTS.md", "/memories/AGENTS.md"],
        skills=skill_sources,
        subagents=[],
        system_prompt=_build_system_prompt(
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
        tools=sql_tools or None,
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
