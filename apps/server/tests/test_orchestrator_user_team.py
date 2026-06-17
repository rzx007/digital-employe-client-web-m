from __future__ import annotations


def test_build_capability_context_lists_user_employees_across_workspaces(db_session):
    from src.models.employee import Employee
    from src.service.agent.orchestrator.prompts import build_employee_capability_context
    # u1 owns employees in two different workspaces; u2 has one — must not leak into u1's list
    db_session.add_all([
        Employee(workspace_id=1, user_id="u1", employee_code="a", name="Alice"),
        Employee(workspace_id=2, user_id="u1", employee_code="b", name="Bob"),
        Employee(workspace_id=1, user_id="u2", employee_code="c", name="Carol"),
    ])
    db_session.commit()
    out = build_employee_capability_context(db_session, "u1")
    assert "Alice" in out and "Bob" in out
    assert "Carol" not in out


def test_build_capability_context_empty_for_unknown_user(db_session):
    from src.service.agent.orchestrator.prompts import build_employee_capability_context
    out = build_employee_capability_context(db_session, "nobody")
    assert "没有数字员工" in out
