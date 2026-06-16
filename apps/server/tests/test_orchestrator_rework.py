from src.models.employee_task import EmployeeTask


def test_employee_task_has_rework_count_default_zero():
    t = EmployeeTask(workspace_id=1, employee_id=1, task_name="x")
    assert t.rework_count == 0
