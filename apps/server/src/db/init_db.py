from src.db.base import Base
from src.db.session import get_engine
from sqlalchemy import inspect, text

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

    ensure_column("orchestration_plans", "started_at", "started_at DATETIME")

