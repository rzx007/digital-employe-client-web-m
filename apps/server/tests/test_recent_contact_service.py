"""RecentContactService 单元测试。"""

from __future__ import annotations

from src.models.recent_contact import RecentContact
from src.schemas.recent_contact import RecentContactImportItem
from src.service.employee_service import EmployeeService
from src.service.recent_contact_service import RecentContactService
from tests.conftest import add_employee


def test_touch_creates_and_updates(db_session, workspace):
    emp = add_employee(db_session, workspace.id, name="Alice")
    first = RecentContactService.touch(
        db_session, workspace.id, "employee", emp.id
    )
    assert first.contact_name == "Alice"
    assert first.is_pinned is False

    RecentContactService.set_pinned(
        db_session, workspace.id, "employee", emp.id, True
    )
    second = RecentContactService.touch(
        db_session, workspace.id, "employee", emp.id
    )
    assert second.is_pinned is True


def test_list_includes_curator(db_session, workspace):
    # 总管为 USER 级，其 owner 必须与工作空间归属一致，
    # 最近联系人查找现按 workspace.user_id 派生 owner 再查总管。
    curator = EmployeeService.ensure_curator_employee(
        db_session, workspace.user_id, workspace.id
    )
    items = RecentContactService.list_recent_contacts(db_session, workspace.id)
    curator_items = [i for i in items if i.is_curator]
    assert len(curator_items) >= 1
    assert curator_items[0].target_id == curator.id


def test_delete_by_target_after_employee_removed(db_session, workspace):
    emp = add_employee(db_session, workspace.id, name="Bob")
    RecentContactService.touch(db_session, workspace.id, "employee", emp.id)
    from src.service.employee_service import EmployeeService

    EmployeeService.delete_employee(db_session, emp.id)
    from sqlalchemy import select

    rows = list(
        db_session.scalars(
            select(RecentContact).where(
                RecentContact.workspace_id == workspace.id
            )
        ).all()
    )
    assert not any(
        r.target_type == "employee" and r.target_id == emp.id for r in rows
    )


def test_import_idempotent(db_session, workspace):
    emp = add_employee(db_session, workspace.id, name="Carol")
    items = [
        RecentContactImportItem(
            target_type="employee",
            target_id=emp.id,
            is_pinned=True,
        )
    ]
    n1 = RecentContactService.import_items(db_session, workspace.id, items)
    n2 = RecentContactService.import_items(db_session, workspace.id, items)
    assert n1 == 1
    assert n2 == 0
    listed = RecentContactService.list_recent_contacts(db_session, workspace.id)
    match = [i for i in listed if i.target_id == emp.id]
    assert match and match[0].is_pinned
