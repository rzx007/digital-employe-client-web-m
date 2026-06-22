"""arrange_workbench 按 workbench-builder 技能挂载（不再硬编码给总管）。"""
from __future__ import annotations


def test_should_mount_workbench_pure_function():
    from src.service.agent import employee as emp_mod

    assert emp_mod._should_mount_workbench(["workbench-builder", "docx"]) is True
    assert emp_mod._should_mount_workbench(["docx", "pdf"]) is False
    assert emp_mod._should_mount_workbench([]) is False


def test_arrange_workbench_tool_name():
    from src.service.agent.tools.workbench import arrange_workbench

    assert getattr(arrange_workbench, "name", "") == "arrange_workbench"
