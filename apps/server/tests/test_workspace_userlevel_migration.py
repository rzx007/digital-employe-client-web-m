"""多工作空间+用户级(SP1) Task 1.1：user_id 列 + 启动回填。"""

from __future__ import annotations


def test_backfill_sets_user_id_from_workspace(db_session):
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.models.conversation import Conversation
    from src.db.init_db import backfill_user_id  # 待实现

    ws = Workspace(name="w", root_path="/tmp/w", user_id="u1")
    db_session.add(ws)
    db_session.flush()
    e = Employee(workspace_id=ws.id, name="e", employee_code="c")
    db_session.add(e)
    db_session.flush()
    c = Conversation(workspace_id=ws.id, target_type="curator", target_id=e.id)
    db_session.add(c)
    db_session.commit()
    backfill_user_id(db_session)
    db_session.expire_all()
    assert db_session.get(Employee, e.id).user_id == "u1"
    assert db_session.get(Conversation, c.id).user_id == "u1"


def test_backfill_skips_null_user_workspace(db_session):
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.db.init_db import backfill_user_id

    ws = Workspace(name="w_null", root_path="/tmp/w_null", user_id=None)
    db_session.add(ws)
    db_session.flush()
    e = Employee(workspace_id=ws.id, name="e_null", employee_code="c_null")
    db_session.add(e)
    db_session.commit()
    backfill_user_id(db_session)
    db_session.expire_all()
    assert db_session.get(Employee, e.id).user_id is None


def test_backfill_is_idempotent(db_session):
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.db.init_db import backfill_user_id

    ws = Workspace(name="w_idem", root_path="/tmp/w_idem", user_id="u1")
    db_session.add(ws)
    db_session.flush()
    e = Employee(workspace_id=ws.id, name="e_idem", employee_code="c_idem")
    db_session.add(e)
    db_session.commit()

    # 第一次回填
    backfill_user_id(db_session)
    db_session.expire_all()
    assert db_session.get(Employee, e.id).user_id == "u1"

    # 手动把 employee.user_id 改为 "u2"，再次回填不应覆盖（WHERE user_id IS NULL 守卫）
    emp = db_session.get(Employee, e.id)
    emp.user_id = "u2"
    db_session.commit()

    backfill_user_id(db_session)
    db_session.expire_all()
    assert db_session.get(Employee, e.id).user_id == "u2"


def test_delete_workspace_keeps_user_resources(db_session):
    from src.models.workspace import Workspace
    from src.models.employee import Employee
    from src.models.conversation import Conversation
    from src.db.init_db import backfill_user_id

    ws = Workspace(name="w", root_path="/tmp/w", user_id="u1")
    db_session.add(ws)
    db_session.flush()
    e = Employee(workspace_id=ws.id, name="e", employee_code="c")
    db_session.add(e)
    db_session.flush()
    c = Conversation(workspace_id=ws.id, target_type="curator", target_id=e.id)
    db_session.add(c)
    db_session.commit()
    backfill_user_id(db_session)
    emp_id, conv_id, ws_id = e.id, c.id, ws.id
    db_session.delete(ws)
    db_session.commit()
    db_session.expire_all()
    surviving_emp = db_session.get(Employee, emp_id)
    surviving_conv = db_session.get(Conversation, conv_id)
    assert surviving_emp is not None
    assert surviving_conv is not None
    # 未被 null-out：workspace_id 仍指向已删空间（FK 运行时 OFF，孤儿无害）
    assert surviving_emp.workspace_id == ws_id
    assert surviving_conv.workspace_id == ws_id


# --- Task 1.3：员工唯一键 (user_id, employee_code) ---
# conftest 的 db_session 用 create_all() 建库，已直接带新唯一键，
# 故直接验证约束语义（而非 旧→新 重建路径，后者走 py_compile + 启动 smoke）。


def test_same_user_same_code_rejected(db_session):
    from sqlalchemy.exc import IntegrityError

    import pytest

    from src.models.employee import Employee

    db_session.add(
        Employee(workspace_id=1, user_id="u1", employee_code="dup", name="a")
    )
    db_session.commit()
    db_session.add(
        Employee(workspace_id=2, user_id="u1", employee_code="dup", name="b")
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_different_user_same_code_ok(db_session):
    from src.models.employee import Employee

    db_session.add(
        Employee(workspace_id=1, user_id="u1", employee_code="dup", name="a")
    )
    db_session.add(
        Employee(workspace_id=1, user_id="u2", employee_code="dup", name="b")
    )
    db_session.commit()  # must NOT raise


# --- Task 1.3：员工唯一键迁移预检（碰撞守卫）---


def test_migrate_employee_unique_key_skips_on_collision():
    """_migrate_employee_unique_key 遇到同 user_id 重复 employee_code 时不重建表。

    构造一张旧式 employees 表（UNIQUE(workspace_id, employee_code)），插入两条
    user_id+employee_code 相同的行，调用迁移函数后验证：
    - 表仍保留旧约束名（uq_workspace_employee_code 仍存在）
    - 两行数据完好（未被删除/回滚）
    """
    from sqlalchemy import create_engine, text as text
    from sqlalchemy import inspect as sa_inspect

    from src.db.init_db import _migrate_employee_unique_key

    engine = create_engine("sqlite:///:memory:", future=True)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE workspaces ("
            "id INTEGER PRIMARY KEY, name TEXT, root_path TEXT, user_id TEXT"
            ")"
        ))
        conn.execute(text(
            "INSERT INTO workspaces(id, name, root_path, user_id) VALUES "
            "(1, 'ws1', '/tmp/ws1', 'u1'), "
            "(2, 'ws2', '/tmp/ws2', 'u1')"
        ))
        conn.execute(text(
            "CREATE TABLE employees ("
            "id INTEGER PRIMARY KEY,"
            "workspace_id INTEGER NOT NULL REFERENCES workspaces(id),"
            "user_id TEXT,"
            "employee_code VARCHAR(255) NOT NULL,"
            "name VARCHAR(255),"
            "description VARCHAR(1000),"
            "version VARCHAR(128),"
            "skills_json TEXT NOT NULL DEFAULT '[]',"
            "meta_json TEXT NOT NULL DEFAULT '{}',"
            "shift_schedule_json TEXT NOT NULL DEFAULT '{}',"
            "is_curator BOOLEAN NOT NULL DEFAULT 0,"
            "avatar_url VARCHAR(512),"
            "created_at DATETIME,"
            "updated_at DATETIME,"
            "CONSTRAINT uq_workspace_employee_code UNIQUE (workspace_id, employee_code)"
            ")"
        ))
        # 两条记录：同 user_id、同 employee_code，来自不同 workspace——迁移会碰撞
        conn.execute(text(
            "INSERT INTO employees(id, workspace_id, user_id, employee_code, name) VALUES "
            "(1, 1, 'u1', 'EMP001', 'Alice'), "
            "(2, 2, 'u1', 'EMP001', 'Alice-copy')"
        ))

    inspector = sa_inspect(engine)
    _migrate_employee_unique_key(engine, inspector)

    # 旧约束仍在（表未被重建）
    inspector2 = sa_inspect(engine)
    constraint_names = {uc.get("name") for uc in inspector2.get_unique_constraints("employees")}
    assert "uq_workspace_employee_code" in constraint_names, (
        "旧约束应保留；迁移不应在有碰撞时继续重建"
    )
    assert "uq_user_employee_code" not in constraint_names

    # 两行数据完好
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT COUNT(*) FROM employees")).scalar()
    assert rows == 2
