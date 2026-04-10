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

    # 兼容历史员工技能关系表：补充新增字段
    ensure_column("employee_skills", "skill_name", "skill_name VARCHAR(255) NOT NULL DEFAULT ''")
    ensure_column("employee_skills", "skill_description", "skill_description VARCHAR(1000)")
    ensure_column("employee_skills", "prompt", "prompt TEXT")
    ensure_column("employee_skills", "skill_content", "skill_content TEXT")

