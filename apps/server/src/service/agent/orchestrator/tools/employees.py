"""总管工具 · 员工管理（员工列表 / 详情 / 更新 / 删除 / 招聘录用）。

按"职能域"统一组织：
- 列表：list_workspace_employees
- 详情：get_employee
- 修改：update_employee
- 删除：delete_employee
- 招聘：recruit_employee、hire_employee、hire_employees

招聘相关的招聘（recruit）后端逻辑（生成候选人、批量录用、单人录用）见
`src.service.agent.orchestrator.recruitment` 模块；本文件只把业务函数包成
@tool 供 LangChain 工具系统使用。

工作区技能列表 / 详情已并入 `tools.skills`，工具调用时通过 import 复用。
"""

from __future__ import annotations

import json

from fastapi import HTTPException
from langchain_core.tools import tool

from src.db.session import get_session_local
from src.models.employee import Employee
from src.schemas.employee import EmployeeUpdate
from src.service.agent.orchestrator.employee_mutations import (
    MAX_DISMISS_BATCH,
    delete_employees_batch as run_delete_employees_batch,
)
from src.service.agent.orchestrator.json_list_parse import parse_json_int_list
from src.service.agent.orchestrator.prompts import build_employee_capability_context
from src.service.agent.orchestrator.recruitment import (
    MAX_HIRE_BATCH,
    _RESERVED_EMPLOYEE_NAMES,
    hire_candidate,
    hire_candidates_batch,
    recruit_candidates,
)
from src.service.agent.orchestrator.runtime import (
    get_auth_token,
    get_db,
    get_user_id,
    get_workspace_id,
    invalidate_orchestrator_db_cache,
)
from src.service.employee_service import EmployeeService


_RESERVED_NAMES_LOWER = {n.lower() for n in _RESERVED_EMPLOYEE_NAMES}


# ---------------------------------------------------------------------------
# 内部 helper
# ---------------------------------------------------------------------------


def _is_reserved_name(name: str) -> bool:
    trimmed = (name or "").strip()
    return (
        not trimmed
        or trimmed.lower() in _RESERVED_NAMES_LOWER
        or trimmed == "总管助手"
    )


def _ensure_user_employee(db, employee_id: int, user_id: str | None) -> Employee | str:
    employee = db.get(Employee, employee_id)
    if not employee:
        return f"错误：员工 ID={employee_id} 不存在。"
    if employee.user_id != user_id:
        return f"错误：员工 ID={employee_id} 不属于当前用户。"
    return employee


def build_employee_update_payload(
    *,
    employee_name: str | None = None,
    capability_desc: str | None = None,
    skill_ids: list[int] | None = None,
    mcp_ids: list[int] | None = None,
) -> EmployeeUpdate:
    """仅包含显式传入字段，供 update_employee 与单测增量校验。"""
    data: dict = {"status": 1}
    if employee_name is not None:
        data["employee_name"] = employee_name.strip()
    if capability_desc is not None:
        data["capability_desc"] = capability_desc.strip() or None
    if skill_ids is not None:
        data["skill_ids"] = skill_ids
    if mcp_ids is not None:
        data["mcp_ids"] = mcp_ids
    return EmployeeUpdate.model_validate(data)


# ---------------------------------------------------------------------------
# 员工列表 / 详情
# ---------------------------------------------------------------------------


@tool
def list_workspace_employees() -> str:
    """列出当前工作空间所有数字员工及其角色、技能、MCP 外接能力。

    系统 Prompt 已注入员工表时优先用表；招聘后或表可能过期时再调用。
    """
    db = get_db()
    user_id = get_user_id()
    workspace_id = get_workspace_id()
    return build_employee_capability_context(db, user_id, workspace_id)


