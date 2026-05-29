"""create_orchestration_plan tasks 参数解析（字符串 / 数组）。"""

from __future__ import annotations

from src.service.agent.orchestrator.tools import parse_orchestration_task_list


def test_parse_orchestration_task_list_from_json_string():
    task_list, err = parse_orchestration_task_list(
        '[{"employee_id": 1, "task_name": "A"}]'
    )
    assert err is None
    assert task_list == [{"employee_id": 1, "task_name": "A"}]


def test_parse_orchestration_task_list_from_array():
    raw = [{"employee_id": 4, "task_name": "立即查询抖音热搜", "prompt": "查"}]
    task_list, err = parse_orchestration_task_list(raw)
    assert err is None
    assert task_list == raw


def test_parse_orchestration_task_list_rejects_invalid():
    _, err = parse_orchestration_task_list("not json")
    assert err and "JSON" in err

    _, err = parse_orchestration_task_list([])
    assert err and "不能为空" in err

    _, err = parse_orchestration_task_list({"employee_id": 1})
    assert err and "字符串或数组" in err
