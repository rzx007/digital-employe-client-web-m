from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


@dataclass(slots=True)
class Settings:
    default_workspace_root: str | None
    default_workspace_id: int
    default_workspace_name: str | None
    sqlite_path: str
    employee_zip_url: str | None
    employee_tmp_dir: str
    deepagent_model: str | None
    chat_history_max_messages: int
    api_key: str | None
    base_url: str | None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        default_workspace_root=os.getenv("DEFAULT_WORKSPACE_ROOT") or None,
        default_workspace_id=int(os.getenv("DEFAULT_WORKSPACE_ID", "1")),
        default_workspace_name=os.getenv("DEFAULT_WORKSPACE_NAME") or "默认的工作空间",
        sqlite_path=os.getenv("SQLITE_PATH", "./data/app.db"),
        employee_zip_url=os.getenv("EMPLOYEE_ZIP_URL") or None,
        employee_tmp_dir=os.getenv("EMPLOYEE_TMP_DIR", "./tmp/employees"),
        deepagent_model=os.getenv("DEEPAGENT_MODEL") or None,
        chat_history_max_messages=int(os.getenv("CHAT_HISTORY_MAX_MESSAGES", "30")),
        api_key=os.getenv("OPENAI_API_KEY") or None,
        base_url=os.getenv("BASE_URL") or None,
    )


def resolve_sqlite_path(sqlite_path: str) -> Path:
    path = Path(sqlite_path)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path
