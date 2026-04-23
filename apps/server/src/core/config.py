from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv()


def get_default_artifacts_path() -> str:
    return str(Path.home() / ".digital-employee" / "conversations")

def get_default_sqlite_path() -> str:
    return str(Path.home() / ".digital-employee" / "data" / "app.db")


def get_default_skill_path() -> str:
    return str(Path.home() / ".digital-employee" / "employees-skills")


def get_default_logs_dir() -> Path:
    return Path.home() / ".digital-employee" / "logs"


def _resolve_path(path_value: str) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(path_value)))
    if not path.is_absolute():
        path = Path.cwd() / path
    return path


def resolve_configured_path(path_value: str) -> str:
    return str(_resolve_path(path_value))


def split_base_and_path(url: str | None) -> tuple[str | None, str | None]:
    raw = (url or "").strip()
    if not raw:
        return None, None
    parsed = urlsplit(raw)
    if not parsed.scheme or not parsed.netloc:
        return None, raw
    base = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path or ""
    if parsed.query:
        path = f"{path}?{parsed.query}"
    if parsed.fragment:
        path = f"{path}#{parsed.fragment}"
    return base, path or None


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
    return f"{base}{normalized}"


@dataclass(slots=True)
class Settings:
    default_workspace_root: str | None
    default_workspace_id: int
    default_workspace_name: str | None
    sqlite_path: str
    skill_path: str
    artifacts_path: str
    remote_api_base_url: str | None
    employee_zip_path: str | None
    employee_zip_url: str | None
    employee_tmp_dir: str
    deepagent_model: str | None
    chat_history_max_messages: int
    api_key: str | None
    base_url: str | None
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
    mcp_tool_call_path: str = "/tool/call"
    mcp_base_url: str | None = None
    agent_interface_base_url: str | None = None
    agent_interface_skill_prefix: str = "/aios/skill"
    dbchat_base_url: str | None = None
    dbchat_model_chat_simple_path: str = "/model/chat/simple"
    login_path: str | None = None
    login_url: str | None = None


SETTINGS_JSON_PATH = Path.home() / ".digital-employee" / "settings.json"


def _read_settings_json() -> dict[str, object]:
    """读取 Electron settings.json 配置。"""
    try:
        if not SETTINGS_JSON_PATH.exists():
            return {}
        with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _get_settings_value(settings_data: dict[str, object], key: str) -> str | None:
    value = settings_data.get(key)
    if isinstance(value, str):
        normalized = value.strip()
        return normalized if normalized else None
    return None


def _get_env_value(key: str) -> str | None:
    value = os.getenv(key)
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized else None


def _get_kv_value(kv_data: dict[str, str], key: str) -> str | None:
    value = kv_data.get(key)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized if normalized else None


def _read_config_kv_data() -> dict[str, str]:
    raw_sqlite_path = _get_env_value("SQLITE_PATH") or get_default_sqlite_path()
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


