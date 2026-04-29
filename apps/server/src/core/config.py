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
    return Path.home() / ".digital-employee" / "logs"


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
    default_workspace_root: str | None
    default_workspace_id: int
    default_workspace_name: str | None
    sqlite_path: str
    skill_path: str
    builtin_skills_path: str
    local_skills_path: str
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
    mcp_base_url: str | None = None
    agent_interface_base_url: str | None = None
    agent_interface_skill_prefix: str = "/aios/skill"
    skill_dir_path: str = "/api/v1/client/skills/directories"
    skill_remote_import_path: str = "/api/v1/client/skills/import"
    skill_name_validate_path: str = "/api/v1/client/skills/name/exists"
    client_skill_import_max_bytes: int = 52428800
    login_path: str | None = None
    login_url: str | None = None
    update_user_password_url: str | None = None
    execute_timeout: int = 600
    feishu_app_id: str | None = None
    feishu_app_secret: str | None = None
    feishu_redirect_uri: str | None = None


def _get_kv_value(kv_data: dict[str, str], key: str) -> str | None:
    value = kv_data.get(key)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized if normalized else None


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
    employee_zip_path = (
        _get_kv_value(kv_data, "EMPLOYEE_ZIP_PATH") or "/api/v1/employees/export"
    )
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

    return Settings(
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
        employee_zip_path=employee_zip_path,
        employee_zip_url=join_base_and_path(remote_api_base_url, employee_zip_path),
        employee_tmp_dir=_get_kv_value(kv_data, "EMPLOYEE_TMP_DIR") or "./tmp/employees",
        deepagent_model=_get_kv_value(kv_data, "DEEPAGENT_MODEL"),
        chat_history_max_messages=chat_history_max_messages,
        api_key=_get_kv_value(kv_data, "OPENAI_API_KEY"),
        base_url=_get_kv_value(kv_data, "BASE_URL"),
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
        client_skill_import_max_bytes=client_skill_import_max_bytes,
        login_url=join_base_and_path(platform_base_url, login_path),
        update_user_password_url=join_base_and_path(platform_base_url, update_user_password_path),
        feishu_app_id=_get_kv_value(kv_data, "FEISHU_APP_ID"),
        feishu_app_secret=_get_kv_value(kv_data, "FEISHU_APP_SECRET"),
        feishu_redirect_uri=_get_kv_value(kv_data, "FEISHU_REDIRECT_URI"),
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    return _resolve_path(sqlite_path)
