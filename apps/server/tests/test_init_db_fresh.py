"""新空库回归：init_db() 一步从 models 建全 schema。

新项目=新库，无历史库可升级。删掉 ensure_column/表重建迁移/回填后，
本测试锁住 create_all 路径仍能建出关键列、FTS5 虚表可用、基本读写通，
确保 _init_fts5 / _reset_orphaned_streams 未被误删。
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool


def _make_file_engine(db_path: Path):
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_connection, _record):  # noqa: ANN001
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    return engine


def test_init_db_builds_full_schema(monkeypatch):
    import src.db.init_db as init_db_mod

    with tempfile.TemporaryDirectory(prefix="de-init-db-") as tmp:
        db_path = Path(tmp) / "fresh.db"
        engine = _make_file_engine(db_path)
        # init_db() 内部用 get_engine()；指向临时文件库。
        monkeypatch.setattr(init_db_mod, "get_engine", lambda: engine)

        init_db_mod.init_db()

        inspector = inspect(engine)

        # 抽查关键列齐备（皆由 models 经 create_all 直接建出）
        expected = {
            "employees": "is_curator",
            "employee_tasks": "rework_count",
            "task_execution_logs": "qa_accepted_at",
            "conversations": "user_id",
            "conversation_messages": "message_parts",
        }
        for table, col in expected.items():
            cols = {c["name"] for c in inspector.get_columns(table)}
            assert col in cols, f"{table}.{col} 缺失"

        # FTS5 虚表 + 触发器存在
        tables = set(inspector.get_table_names())
        assert "conversation_messages_fts" in tables

        # 基本读写通：插入一条 conversation_message，FTS5 触发器应同步可检索
        # model 的时间戳列由 Python 端 default 填充，raw SQL 须显式给值。
        ts = "2026-01-01 00:00:00"
        Session = sessionmaker(bind=engine)
        with Session() as db:
            db.execute(text(
                "INSERT INTO workspaces(id, name, root_path, created_at, updated_at) "
                "VALUES (1, 'w', '/tmp/w', :ts, :ts)"
            ), {"ts": ts})
            db.execute(text(
                "INSERT INTO conversations(id, workspace_id, target_type, target_id, "
                "status, created_at, updated_at) "
                "VALUES (1, 1, 'curator', 1, 'idle', :ts, :ts)"
            ), {"ts": ts})
            db.execute(text(
                "INSERT INTO conversation_messages(id, conversation_id, role, content, "
                "created_at) "
                "VALUES (1, 1, 'user', 'hello fulltext search', :ts)"
            ), {"ts": ts})
            db.commit()

            hit = db.execute(text(
                "SELECT rowid FROM conversation_messages_fts "
                "WHERE conversation_messages_fts MATCH 'fulltext'"
            )).fetchall()
            assert hit == [(1,)]

        engine.dispose()