def _get_runtime_value(
    kv_data: dict[str, str],
    settings_data: dict[str, object],
    *,
    settings_key: str | None,
    env_key: str | None,
) -> str | None:
    if env_key:
        from_kv = _get_kv_value(kv_data, env_key)
        if from_kv is not None:
            return from_kv
    if settings_key:
        from_settings = _get_settings_value(settings_data, settings_key)
        if from_settings is not None:
            return from_settings
    if env_key:
        return _get_env_value(env_key)
    return None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings_data = _read_settings_json()
    kv_data = _read_config_kv_data()
    legacy_employee_zip_url = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="EMPLOYEE_ZIP_URL"
    )
    legacy_skill_remote_base_url = _get_runtime_value(
        kv_data, settings_data, settings_key="endpoint", env_key="SKILL_REMOTE_BASE_URL"
    )
    legacy_login_url = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="LOGIN_URL"
    )
    legacy_mcp_base_url = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="MCP_BASE_URL"
    )

    employee_zip_legacy_base, employee_zip_legacy_path = split_base_and_path(
        legacy_employee_zip_url
    )
    login_legacy_base, login_legacy_path = split_base_and_path(legacy_login_url)
    mcp_legacy_base, mcp_legacy_path = split_base_and_path(legacy_mcp_base_url)

    remote_api_base_url = (
        _get_runtime_value(
            kv_data,
            settings_data,
            settings_key="endpoint",
            env_key="REMOTE_API_BASE_URL",
        )
        or legacy_skill_remote_base_url
        or employee_zip_legacy_base
    )
    employee_zip_path = (
        _get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="EMPLOYEE_ZIP_PATH"
        )
        or employee_zip_legacy_path
        or "/api/v1/employees/export"
    )
    skill_remote_list_path = (
        _get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="SKILL_REMOTE_LIST_PATH"
        )
        or _get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="SKILL_REMOTE_LIST_URL"
        )
        or "/api/v1/client/skills/export"
    )
    skill_remote_detail_path = (
        _get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="SKILL_REMOTE_DETAIL_PATH"
        )
        or "/api/v1/client/skills/export/full/{skill_id}"
    )

    mcp_remote_list_url = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="MCP_REMOTE_LIST_PATH"
    ) or _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="MCP_REMOTE_LIST_URL"
    )
    mcp_remote_detail_url = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="MCP_REMOTE_DETAIL_PATH"
    ) or _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="MCP_REMOTE_DETAIL_URL"
    )

    platform_base_url = (
        _get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="PLATFORM_BASE_URL"
        )
        or login_legacy_base
        or mcp_legacy_base
    )
    mcp_client_base_path = (
        _get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="MCP_CLIENT_BASE_PATH"
        )
        or mcp_legacy_path
        or "/llm/aios/mcp/client"
    )
    login_path = (
        _get_runtime_value(kv_data, settings_data, settings_key=None, env_key="LOGIN_PATH")
        or login_legacy_path
        or "/yc/login"
    )
    sqlite_path = (
        _get_runtime_value(kv_data, settings_data, settings_key=None, env_key="SQLITE_PATH")
        or get_default_sqlite_path()
    )
    skill_path = (
        _get_runtime_value(kv_data, settings_data, settings_key=None, env_key="SKILL_PATH")
        or get_default_skill_path()
    )
    chat_history_max_messages_raw = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="CHAT_HISTORY_MAX_MESSAGES"
    )
    try:
        chat_history_max_messages = int(chat_history_max_messages_raw or "30")
    except ValueError:
        chat_history_max_messages = 30
    skill_remote_timeout_raw = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="SKILL_REMOTE_TIMEOUT"
    )
    try:
        skill_remote_timeout = float(skill_remote_timeout_raw or "15")
    except ValueError:
        skill_remote_timeout = 15.0
    default_workspace_id_raw = _get_runtime_value(
        kv_data, settings_data, settings_key=None, env_key="DEFAULT_WORKSPACE_ID"
    )
    try:
        default_workspace_id = int(default_workspace_id_raw or "1")
    except ValueError:
        default_workspace_id = 1

    return Settings(
        default_workspace_root=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="DEFAULT_WORKSPACE_ROOT"
        ),
        default_workspace_id=default_workspace_id,
        default_workspace_name=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="DEFAULT_WORKSPACE_NAME"
        ) or "默认的工作空间",
        sqlite_path=resolve_configured_path(sqlite_path),
        skill_path=resolve_configured_path(skill_path),
        artifacts_path=get_default_artifacts_path(),
        remote_api_base_url=remote_api_base_url,
        employee_zip_path=employee_zip_path,
        employee_zip_url=join_base_and_path(remote_api_base_url, employee_zip_path)
        or legacy_employee_zip_url,
        employee_tmp_dir=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="EMPLOYEE_TMP_DIR"
        ) or "./tmp/employees",
        deepagent_model=_get_runtime_value(
            kv_data, settings_data, settings_key="model", env_key="DEEPAGENT_MODEL"
        ),
        chat_history_max_messages=chat_history_max_messages,
        api_key=_get_runtime_value(
            kv_data, settings_data, settings_key="apiKey", env_key="OPENAI_API_KEY"
        ),
        base_url=_get_runtime_value(
            kv_data, settings_data, settings_key="apiUrl", env_key="BASE_URL"
        ),
        skill_remote_base_url=remote_api_base_url,
        skill_remote_list_path=skill_remote_list_path,
        skill_remote_detail_path=skill_remote_detail_path,
        skill_remote_token=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="SKILL_REMOTE_TOKEN"
        ),
        skill_remote_timeout=skill_remote_timeout,
        skill_remote_rating=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="SKILL_REMOTE_RATING"
        )
        or "/api/v1/skills/{skill_id}/rating",
        mcp_remote_list_url=mcp_remote_list_url,
        mcp_remote_detail_url=mcp_remote_detail_url,
        platform_base_url=platform_base_url,
        mcp_client_base_path=mcp_client_base_path,
        mcp_tool_call_path=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="MCP_TOOL_CALL_PATH"
        ) or "/tool/call",
        mcp_base_url=join_base_and_path(platform_base_url, mcp_client_base_path)
        or legacy_mcp_base_url,
        agent_interface_base_url=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="AGENT_INTERFACE_BASE_URL"
        ),
        agent_interface_skill_prefix=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="AGENT_INTERFACE_SKILL_PREFIX"
        )
        or "/aios/skill",
        dbchat_base_url=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="DBCHAT_BASE_URL"
        ),
        dbchat_model_chat_simple_path=_get_runtime_value(
            kv_data, settings_data, settings_key=None, env_key="DBCHAT_MODEL_CHAT_SIMPLE_PATH"
        )
        or "/model/chat/simple",
        login_path=login_path,
        login_url=join_base_and_path(platform_base_url, login_path) or legacy_login_url,
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    return _resolve_path(sqlite_path)
