"""员工 / 技能查询改按 user_id 过滤（多工作空间共享）。"""

from __future__ import annotations


def test_list_employees_by_user_across_workspaces(db_session):
    from src.models.employee import Employee
    from src.service.employee_service import EmployeeService

    db_session.add_all([
        Employee(workspace_id=1, user_id="u1", employee_code="a", name="A"),
        Employee(workspace_id=2, user_id="u1", employee_code="b", name="B"),
        Employee(workspace_id=1, user_id="u2", employee_code="c", name="C"),
    ])
    db_session.commit()

    out = EmployeeService.list_employees(db_session, "u1")
    names = {e.name for e in out}
    assert names == {"A", "B"}  # u1 跨两个工作空间的员工，不含 u2


def test_list_skill_assignees_scoped_by_user(db_session):
    from src.models.employee import Employee
    from src.models.employee_skill import EmployeeSkill
    from src.service.employee_service import EmployeeService

    e1 = Employee(workspace_id=1, user_id="u1", employee_code="a", name="A")
    e2 = Employee(workspace_id=1, user_id="u2", employee_code="b", name="B")
    db_session.add_all([e1, e2])
    db_session.flush()
    db_session.add_all([
        EmployeeSkill(workspace_id=1, employee_id=e1.id, skill_id=10, skill_name="docx"),
        EmployeeSkill(workspace_id=1, employee_id=e2.id, skill_id=10, skill_name="docx"),
    ])
    db_session.commit()

    out = EmployeeService.list_skill_assignees(
        db_session, user_id="u1", skill_name="docx"
    )
    # 返回 [{"employee_id": ..., "employee_name": ...}]，仅 u1 的员工
    assignee_ids = {row["employee_id"] for row in out}
    assert e1.id in assignee_ids
    assert e2.id not in assignee_ids
