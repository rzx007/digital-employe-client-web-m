from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv()


def get_default_sqlite_path() -> str:
    return str(Path.home() / ".digital-employee" / "data" / "app.db")


def get_default_skill_path() -> str:
    return str(Path.home() / ".digital-employee" / "employees-skills")


def resolve_configured_path(path_value: str) -> str:
    path = Path(os.path.expandvars(os.path.expanduser(path_value)))
    if not path.is_absolute():
        path = Path.cwd() / path
    return str(path)


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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    legacy_employee_zip_url = os.getenv("EMPLOYEE_ZIP_URL")
    legacy_skill_remote_base_url = os.getenv("SKILL_REMOTE_BASE_URL")
    legacy_mcp_base_url = os.getenv("MCP_BASE_URL")
    legacy_login_url = os.getenv("LOGIN_URL")

    employee_zip_legacy_base, employee_zip_legacy_path = split_base_and_path(
        legacy_employee_zip_url
    )
    mcp_legacy_base, mcp_legacy_path = split_base_and_path(legacy_mcp_base_url)
    login_legacy_base, login_legacy_path = split_base_and_path(legacy_login_url)

    remote_api_base_url = (
        os.getenv("REMOTE_API_BASE_URL")
        or legacy_skill_remote_base_url
        or employee_zip_legacy_base
    )
    employee_zip_path = (
        os.getenv("EMPLOYEE_ZIP_PATH")
        or employee_zip_legacy_path
        or "/api/v1/employees/export"
    )
    skill_remote_list_path = os.getenv(
        "SKILL_REMOTE_LIST_PATH", "/api/v1/client/skills/export"
    )
    skill_remote_detail_path = os.getenv(
        "SKILL_REMOTE_DETAIL_PATH", "/api/v1/client/skills/export/full/{skill_id}"
    )
    mcp_remote_list_path = os.getenv("MCP_REMOTE_LIST_PATH") or os.getenv(
        "MCP_REMOTE_LIST_URL"
    )
    mcp_remote_detail_path = os.getenv("MCP_REMOTE_DETAIL_PATH") or os.getenv(
        "MCP_REMOTE_DETAIL_URL"
    )

    platform_base_url = (
        os.getenv("PLATFORM_BASE_URL")
        or login_legacy_base
        or mcp_legacy_base
    )
    mcp_client_base_path = (
        os.getenv("MCP_CLIENT_BASE_PATH")
        or mcp_legacy_path
        or "/llm/aios/mcp/client"
    )
    login_path = os.getenv("LOGIN_PATH") or login_legacy_path or "/yc/login"

    return Settings(
        default_workspace_root=os.getenv("DEFAULT_WORKSPACE_ROOT") or None,
        default_workspace_id=int(os.getenv("DEFAULT_WORKSPACE_ID", "1")),
        default_workspace_name=os.getenv("DEFAULT_WORKSPACE_NAME") or "默认的工作空间",
        sqlite_path=get_default_sqlite_path(),
        skill_path=resolve_configured_path(
            os.getenv("SKILL_PATH", get_default_skill_path())
        ),
        remote_api_base_url=remote_api_base_url,
        employee_zip_path=employee_zip_path,
        employee_zip_url=join_base_and_path(remote_api_base_url, employee_zip_path)
        or legacy_employee_zip_url
        or None,
        employee_tmp_dir=os.getenv("EMPLOYEE_TMP_DIR", "./tmp/employees"),
        deepagent_model=os.getenv("DEEPAGENT_MODEL") or None,
        chat_history_max_messages=int(os.getenv("CHAT_HISTORY_MAX_MESSAGES", "30")),
        api_key=os.getenv("OPENAI_API_KEY") or None,
        base_url=os.getenv("BASE_URL") or None,
        skill_remote_base_url=remote_api_base_url,
        skill_remote_list_path=skill_remote_list_path,
        skill_remote_detail_path=skill_remote_detail_path,
        skill_remote_token=os.getenv("SKILL_REMOTE_TOKEN") or None,
        skill_remote_timeout=float(os.getenv("SKILL_REMOTE_TIMEOUT", "15")),
        skill_remote_rating=os.getenv(
            "SKILL_REMOTE_RATING", "/api/v1/skills/{skill_id}/rating"
        ),
        mcp_remote_list_url=mcp_remote_list_path or None,
        mcp_remote_detail_url=mcp_remote_detail_path or None,
        platform_base_url=platform_base_url,
        mcp_client_base_path=mcp_client_base_path,
        mcp_tool_call_path=os.getenv("MCP_TOOL_CALL_PATH", "/tool/call"),
        mcp_base_url=join_base_and_path(platform_base_url, mcp_client_base_path)
        or legacy_mcp_base_url
        or None,
        agent_interface_base_url=os.getenv("AGENT_INTERFACE_BASE_URL") or None,
        agent_interface_skill_prefix=os.getenv(
            "AGENT_INTERFACE_SKILL_PREFIX", "/aios/skill"
        ),
        dbchat_base_url=os.getenv("DBCHAT_BASE_URL") or None,
        dbchat_model_chat_simple_path=os.getenv(
            "DBCHAT_MODEL_CHAT_SIMPLE_PATH", "/model/chat/simple"
        ),
        login_path=login_path,
        login_url=join_base_and_path(platform_base_url, login_path)
        or legacy_login_url
        or None,
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(sqlite_path)))
    if not path.is_absolute():
        path = Path.cwd() / path
    return path
