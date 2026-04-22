from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

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


@dataclass(slots=True)
class Settings:
    default_workspace_root: str | None
    default_workspace_id: int
    default_workspace_name: str | None
    sqlite_path: str
    skill_path: str
    artifacts_path: str
    employee_zip_url: str | None
    employee_tmp_dir: str
    deepagent_model: str | None
    chat_history_max_messages: int
    api_key: str | None
    base_url: str | None
    skill_remote_base_url: str | None
    skill_remote_token: str | None
    skill_remote_timeout: float
    skill_remote_rating: str | None
    mcp_remote_list_url: str | None
    mcp_remote_detail_url: str | None
    mcp_base_url: str | None = None
    agent_interface_base_url: str | None = None
    dbchat_base_url: str | None = None
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


def _get_config_value(
    settings_data: dict[str, object], settings_key: str, env_key: str
) -> str | None:
    """优先从 settings.json 读取，fallback 到环境变量。"""
    return _get_settings_value(settings_data, settings_key) or _get_env_value(env_key)


def _safe_int_env(key: str, default: int) -> int:
    value = os.getenv(key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _safe_float_env(key: str, default: float) -> float:
    value = os.getenv(key)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def get_settings() -> Settings:
    settings_data = _read_settings_json()
    return Settings(
        default_workspace_root=_get_env_value("DEFAULT_WORKSPACE_ROOT"),
        default_workspace_id=_safe_int_env("DEFAULT_WORKSPACE_ID", 1),
        default_workspace_name=_get_env_value("DEFAULT_WORKSPACE_NAME") or "默认的工作空间",
        sqlite_path=get_default_sqlite_path(),
        skill_path=resolve_configured_path(
            os.getenv("SKILL_PATH", get_default_skill_path())
        ),
        artifacts_path=get_default_artifacts_path(),
        employee_zip_url=_get_env_value("EMPLOYEE_ZIP_URL"),
        employee_tmp_dir=_get_env_value("EMPLOYEE_TMP_DIR") or "./tmp/employees",
        deepagent_model=_get_config_value(
            settings_data, "model", "DEEPAGENT_MODEL"
        ),
        chat_history_max_messages=_safe_int_env("CHAT_HISTORY_MAX_MESSAGES", 30),
        api_key=_get_config_value(settings_data, "apiKey", "OPENAI_API_KEY"),
        base_url=_get_config_value(settings_data, "apiUrl", "BASE_URL"),
        skill_remote_base_url=_get_config_value(
            settings_data, "endpoint", "SKILL_REMOTE_BASE_URL"
        ),
        skill_remote_token=_get_env_value("SKILL_REMOTE_TOKEN"),
        skill_remote_timeout=_safe_float_env("SKILL_REMOTE_TIMEOUT", 15.0),
        skill_remote_rating=_get_env_value("SKILL_REMOTE_RATING"),
        mcp_remote_list_url=_get_env_value("MCP_REMOTE_LIST_URL"),
        mcp_remote_detail_url=_get_env_value("MCP_REMOTE_DETAIL_URL"),
        mcp_base_url=_get_env_value("MCP_BASE_URL"),
        agent_interface_base_url=_get_env_value("AGENT_INTERFACE_BASE_URL"),
        dbchat_base_url=_get_env_value("DBCHAT_BASE_URL"),
        login_url=_get_env_value("LOGIN_URL"),
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    return _resolve_path(sqlite_path)
