from __future__ import annotations

import os
import logging
import sqlite3
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

# 后端本机数据目录单一来源（BobanStaffNext 独立产品分叉，与 BobanStaff/旧 app 数据隔离，不迁移老数据）。
APP_DIR_NAME = "boban-staff-next"


def app_data_dir() -> Path:
    return Path.home() / f".{APP_DIR_NAME}"


def get_default_artifacts_path() -> str:
    return str(app_data_dir() / "conversations")

def get_default_sqlite_path() -> str:
    return str(app_data_dir() / "data" / "app.db")


def get_default_skill_path() -> str:
    return str(app_data_dir() / "employees-skills")


def get_default_builtin_skills_path() -> str:
    return str(app_data_dir() / "build-in-skills")


def get_default_local_skills_path() -> str:
    return str(app_data_dir() / "local-skills")


def get_default_logs_dir() -> Path:
    # 与 Electron getLogsDir()（~/.boban-staff-next/logs）一致
    return app_data_dir() / "logs"


def is_offline_mode() -> bool:
    return os.getenv("OFFLINE_MODE", "").strip().lower() in ("1", "true", "yes", "on")


def is_agent_virtual_mode() -> bool:
    """Agent 文件工具是否强制虚拟路径（/artifacts/ 等）。False 时允许本机绝对路径。

    薄 re-export：实际定义在 src.service.agent.path_access.config，避免重复 env 逻辑。
    """
    from src.service.agent.path_access.config import is_virtual_mode_enabled

    return is_virtual_mode_enabled()


def _resolve_path(path_value: str) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(path_value)))
    if not path.is_absolute():
        path = Path.cwd() / path
    return path


def resolve_configured_path(path_value: str) -> str:
    return str(_resolve_path(path_value))


def join_base_and_path(base_url: str | None, path: str | None) -> str | None:
    base = (base_url or "").strip().rstrip("/")
    suffix = (path or "").strip()
    if suffix.startswith(("http://", "https://")):
        return suffix
    if not base:
        return None
    if not suffix:
        return base
    normalized = suffix if suffix.startswith("/") else f"/{suffix}"
    logger.info("join_base_and_path base=%s, path=%s, normalized=%s", base, path, normalized)
    return f"{base}{normalized}"


