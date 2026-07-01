import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS builds (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_slug TEXT NOT NULL,
              git_ref TEXT NOT NULL,
              triggered_by TEXT,
              pipeline_id INTEGER,
              pipeline_url TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              asset_commit TEXT,
              artifact_hint TEXT,
              created_at TEXT NOT NULL,
              finished_at TEXT
            )
            """
        )
        conn.commit()


@contextmanager
def connect(path: str):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def list_builds(path: str, limit: int = 50) -> list[dict[str, Any]]:
    with connect(path) as conn:
        rows = conn.execute(
            "SELECT * FROM builds ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_build(path: str, build_id: int) -> dict[str, Any] | None:
    with connect(path) as conn:
        row = conn.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone()
        return dict(row) if row else None


def create_build(
    path: str,
    *,
    project_slug: str,
    git_ref: str,
    triggered_by: str | None,
    asset_commit: str | None = None,
) -> int:
    with connect(path) as conn:
        cur = conn.execute(
            """
            INSERT INTO builds (project_slug, git_ref, triggered_by, asset_commit, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (project_slug, git_ref, triggered_by, asset_commit, _utc_now()),
        )
        return int(cur.lastrowid)


def update_build_pipeline(
    path: str,
    build_id: int,
    *,
    pipeline_id: int,
    pipeline_url: str,
    status: str = "running",
) -> None:
    with connect(path) as conn:
        conn.execute(
            """
            UPDATE builds SET pipeline_id = ?, pipeline_url = ?, status = ?
            WHERE id = ?
            """,
            (pipeline_id, pipeline_url, status, build_id),
        )


def update_build_status(path: str, build_id: int, *, status: str) -> None:
    with connect(path) as conn:
        conn.execute(
            """
            UPDATE builds SET status = ?, finished_at = ?
            WHERE id = ?
            """,
            (status, _utc_now(), build_id),
        )
