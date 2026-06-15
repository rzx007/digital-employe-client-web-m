from src.db.base import Base
from src.db.session import get_engine
from sqlalchemy import inspect, text
import logging

logger = logging.getLogger(__name__)

# Ensure model metadata is registered.
from src import models  # noqa: F401  pylint: disable=unused-import


def init_db() -> None:
    Base.metadata.create_all(bind=get_engine())

    # 兼容已有 SQLite 数据库：为 employees 表补充新增字段
    engine = get_engine()
    inspector = inspect(engine)

    def ensure_column(table_name: str, column_name: str, column_sql: str) -> None:
        if table_name not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns(table_name)}
        if column_name in columns:
            return
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}"))

    if "employees" in inspector.get_table_names():
        columns = {col["name"] for col in inspector.get_columns("employees")}
        if "description" not in columns:
            # SQLite 支持 ALTER TABLE ADD COLUMN；历史库也能升级。
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE employees ADD COLUMN description TEXT"))
        if "shift_schedule_json" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE employees ADD COLUMN shift_schedule_json TEXT DEFAULT '{}'"))

    ensure_column("employees", "is_curator", "is_curator BOOLEAN NOT NULL DEFAULT 0")
    ensure_column("employees", "avatar_url", "avatar_url VARCHAR(512)")

    # 兼容历史任务表：补充新增字段
    ensure_column("employee_tasks", "next_run_at", "next_run_at DATETIME")
    ensure_column("employee_tasks", "last_run_at", "last_run_at DATETIME")
    ensure_column(
        "employee_tasks",
        "confirm_execution_result",
        "confirm_execution_result BOOLEAN NOT NULL DEFAULT 0",
    )
    ensure_column("employee_tasks", "user_prompt", "user_prompt TEXT")
    ensure_column("employee_tasks", "capability_id", "capability_id INTEGER")
    ensure_column("employee_tasks", "source", "source VARCHAR(32) NOT NULL DEFAULT 'manual'")
    ensure_column("employee_tasks", "orchestration_plan_id", "orchestration_plan_id INTEGER")
    ensure_column("employee_tasks", "execute_mode", "execute_mode VARCHAR(32) NOT NULL DEFAULT 'scheduled'")
    ensure_column("employee_tasks", "valid_from", "valid_from DATETIME")
    ensure_column("employee_tasks", "valid_until", "valid_until DATETIME")
    ensure_column(
        "employee_tasks",
        "source_conversation_id",
        "source_conversation_id INTEGER",
    )
    ensure_column(
        "task_execution_logs",
        "orchestrator_conversation_id",
        "orchestrator_conversation_id INTEGER",
    )
    ensure_column(
        "task_execution_logs",
        "confirm_url",
        "confirm_url VARCHAR(2048)",
    )
    ensure_column(
        "task_execution_logs",
        "result_confirmed",
        "result_confirmed BOOLEAN NOT NULL DEFAULT 0",
    )
    ensure_column(
        "task_execution_logs",
        "is_read",
        "is_read BOOLEAN NOT NULL DEFAULT 0",
    )
    ensure_column("task_execution_logs", "conversation_id", "conversation_id INTEGER")
    ensure_column("task_execution_logs", "last_heartbeat_at", "last_heartbeat_at DATETIME")
    ensure_column("skill_ratings", "task_execution_log_id", "task_execution_log_id INTEGER")
    ensure_column(
        "dispatch_orders_sync",
        "remote_order_id",
        "remote_order_id INTEGER NOT NULL DEFAULT 0",
    )
    ensure_column(
        "dispatch_orders_sync",
        "order_name",
        "order_name VARCHAR(128) NOT NULL DEFAULT ''",
    )
    ensure_column(
        "dispatch_orders_sync",
        "dispatcher",
        "dispatcher VARCHAR(45) NOT NULL DEFAULT ''",
    )
    ensure_column(
        "dispatch_orders_sync",
        "receiver",
        "receiver VARCHAR(45) NOT NULL DEFAULT ''",
    )
    ensure_column("dispatch_orders_sync", "start_time", "start_time DATETIME")
    ensure_column("dispatch_orders_sync", "end_time", "end_time DATETIME")
    ensure_column("dispatch_orders_sync", "occur_time", "occur_time DATETIME")
    ensure_column(
        "dispatch_orders_sync",
        "status",
        "status VARCHAR(45) NOT NULL DEFAULT ''",
    )
    ensure_column("dispatch_orders_sync", "eval", "eval FLOAT")
    ensure_column(
        "dispatch_orders_sync",
        "content",
        "content TEXT NOT NULL DEFAULT ''",
    )
    ensure_column("dispatch_orders_sync", "comment", "comment VARCHAR(256)")
    ensure_column(
        "dispatch_orders_sync",
        "trigger_status",
        "trigger_status VARCHAR(32) NOT NULL DEFAULT 'pending'",
    )
    ensure_column("dispatch_orders_sync", "trigger_error", "trigger_error TEXT")
    ensure_column(
        "dispatch_orders_sync",
        "last_triggered_at",
        "last_triggered_at DATETIME",
    )
    ensure_column(
        "dispatch_orders_sync",
        "last_synced_at",
        "last_synced_at DATETIME",
    )

    # 兼容历史员工技能关系表：补充新增字段
    ensure_column("employee_skills", "skill_name", "skill_name VARCHAR(255) NOT NULL DEFAULT ''")
    ensure_column("employee_skills", "skill_description", "skill_description VARCHAR(1000)")
    ensure_column("employee_skills", "prompt", "prompt TEXT")
    ensure_column("employee_skills", "skill_content", "skill_content TEXT")

    # 员工 MCP 关联表（字段与远程 MCP 详情一致 + 关联键）
    ensure_column("employee_mcps", "workspace_id", "workspace_id INTEGER")
    ensure_column("employee_mcps", "employee_id", "employee_id INTEGER")
    ensure_column("employee_mcps", "mcp_id", "mcp_id INTEGER")
    ensure_column("employee_mcps", "mcp_server_name", "mcp_server_name VARCHAR(255)")
    ensure_column("employee_mcps", "mcp_tool_name", "mcp_tool_name VARCHAR(255)")
    ensure_column("employee_mcps", "capability_name", "capability_name VARCHAR(255)")
    ensure_column("employee_mcps", "capability_desc", "capability_desc TEXT")
    ensure_column("employee_mcps", "creator_id", "creator_id INTEGER")
    ensure_column("employee_mcps", "api_created_at", "api_created_at VARCHAR(32)")
    ensure_column("employee_mcps", "api_updated_at", "api_updated_at VARCHAR(32)")

    # 兼容历史工作空间表：补充 user_id 字段（用户隔离）
    ensure_column("workspaces", "user_id", "user_id TEXT")

    # 兼容历史会话消息表：补充 metadata 字段
    ensure_column("conversation_messages", "extra_meta", "extra_meta TEXT")

    # 兼容历史会话消息表：补充流状态字段（断线重连用）
    # 取值: "streaming" | "completed" | "error" | NULL（旧消息无此字段
    ensure_column(
        "conversation_messages", "stream_state", "stream_state VARCHAR(32)"
    )
    # 已发送的最后一个事件序列号
    ensure_column(
        "conversation_messages",
        "stream_cursor",
        "stream_cursor INTEGER DEFAULT 0",
    )
    # 序列化的事件列表（JSON array），用于断线重放
    ensure_column("conversation_messages", "stream_chunks", "stream_chunks TEXT")
    # 预计算的结构化 parts（JSON），前端直接渲染
    ensure_column("conversation_messages", "message_parts", "message_parts TEXT")

    # 群时间线作者归属（多员工群聊协作）：仅 target_type="group" 会话使用
    ensure_column("conversation_messages", "sender_id", "sender_id INTEGER")
    ensure_column(
        "conversation_messages", "sender_label", "sender_label VARCHAR(255)"
    )

    # Migration: conversations.title 从 VARCHAR(255) 改为 TEXT（去掉长度限制）
    if "conversations" in inspector.get_table_names():
        _migrate_conversation_title_to_text(engine, inspector)

    ensure_column("conversations", "status", "status VARCHAR(32) NOT NULL DEFAULT 'idle'")
    ensure_column("conversations", "session_flags", "session_flags TEXT")

    ensure_column("orchestration_plans", "started_at", "started_at DATETIME")

    # Migration: task_execution_logs.task_id 改为 nullable + SET NULL
    # 真删除任务前需要保留执行记录，task_id 允许 NULL
    if "task_execution_logs" in inspector.get_table_names():
        _migrate_task_id_nullable(engine, inspector)

    # FTS5 全文索引：conversation_messages.content
    _init_fts5(engine)

    from src.service.orchestrator_conversation_links import (
        backfill_orchestrator_conversation_links,
    )

    backfill_orchestrator_conversation_links(engine)

    _reset_orphaned_streams(engine)


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


