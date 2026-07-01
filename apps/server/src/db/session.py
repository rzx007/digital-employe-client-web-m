from __future__ import annotations

import threading
from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from src.core.config import get_settings, resolve_sqlite_path

# 桌面端单文件 SQLite：NullPool 每请求新建连接，并发仍须串行化 ORM 访问。
SQLITE_ACCESS_LOCK = threading.RLock()


@contextmanager
def sqlite_db_session() -> Iterator[Session]:
    """线程安全的短生命周期 Session（总管 Tool、流式 flush 等）。"""
    SQLITE_ACCESS_LOCK.acquire()
    db = get_session_local()()
    try:
        yield db
    finally:
        db.close()
        SQLITE_ACCESS_LOCK.release()


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    sqlite_path = resolve_sqlite_path(settings.sqlite_path)
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{sqlite_path}",
        connect_args={"check_same_thread": False, "timeout": 30.0},
        poolclass=NullPool,
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

