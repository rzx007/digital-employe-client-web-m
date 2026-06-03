from __future__ import annotations

import os
import logging
import sqlite3
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)


def get_default_artifacts_path() -> str:
    return str(Path.home() / ".digital-employee" / "conversations")

def get_default_sqlite_path() -> str:
    return str(Path.home() / ".digital-employee" / "data" / "app.db")


def get_default_skill_path() -> str:
    return str(Path.home() / ".digital-employee" / "employees-skills")


def get_default_builtin_skills_path() -> str:
    return str(Path.home() / ".digital-employee" / "build-in-skills")


def get_default_local_skills_path() -> str:
    return str(Path.home() / ".digital-employee" / "local-skills")


def get_default_logs_dir() -> Path:
    # 与 Electron getLogsDir()（~/.digital-employee/logs）一致
    return Path.home() / ".digital-employee" / "logs"


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
    get_dept_tree_url: str | None = None
    performance_monthly_balance_path: str | None = None
    performance_dispatch_orders_path: str | None = None
    execute_timeout: int = 600
    llm_request_timeout: float = 300.0
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
        get_dept_tree_url=join_base_and_path(
            platform_base_url, get_dept_tree_path
        ),
        performance_monthly_balance_path=performance_monthly_balance_path,
        performance_dispatch_orders_path=performance_dispatch_orders_path,
        llm_request_timeout=llm_request_timeout,
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
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    return _resolve_path(sqlite_path)
