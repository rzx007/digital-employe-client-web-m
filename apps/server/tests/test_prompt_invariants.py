"""提示词不变量回归门（L1）。

目的：在收敛"双份真理"、给总管提示词"抬海拔"、下沉工具机制、去冗余等**内容改写**时，
确保关键行为指令不被误删。断言对象刻意选用**工具名 / 参数名 / 结构锚点**
（而非整句措辞）——忠实的重构会保留它们，过度删改会丢失它们，正是要拦的回退。

与 L2 行为评估集（evals/）配合：L1 确定性、秒级、进 CI；L2 跑真模型测行为漂移。
配套见 docs 第三份审计文档《提示词内容审计与改写建议》。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.service.agent.prompts import (
    build_clarifying_questions_section,
    build_long_document_writing_section,
    build_system_prompt,
)
from src.service.agent.orchestrator.prompts import (
    ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE,
)
import src.service.agent.prompts as _prompts_mod

# /agent/AGENTS.md 在两条链路里都作为 memory 注入（memory=["/agent/AGENTS.md", ...]），
# 是模型实际看到的指令上下文的一部分。断言"完整上下文"= 系统提示词 + 注入的 AGENTS.md，
# 这样把规则从内联段【搬进】AGENTS.md（双份真理收敛）保持绿，真正【删掉】才变红。
_AGENTS_MD = (
    Path(_prompts_mod.__file__).parent / "AGENTS.md"
).read_text(encoding="utf-8")


@pytest.fixture()
def employee_prompt() -> str:
    """员工实际指令上下文：系统提示词 + 注入的 /agent/AGENTS.md（无需 DB / 模型）。"""
    system = build_system_prompt(
        "2026-06-03",
        ["demo-skill"],
        skills_real_path="/tmp/skills",
        artifacts_real_path="/tmp/artifacts",
        memories_real_path="/tmp/memories",
        agent_real_path="/tmp/agent",
        use_session_history=True,
    )
    return system + "\n" + _AGENTS_MD


@pytest.fixture()
def orchestrator_prompt() -> str:
    """总管实际指令上下文：静态系统提示词 + 注入的 /agent/AGENTS.md。

    （运行时表 employee_table/delegation 需 DB，不在此确定性层断言。）
    """
    static = (
        ORCHESTRATOR_SYSTEM_PROMPT_TEMPLATE
        + build_clarifying_questions_section()
        + build_long_document_writing_section(for_orchestrator=True)
    )
    return static + "\n" + _AGENTS_MD


# --------------------------------------------------------------------------- #
# 员工提示词不变量
# --------------------------------------------------------------------------- #


def test_employee_brand_name_is_boban_correct_glyph(employee_prompt: str) -> None:
    """品牌名用字：确认已是"博般"，且无旧的"博班"残留（守住本次品牌修订）。"""
    assert "博般" in employee_prompt
    assert "博班" not in employee_prompt


def test_employee_answers_in_chinese(employee_prompt: str) -> None:
    assert "中文" in employee_prompt


def test_employee_clarify_gate_tool_present(employee_prompt: str) -> None:
    """需求澄清门必须仍指向 submit_clarifying_questions 工具。"""
    assert "submit_clarifying_questions" in employee_prompt


def test_employee_long_document_tooling_present(employee_prompt: str) -> None:
    """长文档：方案门工具 + 产物 slug + planned_artifacts JSON 三个锚点不可丢。"""
    assert "submit_document_plan" in employee_prompt
    assert "doc-slug" in employee_prompt
    assert "planned_artifacts" in employee_prompt


def test_employee_memory_update_tool_present(employee_prompt: str) -> None:
    """记忆更新唯一正确做法 remember_memory，且禁止直接写 /memories/AGENTS.md。"""
    assert "remember_memory" in employee_prompt
    assert "/memories/AGENTS.md" in employee_prompt


def test_employee_write_todos_present(employee_prompt: str) -> None:
    assert "write_todos" in employee_prompt


def test_employee_virtual_paths_present(employee_prompt: str) -> None:
    """三个虚拟路径前缀（交付/记忆/技能）必须仍被说明。"""
    for prefix in ("/artifacts/", "/memories/", "/skills/"):
        assert prefix in employee_prompt


def test_employee_user_chat_no_virtual_path_in_body(employee_prompt: str) -> None:
    """对用户聊天正文不得暴露虚拟路径（工具侧仍保留 /artifacts/ 说明）。"""
    assert "聊天正文" in employee_prompt
    assert "禁止" in employee_prompt
    assert "产物" in employee_prompt or "变更卡片" in employee_prompt


def test_employee_skill_listing_grounded_in_runtime(employee_prompt: str) -> None:
    """"有哪些技能"必须基于运行时上下文回答（防幻觉），且当前时间段仍在。"""
    assert "运行时上下文" in employee_prompt


# --------------------------------------------------------------------------- #
# 总管提示词不变量
# --------------------------------------------------------------------------- #


def test_orchestrator_clarify_gate_tool_present(orchestrator_prompt: str) -> None:
    assert "submit_clarifying_questions" in orchestrator_prompt


def test_orchestrator_multi_split_direct_plan_rule(orchestrator_prompt: str) -> None:
    assert "create_orchestration_plan" in orchestrator_prompt
    assert "submit_clarifying_questions" in orchestrator_prompt
    assert "禁止" in orchestrator_prompt and "分工" in orchestrator_prompt


def test_orchestrator_answers_in_chinese(orchestrator_prompt: str) -> None:
    assert "中文" in orchestrator_prompt


def test_orchestrator_plan_lifecycle_tools_present(orchestrator_prompt: str) -> None:
    """编排核心闭环：create → confirm。两个工具名不可丢。"""
    assert "create_orchestration_plan" in orchestrator_prompt
    assert "confirm_orchestration_plan" in orchestrator_prompt


def test_orchestrator_no_auto_confirm_rule(orchestrator_prompt: str) -> None:
    """确认策略：创建计划后不得同一轮自动 confirm（须用户确认）。"""
    assert "确认策略" in orchestrator_prompt
    assert "confirm_orchestration_plan" in orchestrator_prompt


def test_orchestrator_id_taxonomy_present(orchestrator_prompt: str) -> None:
    """ID 三件套必须仍被区分说明——抬海拔最易误伤的一处。"""
    for token in ("employee_id", "plan_id", "task_id"):
        assert token in orchestrator_prompt


def test_orchestrator_task_mutation_tools_present(orchestrator_prompt: str) -> None:
    """改优先于删重建：update_task / delete_task / delete_tasks_batch / cancel_plan。"""
    for tool in (
        "update_task",
        "delete_task",
        "delete_tasks_batch",
        "cancel_plan",
    ):
        assert tool in orchestrator_prompt


def test_orchestrator_recruitment_tools_present(orchestrator_prompt: str) -> None:
    for tool in ("recruit_employee", "hire_employee", "hire_employees"):
        assert tool in orchestrator_prompt


def test_orchestrator_employee_management_tools_present(
    orchestrator_prompt: str,
) -> None:
    for tool in ("list_workspace_employees", "update_employee", "delete_employee"):
        assert tool in orchestrator_prompt


def test_orchestrator_skill_discovery_flow_present(orchestrator_prompt: str) -> None:
    """技能发现/安装链路：搜索 → 预览 → 安装。"""
    for tool in (
        "search_market_skills",
        "get_market_skill_detail",
        "install_market_skill",
    ):
        assert tool in orchestrator_prompt


@pytest.fixture()
def tool_descriptions() -> str:
    """§4 下沉后，工具调用机制（cron / skill_ids 等格式与坑）应落在各工具参数说明里。"""
    from src.service.agent.orchestrator.tools.tasks import update_task
    from src.service.agent.orchestrator.tools.plans import create_orchestration_plan
    from src.service.agent.orchestrator.tools.employees import update_employee

    return "\n".join(
        t.description
        for t in (update_task, create_orchestration_plan, update_employee)
    )


def test_cron_semantics_in_tool_descriptions(tool_descriptions: str) -> None:
    """cron 5 段语义 + cron=null：§4 下沉到工具参数说明（不再塞系统提示词）。"""
    assert "cron" in tool_descriptions
    assert "null" in tool_descriptions


def test_cron_not_mislabeled_one_shot(
    tool_descriptions: str, orchestrator_prompt: str
) -> None:
    """守住 cron 范例修正：不得把每日重复的表达式标成"一次性"（提示词与工具说明都不许复活）。"""
    assert "无法表达" in tool_descriptions
    assert "写一次性 cron" not in tool_descriptions
    assert "写一次性 cron" not in orchestrator_prompt


def test_skill_ids_format_in_tool_descriptions(tool_descriptions: str) -> None:
    """skill_ids 格式（JSON 数组 / "[]" 清空 / 负=local）：§4 下沉到 update_employee 参数说明。"""
    assert "skill_ids" in tool_descriptions


def test_orchestrator_delegation_default_present(orchestrator_prompt: str) -> None:
    """默认委派、明确要求才亲自干——核心海拔原则不可丢。"""
    assert "委派" in orchestrator_prompt
    assert "亲自" in orchestrator_prompt


def test_orchestrator_subtask_contract_has_non_goal(orchestrator_prompt: str) -> None:
    """派活契约四件事，尤其"非目标"（防越界/防多员工重复劳动）不可丢。"""
    assert "非目标" in orchestrator_prompt
    for part in ("目标", "输出", "可用资源"):
        assert part in orchestrator_prompt


def test_orchestrator_list_tasks_no_parallel_rule(orchestrator_prompt: str) -> None:
    """list_tasks 一次一个员工、禁止同轮并行（易错点）。"""
    assert "list_tasks" in orchestrator_prompt
    assert "并行" in orchestrator_prompt


def test_orchestrator_group_chat_unavailable_guidance(orchestrator_prompt: str) -> None:
    """群聊未开放时的引导（@ 提及）——群聊上线时这条需相应翻转。"""
    assert "群聊" in orchestrator_prompt
    assert "@" in orchestrator_prompt


def test_orchestrator_no_dev_file_references(orchestrator_prompt: str) -> None:
    """守住本次清理：不得注入模型读不到的开发内部文件引用。"""
    assert "PEEL_OFF.md" not in orchestrator_prompt
    assert "path-access-recap.md" not in orchestrator_prompt
