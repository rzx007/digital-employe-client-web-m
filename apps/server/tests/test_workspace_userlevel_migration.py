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
