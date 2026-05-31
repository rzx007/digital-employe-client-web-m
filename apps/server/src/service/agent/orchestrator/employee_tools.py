from __future__ import annotations

import json

from fastapi import HTTPException
from langchain_core.tools import tool
from sqlalchemy.orm import Session

from src.db.session import get_session_local
from src.models.employee import Employee
from src.schemas.employee import EmployeeUpdate
from src.service.agent.orchestrator.json_list_parse import parse_json_int_list
from src.service.agent.orchestrator.recruitment import _RESERVED_EMPLOYEE_NAMES
from src.service.agent.orchestrator.runtime import (
    get_auth_token,
    get_db,
    get_workspace_id,
    invalidate_orchestrator_db_cache,
)
from src.service.employee_service import EmployeeService
from src.service.local_skill_service import LocalSkillService

_RESERVED_NAMES_LOWER = {n.lower() for n in _RESERVED_EMPLOYEE_NAMES}


def format_workspace_skills_list(
    workspace_id: int,
    *,
    compact: bool = False,
    db: Session | None = None,
) -> list[dict]:
    """builtin + workspace 本地技能，与招聘/员工配置使用同一套 localId。"""
    items: list[dict] = []
    for item in LocalSkillService.list_local_skills(workspace_id):
        local_id = item.get("localId")
        if local_id is None:
            continue
        skill_name = str(item.get("skillName") or "")
        description = (item.get("description") or "").strip()
        zh_raw = item.get("displayNameZh")
        display_zh = (
            zh_raw.strip()
            if isinstance(zh_raw, str) and zh_raw.strip()
            else skill_name
        )
        assignees: list[dict[str, int | str]] | None = None
        if db is not None:
            assignees = EmployeeService.list_skill_assignees(
                db,
                workspace_id=workspace_id,
                skill_name=skill_name,
                local_id=int(local_id),
            )
        if compact:
            entry: dict = {
                "id": int(local_id),
                "name": skill_name,
                "display_name_zh": display_zh,
                "source": "builtin" if item.get("isBuiltin") else "workspace",
            }
            if assignees is not None:
                entry["assigned_employees"] = assignees
            items.append(entry)
            continue
        summary = (item.get("recruitSummary") or description).strip()
        if not summary:
            summary = LocalSkillService.build_recruit_summary(description, skill_name)
        items.append(
            {
                "id": int(local_id),
                "name": skill_name,
                "display_name_zh": display_zh,
                "description": description or summary,
                "summary": summary,
                "source": "builtin" if item.get("isBuiltin") else "workspace",
            }
        )
    return items


