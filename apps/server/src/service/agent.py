import logging
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

from deepagents import create_deep_agent
from deepagents.middleware.permissions import FilesystemPermission
from deepagents.middleware.summarization import (
    SummarizationMiddleware,
    SummarizationToolMiddleware,
)
from src.core.config import get_settings
from src.service.skill_shell_backend import SkillAwareShellBackend

load_dotenv()

logger = logging.getLogger(__name__)

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


def _build_system_prompt(
    current_time: str,
    available_skills: list[str],
    *,
    has_draft_route: bool = False,
    skills_real_path: str = "",
    draft_skills_real_path: str = "",
) -> str:
    skills_line = ", ".join(available_skills) if available_skills else "无"
    skills_root_line = skills_real_path or "未配置"
    draft_instruction = ""
    if has_draft_route:
        draft_root_line = draft_skills_real_path or "未配置"
        draft_instruction = f"""
        如果用户要求创建新技能或修改已有技能，将技能文件写入 /skills-draft/ 路径下，
        例如 write_file("/skills-draft/my-skill/SKILL.md", "...")。
        草稿技能会立即生效，可以像正式技能一样调用和调试。
        注意：/skills/ 下的正式技能是只读的，不要尝试修改，只能通过 /skills-draft/ 覆盖。
        草稿技能真实物理路径根目录：{draft_root_line}
        执行草稿技能脚本时，请使用草稿真实路径，不要在 execute 命令里使用 /skills-draft/ 虚拟路径。
        """
    return f"""今天的时间是{current_time}

        Skills available at /skills/. Use /memories/ for persistent context.
        我的默认环境是windows环境，所以你执行命令的时候要注意windows的命令规范
        在生成命令的时候不要添加引号，例如正确的命令是：python script.py 而不是 python \"script.py\"
        执行 Python 脚本时优先使用无缓冲模式：python -u <script.py> ...
        当前已加载的技能名单：{skills_line}
        如果用户询问"你有没有某个技能"或"你有哪些技能"，必须严格基于当前已加载的技能名单回答，不要猜测，不要遗漏名单中的技能。
        技能文件真实物理路径根目录：{skills_root_line}
        执行技能脚本时请基于上面的真实路径拼接绝对路径（例如 python <skills_real_path>/<skill_name>/script.py），不要使用相对路径。
        /skills/ 是虚拟路由路径，仅用于读写文件工具，不可直接用于 shell execute 命令。
        如果 execute 返回 exit code=0 但输出为空，先判断为命令可能是静默成功，不要立刻改用 python -c 重跑。
        当你需要为用户创建文件（如代码文件、文档、数据文件等产物）时，必须将文件写入 /artifacts/ 路径下，例如 write_file("/artifacts/report.md", "...")。
        不要将用户产物文件写到根路径或其他虚拟路径，只有 /artifacts/ 下的文件会被持久化保存并向用户展示。
        {draft_instruction}
        无特殊说明，总是以中文回答用户问题。

        ## 上下文管理
        - 你可以调用 `compact_conversation` 工具来压缩对话历史，释放上下文空间
        - 以下情况适合主动压缩：
          - 一个复杂任务执行完毕，用户开始讨论新话题前
          - 工具返回内容很长（如执行结果、文件内容），且后续不再需要这些细节
          - 感觉对话轮次较多、响应变慢时
        - 压缩不会丢失关键信息，旧消息会被摘要替代
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
    model.profile = {"max_input_tokens": 131072}

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

    # /memories/ 跟员工走：每个员工有独立的长期记忆目录
    if employee_id:
        employee_root = skills_root.parent
        memories_dir = employee_root / "memories"
    else:
        memories_dir = base_dir / "memories"
    memories_dir.mkdir(parents=True, exist_ok=True)
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

    skill_sources = ["/skills/", "/skills-draft/"] if has_draft_route else ["/skills/"]

    shell_backend = SkillAwareShellBackend(
        root_dir=str(artifacts_dir),
        skills_root=skills_root,
        draft_root=draft_dir,
        virtual_mode=True,
        inherit_env=True,
        timeout=settings.execute_timeout,
    )

    backend = CompositeBackend(default=shell_backend, routes=routes)

    if employee_id:
        history_root = skills_root.parent
    else:
        history_root = base_dir
    history_root.mkdir(parents=True, exist_ok=True)
    history_backend = FilesystemBackend(root_dir=str(history_root), virtual_mode=True)

    summarization_ref = SummarizationMiddleware(
        model=model,
        backend=history_backend,
        trigger=("fraction", 0.85),
        keep=("fraction", 0.10),
    )
    summarization_tool_mw = SummarizationToolMiddleware(summarization_ref)

    agent = create_deep_agent(
        model=model,
        memory=["/agent/AGENTS.md"],
        skills=skill_sources,
        subagents=[],
        system_prompt=_build_system_prompt(
            current_time,
            available_skills,
            has_draft_route=has_draft_route,
            skills_real_path=str(skills_root),
            draft_skills_real_path=str(draft_dir) if draft_dir is not None else "",
        ),
        backend=backend,
        checkpointer=checkpointer,
        tools=sql_tools or None,
        middleware=[summarization_tool_mw],
        permissions=[
            FilesystemPermission(
                operations=["write"],
                paths=["/skills/**", "/agent/**"],
                mode="deny",
            ),
        ],
    )
    return agent
