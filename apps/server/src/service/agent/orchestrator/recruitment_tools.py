from __future__ import annotations

import json

from langchain_core.tools import tool

from src.service.agent.orchestrator.recruitment import hire_candidate, recruit_candidates
from src.service.agent.orchestrator.runtime import (
    get_auth_token,
    get_db,
    get_workspace_id,
)


@tool
def recruit_employee(user_request: str, count: int = 1) -> str:
    """根据用户的招聘需求生成数字员工候选人列表。

    在用户提出招聘、扩充团队、新增某类岗位时使用。调用后向用户展示候选人，
    等待用户明确选择后再调用 hire_employee，不要跳过确认直接入职。

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
def hire_employee(name: str, description: str, skill_ids: str) -> str:
    """用户确认录用后，将候选人创建为正式数字员工。

    仅在用户明确表示录用（如「录用第1个」「就要这个名字」）后调用。
    skill_ids 必须与 recruit_employee 返回的候选人 skill_ids 一致。

    参数:
      name: 员工名称
      description: 员工能力描述
      skill_ids: JSON 数组字符串，例如 "[-101, -102]" 或 "[1, 2]"
    """
    db = get_db()
    workspace_id = get_workspace_id()
    token = get_auth_token()

    try:
        parsed = json.loads(skill_ids)
    except json.JSONDecodeError as exc:
        return f"错误：skill_ids 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list) or len(parsed) == 0:
        return "错误：skill_ids 必须为非空 JSON 数组。"

    normalized: list[int] = []
    for i, raw in enumerate(parsed):
        try:
            normalized.append(int(raw))
        except (TypeError, ValueError):
            return f"错误：skill_ids[{i}] 不是有效整数: {raw!r}"

    return hire_candidate(
        db,
        workspace_id,
        name,
        description,
        normalized,
        token=token,
        user_id="1",
    )
