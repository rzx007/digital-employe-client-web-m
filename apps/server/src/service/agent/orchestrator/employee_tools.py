from __future__ import annotations

import json

from fastapi import HTTPException
from langchain_core.tools import tool
from sqlalchemy import select

from src.db.session import get_session_local
from src.models.employee import Employee
from src.schemas.employee import EmployeeUpdate
from src.service.agent.orchestrator.recruitment import _RESERVED_EMPLOYEE_NAMES
from src.service.agent.orchestrator.runtime import (
    get_auth_token,
    get_db,
    get_workspace_id,
)
from src.service.employee_service import EmployeeService

_RESERVED_NAMES_LOWER = {n.lower() for n in _RESERVED_EMPLOYEE_NAMES}


def _parse_json_int_list(raw: str, field_name: str) -> tuple[list[int] | None, str | None]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"错误：{field_name} 不是合法的 JSON 数组: {exc}"
    if not isinstance(parsed, list):
        return None, f"错误：{field_name} 必须为 JSON 数组。"
    normalized: list[int] = []
    for i, item in enumerate(parsed):
        try:
            normalized.append(int(item))
        except (TypeError, ValueError):
            return None, f"错误：{field_name}[{i}] 不是有效整数: {item!r}"
    return normalized, None


def _is_reserved_name(name: str) -> bool:
    trimmed = (name or "").strip()
    return (
        not trimmed
        or trimmed.lower() in _RESERVED_NAMES_LOWER
        or trimmed == "总管助手"
    )


def build_employee_update_payload(
    *,
    employee_name: str | None = None,
    capability_desc: str | None = None,
    skill_ids: list[int] | None = None,
    mcp_ids: list[int] | None = None,
) -> EmployeeUpdate:
    """仅包含显式传入字段，供 update_employee tool 与单测使用。"""
    data: dict = {}
    if employee_name is not None:
        data["employee_name"] = employee_name.strip()
    if capability_desc is not None:
        data["capability_desc"] = capability_desc.strip() or None
    if skill_ids is not None:
        data["skill_ids"] = skill_ids
    if mcp_ids is not None:
        data["mcp_ids"] = mcp_ids
    return EmployeeUpdate.model_validate(data)


def _ensure_workspace_employee(db, employee_id: int, workspace_id: int) -> Employee | str:
    employee = db.get(Employee, employee_id)
    if not employee:
        return f"错误：员工 ID={employee_id} 不存在。"
    if employee.workspace_id != workspace_id:
        return f"错误：员工 ID={employee_id} 不属于当前工作空间。"
    return employee


@tool
def get_employee(employee_id: int) -> str:
    """查看单个数字员工的详情（名称、描述、技能、MCP、是否总管）。

    在用户询问某员工能力、或 update/delete 前需要确认信息时使用。
    系统 Prompt 已注入员工表时可先用表；需要完整技能/MCP 快照时再调用。
    """
    db = get_db()
    workspace_id = get_workspace_id()
    employee_or_err = _ensure_workspace_employee(db, employee_id, workspace_id)
    if isinstance(employee_or_err, str):
        return employee_or_err

    detail = EmployeeService.employee_detail_dict(db, employee_or_err)
    payload = {
        "type": "employee_detail",
        "employee_id": detail.get("id"),
        "employee_name": detail.get("name"),
        "employee_code": detail.get("employee_code"),
        "description": detail.get("description"),
        "is_curator": bool(detail.get("is_curator")),
        "skills": (detail.get("metadata") or {}).get("skills") or [],
        "mcps": (detail.get("metadata") or {}).get("mcps") or [],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


@tool
def update_employee(
    employee_id: int,
    employee_name: str | None = None,
    capability_desc: str | None = None,
    skill_ids: str | None = None,
    mcp_ids: str | None = None,
) -> str:
    """修改已有数字员工（名称、描述、技能、MCP）。

    仅更新传入的非空参数。skill_ids / mcp_ids 为 JSON 数组字符串，传 "[]" 可清空。
    禁止修改总管助手（is_curator=true）的任何字段。
    """
    workspace_id = get_workspace_id()
    token = get_auth_token() or ""
    db = get_session_local()()
    try:
        employee_or_err = _ensure_workspace_employee(db, employee_id, workspace_id)
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

        parsed_skill_ids: list[int] | None = None
        parsed_mcp_ids: list[int] | None = None
        if skill_ids is not None:
            parsed, err = _parse_json_int_list(skill_ids, "skill_ids")
            if err:
                return err
            parsed_skill_ids = parsed
        if mcp_ids is not None:
            parsed, err = _parse_json_int_list(mcp_ids, "mcp_ids")
            if err:
                return err
            parsed_mcp_ids = parsed

        update_in = build_employee_update_payload(
            employee_name=employee_name.strip() if employee_name is not None else None,
            capability_desc=capability_desc,
            skill_ids=parsed_skill_ids,
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
        return json.dumps(result, ensure_ascii=False, indent=2)
    finally:
        db.close()


@tool
def delete_employee(employee_id: int) -> str:
    """删除数字员工（物理删除，关联任务调度会刷新）。

    禁止删除总管助手（is_curator=true）。删除前建议 get_employee 确认 ID。
    """
    workspace_id = get_workspace_id()
    db = get_session_local()()
    try:
        employee_or_err = _ensure_workspace_employee(db, employee_id, workspace_id)
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
            "message": f"员工「{name}」（ID={employee_id}）已删除。",
        }
        return json.dumps(result, ensure_ascii=False, indent=2)
    finally:
        db.close()