def _migrate_task_id_nullable(engine, inspector) -> None:
    """SQLite 表重建：将 task_execution_logs.task_id 从 NOT NULL CASCADE 改为 nullable SET NULL。"""
    col_info = None
    for col in inspector.get_columns("task_execution_logs"):
        if col["name"] == "task_id":
            col_info = col
            break
    if not col_info or col_info.get("nullable", False):
        return

    logger.info("Migrating task_execution_logs.task_id to nullable ...")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE _task_execution_logs_new ("
                          "id INTEGER PRIMARY KEY,"
                          "task_id INTEGER REFERENCES employee_tasks(id) ON DELETE SET NULL,"
                          "workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,"
                          "employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,"
                          "skill_id INTEGER,"
                          "conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,"
                          "task_name_snapshot VARCHAR(255) NOT NULL,"
                          "run_status VARCHAR(32) NOT NULL,"
                          "run_result VARCHAR(255),"
                          "error_message TEXT,"
                          "input_json TEXT NOT NULL DEFAULT '{}',"
                          "output_json TEXT NOT NULL DEFAULT '{}',"
                          "started_at DATETIME NOT NULL,"
                          "ended_at DATETIME,"
                          "duration_ms INTEGER,"
                          "last_heartbeat_at DATETIME,"
                          "confirm_url VARCHAR(2048),"
                          "result_confirmed BOOLEAN NOT NULL DEFAULT 0,"
                          "is_read BOOLEAN NOT NULL DEFAULT 0,"
                          "created_at DATETIME"
                          ")"))
        conn.execute(text("INSERT INTO _task_execution_logs_new "
                          "SELECT id, task_id, workspace_id, employee_id, skill_id, "
                          "conversation_id, task_name_snapshot, run_status, run_result, "
                          "error_message, input_json, output_json, started_at, ended_at, "
                          "duration_ms, last_heartbeat_at, confirm_url, result_confirmed, "
                          "is_read, created_at "
                          "FROM task_execution_logs"))
        conn.execute(text("DROP TABLE task_execution_logs"))
        conn.execute(text("ALTER TABLE _task_execution_logs_new RENAME TO task_execution_logs"))
        for idx_sql in [
            "CREATE INDEX ix_task_execution_logs_task_id ON task_execution_logs(task_id)",
            "CREATE INDEX ix_task_execution_logs_workspace_id ON task_execution_logs(workspace_id)",
            "CREATE INDEX ix_task_execution_logs_employee_id ON task_execution_logs(employee_id)",
            "CREATE INDEX ix_task_execution_logs_conversation_id ON task_execution_logs(conversation_id)",
            "CREATE INDEX ix_task_execution_logs_task_name_snapshot ON task_execution_logs(task_name_snapshot)",
            "CREATE INDEX ix_task_execution_logs_run_status ON task_execution_logs(run_status)",
            "CREATE INDEX ix_task_execution_logs_started_at ON task_execution_logs(started_at)",
            "CREATE INDEX ix_task_execution_logs_ended_at ON task_execution_logs(ended_at)",
            "CREATE INDEX ix_task_execution_logs_created_at ON task_execution_logs(created_at)",
            "CREATE INDEX ix_task_execution_logs_result_confirmed ON task_execution_logs(result_confirmed)",
            "CREATE INDEX ix_task_execution_logs_is_read ON task_execution_logs(is_read)",
            "CREATE INDEX ix_task_execution_logs_skill_id ON task_execution_logs(skill_id)",
        ]:
            conn.execute(text(idx_sql))
    logger.info("Migrated task_execution_logs.task_id to nullable successfully")


