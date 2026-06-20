from src.db.base import Base
from src.db.session import get_engine
from sqlalchemy import inspect, text
import logging

logger = logging.getLogger(__name__)

# Ensure model metadata is registered.
from src import models  # noqa: F401  pylint: disable=unused-import


def init_db() -> None:
    # 新项目=新空库：直接从 models 一步建全 schema，无历史库可升级。
    engine = get_engine()
    Base.metadata.create_all(bind=engine)

    # workspaces 表：幂等加列（已有库不会被 create_all 自动 ALTER）
    _ensure_workspace_auto_grant_column(engine)

    # FTS5 全文索引：conversation_messages.content
    _init_fts5(engine)

    # 启动时清理上次进程遗留的"运行中"流状态。
    _reset_orphaned_streams(engine)


def _ensure_workspace_auto_grant_column(engine) -> None:
    """幂等地为 workspaces 表加 auto_grant_external_dirs 列。

    新库由 create_all 直接建全；已有库不会被 ALTER，需在此补列。
    """
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("workspaces")}
    if "auto_grant_external_dirs" not in cols:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE workspaces ADD COLUMN auto_grant_external_dirs "
                "BOOLEAN NOT NULL DEFAULT 0"
            ))
        logger.info("added column workspaces.auto_grant_external_dirs")


def _reset_orphaned_streams(engine) -> None:
    """启动时清理上次进程遗留的"运行中"流状态。

    后端重启/崩溃会让正在跑的流被打断，但 DB 里的
    conversation_messages.stream_state='streaming'、
    task_execution_logs.run_status in ('running','queued')、
    conversations.status='running' 会永久卡死，导致：
    - 群协作的完成事件永不触发 → 后续任务永远不派发；
    - 前端一直转圈。
    这里把它们重置为终态（中断/失败），让链路可恢复、不卡死。
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        if "conversation_messages" in tables:
            cols = {c["name"] for c in inspector.get_columns("conversation_messages")}
            if "stream_state" in cols:
                r = conn.execute(text(
                    "UPDATE conversation_messages SET stream_state='error' "
                    "WHERE stream_state IN ('streaming','queued')"
                ))
                if getattr(r, "rowcount", 0):
                    logger.info("reset %s orphaned streaming messages", r.rowcount)
        if "task_execution_logs" in tables:
            cols = {c["name"] for c in inspector.get_columns("task_execution_logs")}
            if "run_status" in cols:
                r = conn.execute(text(
                    "UPDATE task_execution_logs SET run_status='failed', "
                    "run_result='进程重启中断' "
                    "WHERE run_status IN ('running','queued')"
                ))
                if getattr(r, "rowcount", 0):
                    logger.info("reset %s orphaned running task logs", r.rowcount)
        if "conversations" in tables:
            cols = {c["name"] for c in inspector.get_columns("conversations")}
            if "status" in cols:
                conn.execute(text(
                    "UPDATE conversations SET status='idle' "
                    "WHERE status IN ('running','interrupted')"
                ))


def _init_fts5(engine) -> None:
    """为 conversation_messages.content 创建 FTS5 全文索引。"""
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS conversation_messages_fts
            USING fts5(content, content='conversation_messages', content_rowid='id', tokenize='unicode61')
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS cm_fts_insert AFTER INSERT ON conversation_messages
            BEGIN
                INSERT INTO conversation_messages_fts(rowid, content) VALUES (new.id, new.content);
            END
        """))
        conn.execute(text(
            "INSERT INTO conversation_messages_fts(conversation_messages_fts) VALUES('rebuild')"
        ))
        conn.commit()
