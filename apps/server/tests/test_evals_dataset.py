"""评估集离线校验：数据集 schema + 评分逻辑（不需模型/DB）。

守住 cases.yaml 不写坏，以及 checks/judge/extract 的纯逻辑不回退。
live 行为跑分见 evals/run.py（需模型端点），不在此文件。
"""

from __future__ import annotations

import pytest

from evals.checks import AgentResult, evaluate_rules, rules_passed
from evals.judge import build_judge_messages, parse_judge_output
from evals.run import extract_agent_result, load_cases

_VALID_TARGETS = {"orchestrator", "employee"}
_VALID_EXPECT_KEYS = {
    "tools_called_any",
    "tools_called_all",
    "tools_not_called",
    "interrupted",
    "output_includes",
    "output_excludes",
}


@pytest.fixture(scope="module")
def cases() -> list[dict]:
    return load_cases()


def test_dataset_loads_and_has_enough_cases(cases: list[dict]) -> None:
    assert len(cases) >= 18, f"评估集用例偏少：{len(cases)}（目标 ~20）"


def test_case_ids_unique(cases: list[dict]) -> None:
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids)), "用例 id 有重复"


def test_each_case_schema(cases: list[dict]) -> None:
    for c in cases:
        assert c.get("id"), "用例缺 id"
        assert c.get("target") in _VALID_TARGETS, f"{c['id']} target 非法"
        assert c.get("category"), f"{c['id']} 缺 category"
        assert c.get("input"), f"{c['id']} 缺 input"
        assert c.get("rubric") or c.get("expect"), f"{c['id']} 既无 rubric 也无 expect"
        bad = set((c.get("expect") or {})) - _VALID_EXPECT_KEYS
        assert not bad, f"{c['id']} expect 含未知键 {bad}"


def test_every_referenced_tool_is_a_real_tool(cases: list[dict]) -> None:
    """expect 里引用的工具名必须是真实存在的工具，防写错名导致门形同虚设。"""
    known = {
        # 总管编排/员工管理/技能/任务
        "create_orchestration_plan", "confirm_orchestration_plan", "cancel_plan",
        "update_task", "delete_task", "delete_tasks_batch", "list_tasks",
        "list_workspace_employees", "get_employee", "update_employee",
        "delete_employee", "recruit_employee", "hire_employee", "hire_employees",
        "list_workspace_skills", "get_workspace_skill_detail",
        "search_market_skills", "get_market_skill_detail", "install_market_skill",
        "list_builtin_skills", "install_builtin_skill",
        # 通用
        "shell_execute", "remember_memory", "write_file", "edit_file",
        "submit_clarifying_questions", "submit_document_plan", "write_todos",
    }
    for c in cases:
        expect = c.get("expect") or {}
        for key in ("tools_called_any", "tools_called_all", "tools_not_called"):
            for tool in expect.get(key, []) or []:
                assert tool in known, f"{c['id']}: 未知工具 {tool}"


# ----------------------------- checks 纯逻辑 ----------------------------- #


def test_rules_pass_and_fail() -> None:
    res = AgentResult(
        final_text="群聊功能尚未开放",
        tool_calls=["submit_clarifying_questions"],
        interrupted=True,
    )
    ok = evaluate_rules(
        {
            "tools_called_any": ["submit_clarifying_questions"],
            "tools_not_called": ["create_orchestration_plan"],
            "interrupted": True,
            "output_includes": ["群聊"],
        },
        res,
    )
    assert rules_passed(ok)

    bad = evaluate_rules({"tools_not_called": ["submit_clarifying_questions"]}, res)
    assert not rules_passed(bad)


def test_empty_expect_is_open_gate() -> None:
    assert rules_passed(evaluate_rules({}, AgentResult()))


# ----------------------------- judge 解析 ----------------------------- #


@pytest.mark.parametrize(
    "text,score",
    [
        ("分数: 5 | 理由: 完全符合", 5),
        ("分数：1 | 理由：完全不符合", 1),
        ("我给 4 分", 4),
        ("无法判断", 0),
    ],
)
def test_parse_judge_output(text: str, score: int) -> None:
    assert parse_judge_output(text).score == score


def test_build_judge_messages_contains_rubric_and_trace() -> None:
    res = AgentResult(final_text="好的", tool_calls=["create_orchestration_plan"])
    msgs = build_judge_messages("是否委派？", "做个落地页", res)
    assert msgs[0]["role"] == "system"
    body = msgs[1]["content"]
    assert "是否委派？" in body
    assert "create_orchestration_plan" in body
    assert "做个落地页" in body


# --------------------------- extract_agent_result --------------------------- #


def test_extract_from_dict_state() -> None:
    state = {
        "messages": [
            {"role": "user", "content": "删任务"},
            {
                "role": "ai",
                "content": "",
                "tool_calls": [{"name": "list_tasks"}, {"name": "delete_task"}],
            },
            {"role": "ai", "content": "已为你处理。"},
        ],
        "__interrupt__": [{"value": "confirm?"}],
    }
    res = extract_agent_result(state)
    assert res.tool_calls == ["list_tasks", "delete_task"]
    assert res.final_text == "已为你处理。"
    assert res.interrupted is True


def test_extract_openai_style_tool_calls() -> None:
    state = {
        "messages": [
            {
                "role": "assistant",
                "content": "",
                "additional_kwargs": {
                    "tool_calls": [{"function": {"name": "recruit_employee"}}]
                },
            }
        ]
    }
    res = extract_agent_result(state)
    assert res.tool_calls == ["recruit_employee"]
    assert res.interrupted is False
