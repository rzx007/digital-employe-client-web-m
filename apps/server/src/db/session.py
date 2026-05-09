from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from src.core.config import get_settings, resolve_sqlite_path


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    sqlite_path = resolve_sqlite_path(settings.sqlite_path)
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{sqlite_path}",
        connect_args={"check_same_thread": False, "timeout": 30.0},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    return engine


@lru_cache(maxsize=1)
def get_session_local() -> sessionmaker:
    return sessionmaker(autocommit=False, autoflush=False, bind=get_engine())


def get_db() -> Session:
    db = get_session_local()()
    try:
        yield db
    finally:
        db.close()


def reset_session_state() -> None:
    get_session_local.cache_clear()
    get_engine.cache_clear()