def _migrate_conversation_title_to_text(engine, inspector) -> None:
    """SQLite 表重建：将 conversations.title 迁移为 TEXT，去掉 255 长度限制。"""
    columns = inspector.get_columns("conversations")
    title_col = next((col for col in columns if col["name"] == "title"), None)
    if not title_col:
        return

    title_type = str(title_col.get("type", "")).upper()
    # 已是 TEXT（或无长度文本）则跳过
    if "TEXT" in title_type and "VARCHAR" not in title_type:
        return

    logger.info("Migrating conversations.title to TEXT ...")
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        try:
            conn.execute(text("CREATE TABLE _conversations_new ("
                              "id INTEGER PRIMARY KEY,"
                              "workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,"
                              "target_type VARCHAR(32) NOT NULL,"
                              "target_id INTEGER NOT NULL,"
                              "title TEXT,"
                              "created_at DATETIME,"
                              "updated_at DATETIME"
                              ")"))
            conn.execute(text("INSERT INTO _conversations_new "
                              "SELECT id, workspace_id, target_type, target_id, title, created_at, updated_at "
                              "FROM conversations"))
            conn.execute(text("DROP TABLE conversations"))
            conn.execute(text("ALTER TABLE _conversations_new RENAME TO conversations"))
            for idx_sql in [
                "CREATE INDEX ix_conversations_id ON conversations(id)",
                "CREATE INDEX ix_conversations_workspace_id ON conversations(workspace_id)",
                "CREATE INDEX ix_conversations_target_type ON conversations(target_type)",
                "CREATE INDEX ix_conversations_target_id ON conversations(target_id)",
            ]:
                conn.execute(text(idx_sql))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
    logger.info("Migrated conversations.title to TEXT successfully")


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

