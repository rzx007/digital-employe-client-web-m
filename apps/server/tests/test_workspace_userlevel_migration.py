"""多工作空间+用户级(SP1)：员工唯一键 (user_id, employee_code) 约束语义。

注：新项目=新空库，启动回填 / 旧表重建迁移（backfill_user_id /
_migrate_employee_unique_key）已随 init_db 兼容垫片删除，相关测试一并移除。
此处仅保留 create_all 直接建出的 uq_user_employee_code 约束语义验证。
"""

from __future__ import annotations


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
