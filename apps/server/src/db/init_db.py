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
    ensure_column("skill_ratings", "task_execution_log_id", "task_execution_log_id INTEGER")

    # 兼容历史员工技能关系表：补充新增字段
    ensure_column("employee_skills", "skill_name", "skill_name VARCHAR(255) NOT NULL DEFAULT ''")
    ensure_column("employee_skills", "skill_description", "skill_description VARCHAR(1000)")
    ensure_column("employee_skills", "prompt", "prompt TEXT")
    ensure_column("employee_skills", "skill_content", "skill_content TEXT")

    # 兼容历史员工 MCP 关联表：补充新增字段
    ensure_column("employee_mcps", "workspace_id", "workspace_id INTEGER")
    ensure_column("employee_mcps", "employee_id", "employee_id INTEGER")
    ensure_column("employee_mcps", "mcp_id", "mcp_id INTEGER")
    ensure_column("employee_mcps", "server_name", "server_name VARCHAR(255)")
    ensure_column("employee_mcps", "server_addr", "server_addr VARCHAR(1000)")
    ensure_column("employee_mcps", "server_describe", "server_describe VARCHAR(1000)")
    ensure_column("employee_mcps", "directory_id", "directory_id INTEGER")
    ensure_column("employee_mcps", "directory_name", "directory_name VARCHAR(255)")
    ensure_column("employee_mcps", "tool_num", "tool_num INTEGER")
    ensure_column("employee_mcps", "status", "status INTEGER")
    ensure_column("employee_mcps", "create_time", "create_time VARCHAR(32)")
    ensure_column("employee_mcps", "update_time", "update_time VARCHAR(32)")
    ensure_column("employee_mcps", "source_type", "source_type VARCHAR(255)")
    ensure_column("employee_mcps", "content", "content TEXT")
    ensure_column("employee_mcps", "call_timeout", "call_timeout INTEGER")
    ensure_column("employee_mcps", "recovery", "recovery BOOLEAN NOT NULL DEFAULT 0")
    ensure_column("employee_mcps", "aios_mcp_result_json", "aios_mcp_result_json TEXT")
    ensure_column("employee_mcps", "mcp_sync_client_json", "mcp_sync_client_json TEXT")
    ensure_column(
        "employee_mcps",
        "aios_mcp_authorize_dto_json",
        "aios_mcp_authorize_dto_json TEXT",
    )
    ensure_column(
        "employee_mcps",
        "aios_mcp_info_server_list_json",
        "aios_mcp_info_server_list_json TEXT",
    )