@dataclass(slots=True)
class Settings:
    offline_mode: bool
    agent_serial_mode: bool
    default_workspace_root: str | None
    default_workspace_id: int
    default_workspace_name: str | None
    sqlite_path: str
    skill_path: str
    builtin_skills_path: str
    local_skills_path: str
    artifacts_path: str
    remote_api_base_url: str | None
    deepagent_model: str | None
    model_max_input_tokens: int | None
    summarization_trigger_fraction: float
    summarization_keep_fraction: float
    chat_history_max_messages: int
    api_key: str | None
    base_url: str | None
    llm_provider: str | None
    skill_remote_base_url: str | None
    skill_remote_list_path: str
    skill_remote_detail_path: str
    skill_remote_token: str | None
    skill_remote_timeout: float
    skill_remote_rating: str | None
    # ClawHub 镜像技能市场基址（搜索/详情/下载）。可被 env SKILL_MARKET_BASE 覆盖。
    skill_market_base: str | None
    mcp_remote_list_url: str | None
    mcp_remote_detail_url: str | None
    platform_base_url: str | None = None
    mcp_client_base_path: str | None = None
    mcp_base_url: str | None = None
    agent_interface_base_url: str | None = None
    agent_interface_skill_prefix: str = "/aios/skill"
    skill_dir_path: str | None = None
    skill_remote_import_path: str | None = None
    skill_name_validate_path: str | None = None
    remote_model_provider_path: str | None = None
    client_skill_import_max_bytes: int = 52428800
    login_path: str | None = None
    login_url: str | None = None
    update_user_password_url: str | None = None
    register_url: str | None = None
    feedback_url: str | None = None
    analytics_events_url: str | None = None
    get_dept_tree_url: str | None = None
    performance_monthly_balance_path: str | None = None
    performance_dispatch_orders_path: str | None = None
    execute_timeout: int = 600
    llm_request_timeout: float = 300.0
    # Agent 流：chunk 间无事件的最长等待（工具+模型思考）；过短会误判「已完成」
    agent_chunk_timeout: float = 180.0
    agent_first_chunk_timeout: float = 120.0
    # 单流硬墙：超过此秒数仍 active 则强制清理（运行时 ≥ stall + 120s）
    agent_stale_hard_timeout: float = 720.0
    # 无进展超时（AGENT_STALL_TIMEOUT）：重任务单步思考/工具可能数分钟无 chunk，默认 30min
    agent_stall_timeout: float = 1800.0
    # 内容级无进展判死阈值（AGENT_NO_CONTENT_KILL_SECONDS）：执行命令/跑脚本时长时间
    # 不吐正文却在干活，超过此秒数才判死回收；默认 900s，过短会误杀正常长命令。
    agent_no_content_kill_seconds: float = 900.0
    # Agent 图 recursion_limit（superstep 上限）：0=不限制（默认），避免把正常多步任务
    # 在第 N 步腰斩成假 completed；真失控由硬墙/内容看门狗回收。设正整数可重新设限。
    agent_recursion_limit: int = 0
    # 技能预路由（AGENT_SKILL_PREROUTE）：对员工消息先做确定性关键词匹配，命中内置技能
    # 则在用户消息尾部注入软提示，提升技能识别一致性；默认开，设 0 完全恢复现状。
    agent_skill_preroute: bool = True
    # resume 冷启（前端未带 cursor）全量重放的事件上限：超过只回放最近这么多条，
    # 防 runaway 巨型 buffer 在反复切窗口时被全量重放、占满线程池/主循环致卡死。
    # <=0 表示不限制（每次冷启全量回放整个 buffer）。
    resume_cold_replay_cap: int = 1500
    feishu_app_id: str | None = None
    feishu_app_secret: str | None = None
    feishu_redirect_uri: str | None = None
    feishu_tenant_access_token_url: str = (
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    )
    feishu_token_refresh_before_seconds: int = 600
    feishu_token_request_timeout: float = 10.0
    feishu_bitable_app_token: str = "JjbwbZqiQaT2ZosTeJPcRxF5npc"
    feishu_bitable_table_id: str = "tblY6kGa1btVqkH3"
    feishu_bitable_view_id: str = "vewhP7JKEa"
    prompt_cache_mode: str | None = None
    # 流式会话存储后端：file（默认，per-thread/per-message 文件）| sqlite（回滚老路径）。
    # checkpointer_backend 控 LangGraph 检查点；stream_progress_backend 控业务瞬时进度。
    checkpointer_backend: str = "file"
    stream_progress_backend: str = "file"
    # 单员工内部并行子任务（deepagents task 工具）同时在跑的最大子任务数。
    # 子任务在「一个已准入的会话流」内部并发跑，绕过 registry 槽阀门，故单独限流，
    # 护昇腾单卡 GPU 不被一次 fan-out 的多路嵌套图打满。<=1 实质串行（仍保 task 隔离）。
    subagent_max_parallel: int = 3


def _get_kv_value(kv_data: dict[str, str], key: str) -> str | None:
    value = kv_data.get(key)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized if normalized else None


def _get_kv_bool(kv_data: dict[str, str], key: str, default: bool = False) -> bool:
    value = _get_kv_value(kv_data, key)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def read_agent_serial_mode(default: bool = False) -> bool:
    """每次从 config_kvs 读取串行模式（设置页热更新，不走 get_settings 缓存）。"""
    return _get_kv_bool(_read_config_kv_data(), "AGENT_SERIAL_MODE", default=default)


def read_subagent_enabled(default: bool = True) -> bool:
    """每次从 config_kvs 读取「并行子任务总开关」（设置页热更新，不走 get_settings 缓存）。

    默认开。关闭时 get_agent 构图会把 deepagents 的 `task` 工具从模型可见工具中排除，
    员工无法再 fan-out 并行子任务。下一个新会话/新任务生效（已在跑的不受影响）。
    """
    return _get_kv_bool(_read_config_kv_data(), "SUBAGENT_ENABLED", default=default)


def read_subagent_max_parallel(default: int = 3) -> int:
    """每次从 config_kvs 读取「子任务最大并发数」（设置页热更新，不走 get_settings 缓存）。"""
    return _parse_subagent_max_parallel(
        _get_kv_value(_read_config_kv_data(), "SUBAGENT_MAX_PARALLEL"), default=default
    )


def _parse_subagent_max_parallel(raw: str | None, default: int = 3) -> int:
    """解析 SUBAGENT_MAX_PARALLEL；非法/缺省→default；下限 1。"""
    if raw is None:
        return default
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return n if n >= 1 else 1


