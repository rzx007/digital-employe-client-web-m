"""编排子任务校验：禁止同一员工拆多条子任务。"""

from __future__ import annotations

from src.service.agent.orchestrator.task_validation import validate_orchestration_tasks


def test_single_task_passes():
    assert validate_orchestration_tasks(
        [{"employee_id": 1, "task_name": "读并写", "prompt": "一步完成"}]
    ) is None


def test_multiple_employees_passes():
    tasks = [
        {"employee_id": 1, "task_name": "A", "prompt": "查资料"},
        {"employee_id": 2, "task_name": "B", "prompt": "写报告"},
    ]
    assert validate_orchestration_tasks(tasks) is None


def test_same_employee_multiple_tasks_rejected():
    tasks = [
        {"employee_id": 3, "task_name": "读文档", "prompt": "读 uploads"},
        {"employee_id": 3, "task_name": "扩写", "prompt": "写 artifacts"},
    ]
    err = validate_orchestration_tasks(tasks)
    assert err is not None
    assert "同一员工" in err
    assert "ID=3" in err
    assert "合并" in err


def test_missing_employee_id_rejected():
    err = validate_orchestration_tasks(
        [
            {"employee_id": 1, "task_name": "A"},
            {"task_name": "B"},
        ]
    )
    assert err is not None
    assert "employee_id" in err
