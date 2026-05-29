from __future__ import annotations

import json

from langchain_core.tools import tool

from src.service.agent.orchestrator.recruitment import (
    MAX_HIRE_BATCH,
    hire_candidate,
    hire_candidates_batch,
    recruit_candidates,
)
from src.service.agent.orchestrator.runtime import (
    get_auth_token,
    get_workspace_id,
    invalidate_orchestrator_db_cache,
)


def _parse_skill_ids_string(skill_ids: str) -> tuple[list[int] | None, str | None]:
    try:
        parsed = json.loads(skill_ids)
    except json.JSONDecodeError as exc:
        return None, f"错误：skill_ids 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list):
        return None, "错误：skill_ids 必须为 JSON 数组。"

    normalized: list[int] = []
    for i, raw in enumerate(parsed):
        try:
            normalized.append(int(raw))
        except (TypeError, ValueError):
            return None, f"错误：skill_ids[{i}] 不是有效整数: {raw!r}"
    return normalized, None


@tool
def recruit_employee(user_request: str, count: int = 1) -> str:
    """根据用户的招聘需求生成数字员工候选人列表。

    在用户提出招聘、扩充团队、新增某类岗位时使用。调用后向用户展示候选人，
    等待用户明确选择后再录用，不要跳过确认直接入职。

    参数:
      user_request: 招聘需求描述（岗位、能力、场景等）
      count: 生成候选人数量，1-5，默认 1
    """
    workspace_id = get_workspace_id()
    token = get_auth_token()
    return recruit_candidates(
        workspace_id,
        user_request,
        count=count,
        token=token,
    )


@tool
def hire_employee(name: str, description: str, skill_ids: str = "[]") -> str:
    """用户确认录用**单个**候选人，创建正式数字员工。

    仅录用 1 人时使用。若一次录用 2 人及以上，必须用 hire_employees，禁止同一轮
    并行或连续多次调用本工具。

    参数:
      name: 员工名称
      description: 员工能力描述
      skill_ids: JSON 数组字符串，例如 "[-101, -102]" 或 "[]"
    """
    workspace_id = get_workspace_id()
    token = get_auth_token()

    normalized, err = _parse_skill_ids_string(skill_ids)
    if err:
        return err

    result = hire_candidate(
        workspace_id,
        name,
        description,
        normalized or [],
        token=token,
        user_id="1",
    )
    if not result.startswith("错误"):
        invalidate_orchestrator_db_cache()
    return result


@tool
def hire_employees(candidates: str) -> str:
    """用户确认后批量录用多名数字员工（一次调用，独立事务逐人创建）。

    当用户要求「全部录用」「录用这 3 个」等多人场景时使用本工具，不要用多次 hire_employee。

    参数 candidates: JSON 数组字符串，每项格式:
      {"name": "员工名", "description": "职责描述", "skill_ids": []}
      skill_ids 无技能时为 []；有技能时为整数 ID 数组。

    示例:
      [{"name":"数据分析师","description":"…","skill_ids":[]},
       {"name":"法务助手","description":"…","skill_ids":[-101]}]
    """
    workspace_id = get_workspace_id()
    token = get_auth_token()

    try:
        parsed = json.loads(candidates)
    except json.JSONDecodeError as exc:
        return f"错误：candidates 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list):
        return "错误：candidates 必须为 JSON 数组。"
    if len(parsed) == 0:
        return "错误：candidates 不能为空。"
    if len(parsed) > MAX_HIRE_BATCH:
        return f"错误：单次最多录用 {MAX_HIRE_BATCH} 人。"

    result = hire_candidates_batch(
        workspace_id,
        parsed,
        token=token,
        user_id="1",
    )
    if not result.startswith("错误"):
        invalidate_orchestrator_db_cache()
    return result
