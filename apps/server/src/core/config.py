from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def get_default_sqlite_path() -> str:
    return str(Path.home() / ".digital-employee" / "data" / "app.db")


def get_default_skill_path() -> str:
    return str(Path.home() / "digital-employee-client" / "employees-skills")


def resolve_configured_path(path_value: str) -> str:
    path = Path(os.path.expandvars(os.path.expanduser(path_value)))
    if not path.is_absolute():
        path = Path.cwd() / path
    return str(path)


@dataclass(slots=True)
class Settings:
    default_workspace_root: str | None
    default_workspace_id: int
    default_workspace_name: str | None
    sqlite_path: str
    skill_path: str
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        default_workspace_root=os.getenv("DEFAULT_WORKSPACE_ROOT") or None,
        default_workspace_id=int(os.getenv("DEFAULT_WORKSPACE_ID", "1")),
        default_workspace_name=os.getenv("DEFAULT_WORKSPACE_NAME") or "默认的工作空间",
        sqlite_path=get_default_sqlite_path(),
        skill_path=resolve_configured_path(
            os.getenv("SKILL_PATH", get_default_skill_path())
        ),
        employee_zip_url=os.getenv("EMPLOYEE_ZIP_URL") or None,
        employee_tmp_dir=os.getenv("EMPLOYEE_TMP_DIR", "./tmp/employees"),
        deepagent_model=os.getenv("DEEPAGENT_MODEL") or None,
        chat_history_max_messages=int(os.getenv("CHAT_HISTORY_MAX_MESSAGES", "30")),
        api_key=os.getenv("OPENAI_API_KEY") or None,
        base_url=os.getenv("BASE_URL") or None,
        skill_remote_base_url=os.getenv("SKILL_REMOTE_BASE_URL") or None,
        skill_remote_token=os.getenv("SKILL_REMOTE_TOKEN") or None,
        skill_remote_timeout=float(os.getenv("SKILL_REMOTE_TIMEOUT", "15")),
        skill_remote_rating=os.getenv("SKILL_REMOTE_RATING") or None,
        mcp_remote_list_url=os.getenv("MCP_REMOTE_LIST_URL") or None,
        mcp_remote_detail_url=os.getenv("MCP_REMOTE_DETAIL_URL") or None,
        mcp_base_url=os.getenv("MCP_BASE_URL") or None,
        agent_interface_base_url=os.getenv("AGENT_INTERFACE_BASE_URL") or None,
        dbchat_base_url=os.getenv("DBCHAT_BASE_URL") or None,
        login_url=os.getenv("LOGIN_URL") or None,
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(sqlite_path)))
    if not path.is_absolute():
        path = Path.cwd() / path
    return path