@tool
def list_workspace_skills() -> str:
    """列出当前工作空间可分配给数字员工的本地技能库（含 skill id）。

    在 update_employee / hire_employee 需要 skill_ids 时先调用本工具；
    返回的 id 为负整数 localId（如 -101），须原样传入 skill_ids JSON 数组。
    技能库为空时 total=0，仍可录用/更新无技能员工（skill_ids="[]"）。
    """
    workspace_id = get_workspace_id()
    db = get_db()
    skills = format_workspace_skills_list(workspace_id, compact=True, db=db)
    payload = {
        "type": "workspace_skills",
        "workspace_id": workspace_id,
        "total": len(skills),
        "skills": skills,
        "hint": (
            "为员工分配技能：update_employee(employee_id, skill_ids=\"[-100, 11]\");"
            "负整数=本地已安装技能 localId；正整数=SkillsMP 远程技能 id（无需先安装）。"
            "清空技能：skill_ids=\"[]\"。localId 来自 list_workspace_skills；SkillsMP 安装后同样用 localId。"
            "每项 skills[].assigned_employees 为已分配员工；详情见 get_workspace_skill_detail。"
            "禁止在未查 assigned_employees / 员工表前声称「未分配给任何人」。"
        ),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _find_workspace_skill_name_by_local_id(
    workspace_id: int, local_id: int
) -> str | None:
    for item in LocalSkillService.list_local_skills(workspace_id):
        if item.get("localId") == local_id:
            name = str(item.get("skillName") or "").strip()
            return name or None
    return None


def _preview_skill_md(content: str | None, *, max_lines: int = 40) -> str:
    if not content or not content.strip():
        return "（未包含 SKILL.md 预览）"
    lines = content.splitlines()
    preview = "\n".join(lines[:max_lines])
    if len(lines) > max_lines:
        preview += f"\n...（共 {len(lines)} 行，仅显示前 {max_lines} 行）"
    return preview


def _format_skill_file_list(files: list[str], *, max_names: int = 12) -> str:
    if not files:
        return "（无文件清单）"
    shown = files[:max_names]
    lines = [f"- {name}" for name in shown]
    if len(files) > max_names:
        lines.append(f"... 还有 {len(files) - max_names} 个文件")
    return "\n".join(lines)


def _format_skill_assignees(
    assignees: list[dict[str, int | str]],
) -> str:
    if not assignees:
        return "尚未分配给任何员工（以本段为准）。"
    lines = ["已分配给以下员工："]
    for item in assignees:
        eid = item.get("employee_id")
        name = item.get("employee_name") or f"员工#{eid}"
        lines.append(f"- {name} (employee_id={eid})")
    lines.append("可直接 create_orchestration_plan 委派给上述员工，无需再问用户是否分配。")
    return "\n".join(lines)


@tool
def get_workspace_skill_detail(
    skill_name: str | None = None,
    local_id: int | None = None,
) -> str:
    """预览工作区已安装本地技能的 SKILL.md（只读，不安装不修改）。

    list_workspace_skills 列出的技能须用本工具查看详情；
    **禁止**用 read_file 猜测 orchestrator_skills 或磁盘绝对路径。

    Args:
        skill_name: 技能目录名，如 data-querys（与 list_workspace_skills 的 name 一致）
        local_id: list_workspace_skills 返回的 localId（负整数）
    """
    workspace_id = get_workspace_id()
    resolved_name: str | None = None

    if skill_name and skill_name.strip():
        resolved_name = skill_name.strip()
    elif local_id is not None:
        resolved_name = _find_workspace_skill_name_by_local_id(
            workspace_id, int(local_id)
        )
        if not resolved_name:
            return (
                f"错误：未找到 localId={local_id} 的工作区技能。"
                "请先 list_workspace_skills 核对 id。"
            )
    else:
        return "错误：请提供 skill_name 或 local_id 之一。"

    try:
        detail = LocalSkillService.get_local_skill_detail(
            resolved_name, workspace_id
        )
    except HTTPException as exc:
        detail_msg = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return f"错误：{detail_msg}"

    skill_name_for_lookup = str(detail.get("skillName") or resolved_name)
    lid = detail.get("localId")
    display_zh = detail.get("displayNameZh") or skill_name_for_lookup
    source = "builtin" if detail.get("isBuiltin") else "workspace"
    files = detail.get("files") or []
    preview = _preview_skill_md(detail.get("skillMdContent"))
    file_list = _format_skill_file_list(files)

    assignees = EmployeeService.list_skill_assignees(
        get_db(),
        workspace_id=workspace_id,
        skill_name=skill_name_for_lookup,
        local_id=int(lid) if lid is not None else None,
    )
    assignee_block = _format_skill_assignees(assignees)

    lid_line = f"localId: {lid}\n" if lid is not None else ""
    return (
        f"📄 工作区技能 name={skill_name_for_lookup}\n"
        f"显示名: {display_zh}\n"
        f"{lid_line}"
        f"来源: {source}\n"
        f"\n--- 分配情况 ---\n{assignee_block}\n"
        f"\n--- 文件清单 ---\n{file_list}\n"
        f"\n--- SKILL.md 预览 ---\n{preview}\n"
        f"\n---\n"
        "若尚未分配：update_employee(employee_id, skill_ids=\"[<localId>]\")。"
        "禁止用 read_file 读取本技能磁盘路径。"
    )


def _is_reserved_name(name: str) -> bool:
    trimmed = (name or "").strip()
    return (
        not trimmed
        or trimmed.lower() in _RESERVED_NAMES_LOWER
        or trimmed == "总管助手"
    )


def _ensure_workspace_employee(db, employee_id: int, workspace_id: int) -> Employee | str:
    employee = db.get(Employee, employee_id)
    if not employee:
        return f"错误：员工 ID={employee_id} 不存在。"
    if employee.workspace_id != workspace_id:
        return f"错误：员工 ID={employee_id} 不属于当前工作空间。"
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
    负整数 skill_id=本地 localId；正整数=SkillsMP 远程技能 id。传 "[]" 可清空。
    禁止修改总管助手（is_curator=true）的任何字段。
    MCP 分配请在客户端员工编辑页操作，总管不提供 MCP 查询工具。
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
        invalidate_orchestrator_db_cache()
        return json.dumps(result, ensure_ascii=False, indent=2)
    finally:
        db.close()