def normalize_prompt_cache_mode(raw: str | None) -> str | None:
    """Normalize PROMPT_CACHE_MODE from config_kvs. Empty/default → None (auto by provider)."""
    if raw is None:
        return None
    normalized = str(raw).strip().lower()
    if not normalized or normalized in ("default", "auto-detect", "provider"):
        return None
    if normalized in ("off", "auto", "explicit"):
        return normalized
    return None


def clear_settings_cache() -> None:
    get_settings.cache_clear()


def _read_config_kv_data() -> dict[str, str]:
    raw_sqlite_path = get_default_sqlite_path()
    sqlite_path = _resolve_path(raw_sqlite_path)
    if not sqlite_path.exists():
        return {}

    try:
        with sqlite3.connect(str(sqlite_path)) as conn:
            table = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='config_kvs'"
            ).fetchone()
            if table is None:
                return {}
            rows = conn.execute(
                "SELECT config_key, config_value FROM config_kvs"
            ).fetchall()
    except sqlite3.Error:
        return {}

    out: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, tuple) or len(row) < 2:
            continue
        key = str(row[0] or "").strip()
        if not key:
            continue
        out[key] = "" if row[1] is None else str(row[1])
    return out


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    kv_data = _read_config_kv_data()
    remote_api_base_url = _get_kv_value(kv_data, "REMOTE_API_BASE_URL")
    skill_remote_list_path = (
        _get_kv_value(kv_data, "SKILL_REMOTE_LIST_PATH")
        or _get_kv_value(kv_data, "SKILL_REMOTE_LIST_URL")
        or "/api/v1/client/skills/export"
    )
    skill_remote_detail_path = (
        _get_kv_value(kv_data, "SKILL_REMOTE_DETAIL_PATH")
        or "/api/v1/client/skills/export/full/{skill_id}"
    )
    skill_dir_path = (
        _get_kv_value(kv_data, "SKILL_DIR")
        or "/api/v1/client/skills/directories"
    )
    skill_remote_import_path = (
        _get_kv_value(kv_data, "SKILL_REMOTE_IMPORT")
        or "/api/v1/client/skills/import"
    )
    skill_name_validate_path = (
        _get_kv_value(kv_data, "SKILL_NAME_VALIDATE")
        or "/api/v1/client/skills/name/exists"
    )
    remote_model_provider_path = (
        _get_kv_value(kv_data, "REMOTE_MODEL_PROVIDER_PATH")
        or "/digital/api/v1/model/provider"
    )
    client_skill_import_max_bytes_raw = _get_kv_value(
        kv_data, "CLIENT_SKILL_IMPORT_MAX_BYTES"
    )
    mcp_remote_list_url = _get_kv_value(
        kv_data, "MCP_REMOTE_LIST_PATH"
    ) or _get_kv_value(kv_data, "MCP_REMOTE_LIST_URL")
    mcp_remote_detail_url = _get_kv_value(
        kv_data, "MCP_REMOTE_DETAIL_PATH"
    ) or _get_kv_value(kv_data, "MCP_REMOTE_DETAIL_URL")

    platform_base_url = _get_kv_value(kv_data, "REMOTE_API_BASE_URL")
    mcp_client_base_path = (
        _get_kv_value(kv_data, "MCP_CLIENT_BASE_PATH") or "/llm/aios/mcp/client"
    )
    login_path = _get_kv_value(kv_data, "LOGIN_PATH") or "/yc/login"
    update_user_password_path = _get_kv_value(kv_data, "UPDATE_USER_PASSWORD_PATH") or "/yc/updatePassword"
    register_path = _get_kv_value(kv_data, "REGISTER_PATH") or "/yc/register"
    feedback_path = _get_kv_value(kv_data, "FEEDBACK_PATH") or "/digital/api/v1/feedback"
    analytics_events_path = (
        os.environ.get("ANALYTICS_EVENTS_PATH")
        or _get_kv_value(kv_data, "ANALYTICS_EVENTS_PATH")
        or "/digital/api/v1/analytics/events"
    )
    # 活跃度上报转发基址：默认与平台同源；支持环境变量 ANALYTICS_BASE_URL 覆盖（本地联调用）
    analytics_base_url = os.environ.get("ANALYTICS_BASE_URL") or platform_base_url
    get_dept_tree_path = (
        _get_kv_value(kv_data, "GET_DEPT_TREE_PATH") or "/yc/getDeptTree"
    )
    performance_monthly_balance_path = (
        _get_kv_value(kv_data, "PERFORMANCE_MONTHLY_BALANCE_PATH")
        or "/api/v1/performance/monthly-balance"
    )
    performance_dispatch_orders_path = (
        _get_kv_value(kv_data, "PERFORMANCE_DISPATCH_ORDERS_PATH")
        or "/api/v1/performance/dispatch-orders"
    )
    sqlite_path = get_default_sqlite_path()
    skill_path = get_default_skill_path()
    builtin_skills_path = (
        _get_kv_value(kv_data, "BUILTIN_SKILLS_PATH")
        or get_default_builtin_skills_path()
    )
    local_skills_path = (
        _get_kv_value(kv_data, "LOCAL_SKILLS_PATH")
        or get_default_local_skills_path()
    )
    model_max_input_tokens_raw = _get_kv_value(kv_data, "MODEL_MAX_INPUT_TOKENS")
    model_max_input_tokens: int | None = None
    if model_max_input_tokens_raw and str(model_max_input_tokens_raw).strip():
        try:
            parsed = int(model_max_input_tokens_raw)
            if parsed > 0:
                model_max_input_tokens = parsed
        except ValueError:
            model_max_input_tokens = None

    def _parse_fraction_setting(key: str, default: float) -> float:
        raw = _get_kv_value(kv_data, key)
        if not raw or not str(raw).strip():
            return default
        try:
            value = float(raw)
        except ValueError:
            return default
        if value <= 0 or value > 1.0:
            return default
        return value

    summarization_trigger_fraction = _parse_fraction_setting(
        "SUMMARIZATION_TRIGGER_FRACTION", 0.75
    )
    summarization_keep_fraction = _parse_fraction_setting(
        "SUMMARIZATION_KEEP_FRACTION", 0.20
    )

    chat_history_max_messages_raw = _get_kv_value(kv_data, "CHAT_HISTORY_MAX_MESSAGES")
    try:
        chat_history_max_messages = int(chat_history_max_messages_raw or "30")
    except ValueError:
        chat_history_max_messages = 30
    skill_remote_timeout_raw = _get_kv_value(kv_data, "SKILL_REMOTE_TIMEOUT")
    try:
        skill_remote_timeout = float(skill_remote_timeout_raw or "15")
    except ValueError:
        skill_remote_timeout = 15.0

    llm_request_timeout_raw = _get_kv_value(kv_data, "LLM_REQUEST_TIMEOUT")
    try:
        llm_request_timeout = float(llm_request_timeout_raw or "300")
    except ValueError:
        llm_request_timeout = 300.0
    if llm_request_timeout < 15.0:
        llm_request_timeout = 15.0

    agent_chunk_timeout_raw = _get_kv_value(kv_data, "AGENT_CHUNK_TIMEOUT")
    try:
        agent_chunk_timeout = float(agent_chunk_timeout_raw or "180")
    except ValueError:
        agent_chunk_timeout = 180.0
    if agent_chunk_timeout < 60.0:
        agent_chunk_timeout = 60.0

    agent_first_chunk_timeout_raw = _get_kv_value(
        kv_data, "AGENT_FIRST_CHUNK_TIMEOUT"
    )
    try:
        agent_first_chunk_timeout = float(agent_first_chunk_timeout_raw or "120")
    except ValueError:
        agent_first_chunk_timeout = 120.0
    if agent_first_chunk_timeout < 30.0:
        agent_first_chunk_timeout = 30.0

    execute_timeout_raw = _get_kv_value(kv_data, "EXECUTE_TIMEOUT")
    try:
        execute_timeout = int(execute_timeout_raw or "600")
    except ValueError:
        execute_timeout = 600
    if execute_timeout < 60:
        execute_timeout = 600

    agent_stale_hard_timeout_raw = _get_kv_value(kv_data, "AGENT_STALE_HARD_TIMEOUT")
    try:
        agent_stale_hard_timeout = float(agent_stale_hard_timeout_raw or "720")
    except ValueError:
        agent_stale_hard_timeout = 720.0

    agent_stall_timeout_raw = _get_kv_value(kv_data, "AGENT_STALL_TIMEOUT")
    try:
        agent_stall_timeout = float(agent_stall_timeout_raw or "1800")
    except ValueError:
        agent_stall_timeout = 1800.0
    if agent_stall_timeout < 30.0:
        agent_stall_timeout = 30.0

    agent_stale_hard_timeout = max(
        agent_stale_hard_timeout,
        float(execute_timeout) + 120.0,
        agent_stall_timeout + 120.0,
    )

    # RESUME_COLD_REPLAY_CAP：冷启全量重放的事件上限（<=0 不限制）。
    resume_cold_replay_cap_raw = _get_kv_value(kv_data, "RESUME_COLD_REPLAY_CAP")
    try:
        resume_cold_replay_cap = int(resume_cold_replay_cap_raw or "1500")
    except ValueError:
        resume_cold_replay_cap = 1500

    # AGENT_NO_CONTENT_KILL_SECONDS：内容级无进展判死阈值，默认 900s。
    # 取值优先级：config_kvs > 同名环境变量 > 默认 900（保留旧的 env 覆盖能力）。
    agent_no_content_kill_seconds_raw = _get_kv_value(
        kv_data, "AGENT_NO_CONTENT_KILL_SECONDS"
    ) or os.getenv("AGENT_NO_CONTENT_KILL_SECONDS")
    try:
        agent_no_content_kill_seconds = float(
            agent_no_content_kill_seconds_raw or "900"
        )
    except ValueError:
        agent_no_content_kill_seconds = 900.0

    # AGENT_RECURSION_LIMIT：Agent 图 superstep 上限。默认 0=不限制（正常多步任务不被
    # 腰斩）；设正整数可重新设限。优先级：config_kvs > 同名环境变量 > 默认 0。
    agent_recursion_limit_raw = _get_kv_value(
        kv_data, "AGENT_RECURSION_LIMIT"
    ) or os.getenv("AGENT_RECURSION_LIMIT")
    try:
        agent_recursion_limit = int(float(agent_recursion_limit_raw or "0"))
    except ValueError:
        agent_recursion_limit = 0
    if agent_recursion_limit < 0:
        agent_recursion_limit = 0

    default_workspace_id_raw = _get_kv_value(kv_data, "DEFAULT_WORKSPACE_ID")
    try:
        default_workspace_id = int(default_workspace_id_raw or "1")
    except ValueError:
        default_workspace_id = 1
    try:
        client_skill_import_max_bytes = int(
            client_skill_import_max_bytes_raw or "52428800"
        )
    except ValueError:
        client_skill_import_max_bytes = 52428800
    feishu_token_refresh_before_seconds_raw = _get_kv_value(
        kv_data, "FEISHU_TOKEN_REFRESH_BEFORE_SECONDS"
    )
    try:
        feishu_token_refresh_before_seconds = int(
            feishu_token_refresh_before_seconds_raw or "600"
        )
    except ValueError:
        feishu_token_refresh_before_seconds = 600
    if feishu_token_refresh_before_seconds < 0:
        feishu_token_refresh_before_seconds = 600
    feishu_token_request_timeout_raw = _get_kv_value(
        kv_data, "FEISHU_TOKEN_REQUEST_TIMEOUT"
    )
    try:
        feishu_token_request_timeout = float(feishu_token_request_timeout_raw or "10")
    except ValueError:
        feishu_token_request_timeout = 10.0
    if feishu_token_request_timeout <= 0:
        feishu_token_request_timeout = 10.0

    from src.llm.registry import resolve_active_from_kv

    reg_key, reg_url, reg_model, reg_provider = resolve_active_from_kv(kv_data)

    base_url = reg_url
    api_key = reg_key
    deepagent_model = reg_model
    llm_provider = reg_provider
    if not llm_provider and base_url:
        from src.llm.providers import resolve_provider_id

        inferred = resolve_provider_id(base_url)
        if inferred != "custom":
            llm_provider = inferred

    return Settings(
        offline_mode=is_offline_mode(),
        agent_serial_mode=_get_kv_bool(kv_data, "AGENT_SERIAL_MODE"),
        agent_skill_preroute=_get_kv_bool(
            kv_data, "AGENT_SKILL_PREROUTE", default=True
        ),
        default_workspace_root=_get_kv_value(kv_data, "DEFAULT_WORKSPACE_ROOT"),
        default_workspace_id=default_workspace_id,
        default_workspace_name=_get_kv_value(kv_data, "DEFAULT_WORKSPACE_NAME")
        or "默认的工作空间",
        sqlite_path=resolve_configured_path(sqlite_path),
        skill_path=resolve_configured_path(skill_path),
        builtin_skills_path=resolve_configured_path(builtin_skills_path),
        local_skills_path=resolve_configured_path(local_skills_path),
        artifacts_path=get_default_artifacts_path(),
        remote_api_base_url=remote_api_base_url,
        deepagent_model=deepagent_model,
        model_max_input_tokens=model_max_input_tokens,
        summarization_trigger_fraction=summarization_trigger_fraction,
        summarization_keep_fraction=summarization_keep_fraction,
        chat_history_max_messages=chat_history_max_messages,
        api_key=api_key,
        base_url=base_url,
        llm_provider=llm_provider,
        skill_remote_base_url=remote_api_base_url,
        skill_remote_list_path=skill_remote_list_path,
        skill_remote_detail_path=skill_remote_detail_path,
        skill_remote_token=_get_kv_value(kv_data, "SKILL_REMOTE_TOKEN"),
        skill_remote_timeout=skill_remote_timeout,
        skill_remote_rating=_get_kv_value(kv_data, "SKILL_REMOTE_RATING")
        or "/api/v1/skills/{skill_id}/rating",
        skill_market_base=_get_kv_value(kv_data, "SKILL_MARKET_BASE"),
        mcp_remote_list_url=mcp_remote_list_url,
        mcp_remote_detail_url=mcp_remote_detail_url,
        mcp_client_base_path=mcp_client_base_path,
        mcp_base_url=join_base_and_path(platform_base_url, mcp_client_base_path),
        agent_interface_base_url=_get_kv_value(kv_data, "REMOTE_API_BASE_URL"),
        agent_interface_skill_prefix=_get_kv_value(
            kv_data, "AGENT_INTERFACE_SKILL_PREFIX"
        )
        or "/aios/skill",
        skill_dir_path=skill_dir_path,
        skill_remote_import_path=skill_remote_import_path,
        skill_name_validate_path=skill_name_validate_path,
        remote_model_provider_path=remote_model_provider_path,
        client_skill_import_max_bytes=client_skill_import_max_bytes,
        login_url=join_base_and_path(platform_base_url, login_path),
        update_user_password_url=join_base_and_path(
            platform_base_url, update_user_password_path
        ),
        register_url=join_base_and_path(platform_base_url, register_path),
        #  feedback_url=join_base_and_path('http://localhost:54321', feedback_path),
        feedback_url=join_base_and_path(platform_base_url, feedback_path),
        analytics_events_url=join_base_and_path(
            analytics_base_url, analytics_events_path
        ),
        get_dept_tree_url=join_base_and_path(
            platform_base_url, get_dept_tree_path
        ),
        performance_monthly_balance_path=performance_monthly_balance_path,
        performance_dispatch_orders_path=performance_dispatch_orders_path,
        execute_timeout=execute_timeout,
        llm_request_timeout=llm_request_timeout,
        agent_chunk_timeout=agent_chunk_timeout,
        agent_first_chunk_timeout=agent_first_chunk_timeout,
        agent_stale_hard_timeout=agent_stale_hard_timeout,
        agent_stall_timeout=agent_stall_timeout,
        resume_cold_replay_cap=resume_cold_replay_cap,
        agent_no_content_kill_seconds=agent_no_content_kill_seconds,
        agent_recursion_limit=agent_recursion_limit,
        feishu_app_id=_get_kv_value(kv_data, "FEISHU_APP_ID"),
        feishu_app_secret=_get_kv_value(kv_data, "FEISHU_APP_SECRET"),
        feishu_redirect_uri=_get_kv_value(kv_data, "FEISHU_REDIRECT_URI"),
        feishu_tenant_access_token_url=_get_kv_value(
            kv_data, "FEISHU_TENANT_ACCESS_TOKEN_URL"
        )
        or "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        feishu_token_refresh_before_seconds=feishu_token_refresh_before_seconds,
        feishu_token_request_timeout=feishu_token_request_timeout,
        feishu_bitable_app_token=_get_kv_value(kv_data, "FEISHU_BITABLE_APP_TOKEN")
        or "UrEbbbWQOan8RtsZxvIcQZBhn9b",
        feishu_bitable_table_id=_get_kv_value(kv_data, "FEISHU_BITABLE_TABLE_ID")
        or "tblGUEhjytwRMNAn",
        feishu_bitable_view_id=_get_kv_value(kv_data, "FEISHU_BITABLE_VIEW_ID")
        or "vewr46ceAD",
        prompt_cache_mode=normalize_prompt_cache_mode(
            _get_kv_value(kv_data, "PROMPT_CACHE_MODE")
        ),
        checkpointer_backend=_get_kv_value(kv_data, "CHECKPOINTER_BACKEND") or "file",
        stream_progress_backend=_get_kv_value(kv_data, "STREAM_PROGRESS_BACKEND")
        or "file",
        subagent_max_parallel=_parse_subagent_max_parallel(
            _get_kv_value(kv_data, "SUBAGENT_MAX_PARALLEL")
        ),
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    return _resolve_path(sqlite_path)