@tool
def get_employee(employee_id: int) -> str:
    """查看单个数字员工的详情（名称、描述、技能、MCP、是否总管）。

    在用户询问某员工能力、或 update/delete 前需要确认信息时使用。
    系统 Prompt 已注入员工表时可先用表；需要完整技能/MCP 快照时再调用。
    """
    db = get_db()
    user_id = get_user_id()
    employee_or_err = _ensure_user_employee(db, employee_id, user_id)
    if isinstance(employee_or_err, str):
        return employee_or_err

    detail = EmployeeService.employee_detail_dict(db, employee_or_err)
    raw_skills = (detail.get("metadata") or {}).get("skills") or []
    skills_compact = []
    for s in raw_skills:
        if not isinstance(s, dict):
            continue
        desc = str(s.get("skill_description") or s.get("description") or "").strip()
        if len(desc) > 160:
            desc = desc[:160] + "…"
        skills_compact.append(
            {
                "skill_id": s.get("skill_id"),
                "skill_name": s.get("skill_name") or s.get("skillName"),
                "skill_name_zh": s.get("skill_name_zh"),
                "description": desc,
            }
        )
    payload = {
        "type": "employee_detail",
        "employee_id": detail.get("id"),
        "employee_name": detail.get("name"),
        "employee_code": detail.get("employee_code"),
        "description": detail.get("description"),
        "is_curator": bool(detail.get("is_curator")),
        "skills": skills_compact,
        "mcps": (detail.get("metadata") or {}).get("mcps") or [],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 员工修改 / 删除
# ---------------------------------------------------------------------------


@tool
def update_employee(
    employee_id: int,
    employee_name: str | None = None,
    capability_desc: str | None = None,
    skill_ids: str | list[int] | int | None = None,
    mcp_ids: str | list[int] | int | None = None,
) -> str:
    """修改已有数字员工（名称、描述、技能）。

    skill_ids 可为 JSON 数组字符串（如 "[-100, 11]"）、整数列表或单个整数。
    负整数 skill_id=本地 localId；正整数=企业远程技能 id。传 "[]" 可清空。
    禁止修改总管助手（is_curator=true）的任何字段。
    MCP 分配请在客户端员工编辑页操作，总管不提供 MCP 查询工具。
    """
    user_id = get_user_id()
    token = get_auth_token() or ""
    db = get_session_local()()
    try:
        employee_or_err = _ensure_user_employee(db, employee_id, user_id)
        if isinstance(employee_or_err, str):
            return employee_or_err
        employee = employee_or_err

        if employee.is_curator:
            return "错误：不能修改总管助手。"

        if employee_name is not None:
            if _is_reserved_name(employee_name):
                return "错误：不能使用保留名称「总管助手」或 curator。"

        if (
            employee_name is None
            and capability_desc is None
            and skill_ids is None
            and mcp_ids is None
        ):
            return "错误：未提供任何要更新的字段。"

        if skill_ids is not None:
            parsed, err = parse_json_int_list(skill_ids, "skill_ids")
            if err:
                return err
        else:
            parsed = None

        parsed_mcp_ids: list[int] | None = None
        if mcp_ids is not None:
            parsed_mcp_ids, err = parse_json_int_list(mcp_ids, "mcp_ids")
            if err:
                return err

        update_in = build_employee_update_payload(
            employee_name=employee_name.strip() if employee_name is not None else None,
            capability_desc=capability_desc.strip() if capability_desc is not None else None,
            skill_ids=parsed,
            mcp_ids=parsed_mcp_ids,
        )

        try:
            updated = EmployeeService.update_employee(
                db, employee_id, update_in, token
            )
        except HTTPException as exc:
            db.rollback()
            detail = exc.detail
            if isinstance(detail, list):
                detail = "; ".join(str(d) for d in detail)
            return f"错误：更新员工失败 — {detail}"
        except Exception as exc:
            db.rollback()
            return f"错误：更新员工失败 — {exc}"

        detail = EmployeeService.employee_detail_dict(db, updated)
        meta_skills = (detail.get("metadata") or {}).get("skills") or []
        skill_labels = [
            s.get("skill_name_zh") or s.get("skill_name") or str(s.get("skill_id", ""))
            for s in meta_skills
            if isinstance(s, dict)
        ]
        result = {
            "type": "employee_updated",
            "employee_id": updated.id,
            "employee_name": updated.name,
            "skills": skill_labels,
            "message": f"员工「{updated.name}」（ID={updated.id}）已更新。",
        }
        invalidate_orchestrator_db_cache()
        return json.dumps(result, ensure_ascii=False, indent=2)
    finally:
        db.close()


@tool
def delete_employee(employee_id: int) -> str:
    """解聘单个数字员工（物理删除，关联任务调度会刷新）。

    仅解聘 1 人时使用；2 人及以上必须用 delete_employees_batch。
    禁止解聘总管助手（is_curator=true）。解聘前建议 get_employee 确认 ID。
    """
    user_id = get_user_id()
    db = get_session_local()()
    try:
        employee_or_err = _ensure_user_employee(db, employee_id, user_id)
        if isinstance(employee_or_err, str):
            return employee_or_err
        employee = employee_or_err

        if employee.is_curator:
            return "错误：不能删除总管助手。"

        name = employee.name or str(employee_id)
        try:
            EmployeeService.delete_employee(db, employee_id)
        except HTTPException as exc:
            db.rollback()
            detail = exc.detail
            if isinstance(detail, list):
                detail = "; ".join(str(d) for d in detail)
            return f"错误：删除员工失败 — {detail}"
        except Exception as exc:
            db.rollback()
            return f"错误：删除员工失败 — {exc}"

        result = {
            "type": "employee_deleted",
            "employee_id": employee_id,
            "employee_name": name,
            "message": f"员工「{name}」（ID={employee_id}）已解聘。",
        }
        invalidate_orchestrator_db_cache()
        return json.dumps(result, ensure_ascii=False, indent=2)
    finally:
        db.close()


@tool
def delete_employees_batch(employee_ids: str) -> str:
    """批量解聘多名数字员工（一次调用，逐人独立 Session，整批只刷新调度一次）。

    当用户要求解聘 2 名及以上员工时使用本工具，不要用同一轮多次 delete_employee。
    禁止解聘总管助手（is_curator=true）。调用后会弹出用户确认门，须等用户确认后
    才会真正解聘，禁止口头说「已解聘」。

    参数 employee_ids: JSON 整数数组字符串，例如 "[12, 13, 14]"
    """
    user_id = get_user_id()
    workspace_id = get_workspace_id()

    try:
        parsed = json.loads(employee_ids)
    except json.JSONDecodeError as exc:
        return f"错误：employee_ids 不是合法的 JSON 数组: {exc}"

    if not isinstance(parsed, list):
        return "错误：employee_ids 必须为 JSON 数组。"
    if len(parsed) == 0:
        return "错误：employee_ids 不能为空。"
    if len(parsed) > MAX_DISMISS_BATCH:
        return f"错误：单次最多解聘 {MAX_DISMISS_BATCH} 人。"

    normalized: list[int] = []
    for i, raw in enumerate(parsed):
        try:
            normalized.append(int(raw))
        except (TypeError, ValueError):
            return f"错误：employee_ids[{i}] 不是有效整数: {raw!r}"

    raw = run_delete_employees_batch(
        user_id, workspace_id, normalized, reload_scheduler=True
    )
    if not raw.startswith("错误："):
        invalidate_orchestrator_db_cache()
    return raw


# ---------------------------------------------------------------------------
# 招聘 / 录用
# ---------------------------------------------------------------------------


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
def hire_employee(name: str, description: str, skill_ids: str | list[int] | int = "[]") -> str:
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

    normalized, err = parse_json_int_list(skill_ids, "skill_ids")
    if err:
        return err

    result = hire_candidate(
        workspace_id,
        name,
        description,
        normalized or [],
        token=token,
        user_id=get_user_id(),
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
        user_id=get_user_id(),
    )
    if not result.startswith("错误"):
        invalidate_orchestrator_db_cache()
    return result
