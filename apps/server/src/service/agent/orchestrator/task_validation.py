"""编排计划子任务校验（create_orchestration_plan 前置）。"""

from __future__ import annotations

from typing import Any


def validate_orchestration_tasks(task_list: list[dict[str, Any]]) -> str | None:
    """校验子任务列表。通过返回 None，失败返回中文错误说明。"""
    if len(task_list) <= 1:
        return None

    employee_ids: list[int] = []
    for i, task in enumerate(task_list):
        raw_id = task.get("employee_id")
        if raw_id is None:
            return f"错误：子任务 #{i} 缺少 employee_id。"
        try:
            employee_ids.append(int(raw_id))
        except (TypeError, ValueError):
            return f"错误：子任务 #{i} 的 employee_id 无效。"

    if len(set(employee_ids)) == 1:
        emp_id = employee_ids[0]
        return (
            f"错误：所有子任务都指派给同一员工（ID={emp_id}）。"
            "请合并为一条子任务（在 prompt 中写清多步目标，"
            "例如先 read_file(\"/uploads/...\") 再 write_file(\"/artifacts/...\")），"
            "或分配给不同员工。子任务拆分仅用于多人协作。"
        )

    return None
