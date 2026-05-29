from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.db.session import get_session_local
from src.models.employee import Employee
from src.schemas.employee import EmployeeCreate, EmployeeProfile
from src.service.employee_generation_service import EmployeeGenerationService
from src.service.employee_service import EmployeeService

logger = logging.getLogger(__name__)

MIN_RECRUIT_COUNT = 1
MAX_RECRUIT_COUNT = 5
MAX_HIRE_BATCH = 5
_RESERVED_EMPLOYEE_NAMES = frozenset({"总管助手", "curator"})


def _clamp_count(count: int) -> int:
    return max(MIN_RECRUIT_COUNT, min(MAX_RECRUIT_COUNT, int(count)))


def _skills_summary(profile: EmployeeProfile) -> str:
    names: list[str] = []
    for skill in profile.skills_list or []:
        label = skill.get("skillName") or skill.get("directoryName") or ""
        if label:
            names.append(str(label))
    if names:
        return "、".join(names)
    if profile.skill_ids:
        return "技能ID: " + ", ".join(str(sid) for sid in profile.skill_ids)
    return "暂未配置技能（录用后可手动分配）"


def _normalize_skill_ids(raw: Any) -> list[int] | str:
    if raw is None:
        return []
    if not isinstance(raw, list):
        return "skill_ids 必须为数组"
    normalized: list[int] = []
    for i, item in enumerate(raw):
        try:
            normalized.append(int(item))
        except (TypeError, ValueError):
            return f"skill_ids[{i}] 不是有效整数: {item!r}"
    return normalized


def _validate_hire_name(db: Session, workspace_id: int, emp_name: str) -> str | None:
    if not emp_name:
        return "员工名称不能为空。"
    if emp_name.lower() in _RESERVED_EMPLOYEE_NAMES or emp_name == "总管助手":
        return "不能使用保留名称「总管助手」或 curator 作为新员工名称。"

    existing_curator = db.scalar(
        select(Employee).where(
            Employee.workspace_id == workspace_id,
            Employee.is_curator.is_(True),
        )
    )
    if existing_curator and emp_name == (existing_curator.name or ""):
        return "该名称已被总管助手占用。"

    dup = db.scalar(
        select(Employee).where(
            Employee.workspace_id == workspace_id,
            Employee.name == emp_name,
        )
    )
    if dup:
        return f"工作空间已存在名为「{emp_name}」的员工（ID={dup.id}）。"
    return None


def _hire_one_in_session(
    db: Session,
    workspace_id: int,
    name: str,
    description: str,
    skill_ids: list[int],
    *,
    token: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """在已有 Session 内创建一名员工，成功返回 hired 条目，失败返回 error 字段。"""
    emp_name = (name or "").strip()
    name_err = _validate_hire_name(db, workspace_id, emp_name)
    if name_err:
        return {"name": emp_name or name, "error": name_err}

    employee_in = EmployeeCreate(
        workspace_id=workspace_id,
        employee_name=emp_name,
        capability_desc=(description or "").strip() or None,
        status=1,
        skill_ids=skill_ids or [],
        mcp_ids=None,
        shift_schedule=None,
        tasks=None,
        user_id=user_id or "1",
    )

    try:
        employee = EmployeeService.create_employee(db, employee_in, token or "")
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, list):
            detail = "; ".join(str(d) for d in detail)
        return {"name": emp_name, "error": str(detail)}
    except Exception as exc:
        logger.error("hire one failed name=%s: %s", emp_name, exc, exc_info=True)
        return {"name": emp_name, "error": str(exc)}

    detail = EmployeeService.employee_detail_dict(db, employee)
    meta_skills = (detail.get("metadata") or {}).get("skills") or []
    skill_labels = [
        s.get("skill_name_zh") or s.get("skill_name") or str(s.get("skill_id", ""))
        for s in meta_skills
        if isinstance(s, dict)
    ]
    return {
        "employee_id": employee.id,
        "employee_name": employee.name,
        "employee_code": employee.employee_code,
        "skills": skill_labels,
    }


def _hire_one_with_fresh_session(
    workspace_id: int,
    name: str,
    description: str,
    skill_ids: list[int],
    *,
    token: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """每次录用使用独立 Session，避免污染总管流式会话的 DB 连接。"""
    db = get_session_local()()
    try:
        return _hire_one_in_session(
            db,
            workspace_id,
            name,
            description,
            skill_ids,
            token=token,
            user_id=user_id,
        )
    finally:
        db.close()


def recruit_candidates(
    workspace_id: int,
    user_request: str,
    count: int = 1,
    token: str | None = None,
) -> str:
    """生成招聘候选人列表，返回 JSON 字符串供总管展示。"""
    from src.service.agent.orchestrator.runtime import run_coro_on_main_loop

    request = (user_request or "").strip()
    if not request:
        return "错误：招聘需求描述不能为空。"

    n = _clamp_count(count)

    async def _run() -> tuple[list[EmployeeProfile], list[dict[str, Any]]]:
        return await EmployeeGenerationService.generate_candidates_for_orchestrator(
            request, n, token=token, workspace_id=workspace_id
        )

    profiles, _skills = run_coro_on_main_loop(_run())
    if not profiles:
        return "错误：未能生成任何候选人，请调整需求后重试。"

    candidates: list[dict[str, Any]] = []
    for i, profile in enumerate(profiles, start=1):
        candidates.append({
            "index": i,
            "name": profile.name,
            "description": profile.description,
            "skill_ids": profile.skill_ids,
            "skills_summary": _skills_summary(profile),
        })

    payload = {
        "type": "recruitment_candidates",
        "workspace_id": workspace_id,
        "total": len(candidates),
        "candidates": candidates,
        "hint": (
            "请向用户展示以上候选人并等待确认。"
            "录用 1 人：hire_employee(name, description, skill_ids)。"
            "录用多人：优先一次调用 hire_employees(candidates JSON 数组)，"
            '不要同一轮并行多次 hire_employee。'
            'skill_ids 无技能时传 "[]" 或 []。'
        ),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def hire_candidate(
    workspace_id: int,
    name: str,
    description: str,
    skill_ids: list[int],
    *,
    token: str | None = None,
    user_id: str | None = None,
) -> str:
    """确认录用单个候选人，创建数字员工（独立 DB Session）。"""
    result = _hire_one_with_fresh_session(
        workspace_id,
        name,
        description,
        skill_ids,
        token=token,
        user_id=user_id,
    )
    if result.get("error"):
        return f"错误：创建员工失败 — {result['error']}"

    payload = {
        "type": "employee_hired",
        "employee_id": result["employee_id"],
        "employee_name": result["employee_name"],
        "employee_code": result["employee_code"],
        "skills": result.get("skills") or [],
        "message": (
            f"「{result['employee_name']}」已入职（员工 ID={result['employee_id']}）。"
        ),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _parse_hire_candidate_entry(raw: Any, index: int) -> tuple[str, str, list[int]] | str:
    if not isinstance(raw, dict):
        return f"第 {index} 项不是对象"
    name = str(raw.get("name") or "").strip()
    if not name:
        return f"第 {index} 项缺少 name"
    description = str(raw.get("description") or "").strip()
    skill_raw = _normalize_skill_ids(raw.get("skill_ids"))
    if isinstance(skill_raw, str):
        return f"第 {index} 项 {skill_raw}"
    return name, description, skill_raw


def hire_candidates_batch(
    workspace_id: int,
    candidates: list[dict[str, Any]],
    *,
    token: str | None = None,
    user_id: str | None = None,
) -> str:
    """批量录用候选人，每人独立 Session，部分失败不影响其余。"""
    if not candidates:
        return "错误：candidates 不能为空。"
    if len(candidates) > MAX_HIRE_BATCH:
        return f"错误：单次最多录用 {MAX_HIRE_BATCH} 人。"

    succeeded: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for i, raw in enumerate(candidates, start=1):
        parsed = _parse_hire_candidate_entry(raw, i)
        if isinstance(parsed, str):
            failed.append({"index": i, "error": parsed})
            continue

        name, description, skill_ids = parsed
        result = _hire_one_with_fresh_session(
            workspace_id,
            name,
            description,
            skill_ids,
            token=token,
            user_id=user_id,
        )
        if result.get("error"):
            failed.append({
                "index": i,
                "name": name,
                "error": result["error"],
            })
            continue
        succeeded.append({
            "index": i,
            "employee_id": result["employee_id"],
            "employee_name": result["employee_name"],
            "employee_code": result["employee_code"],
            "skills": result.get("skills") or [],
        })

    payload: dict[str, Any] = {
        "type": "employees_hired",
        "total": len(candidates),
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
        "succeeded": succeeded,
        "failed": failed,
    }
    if succeeded and not failed:
        names = "、".join(item["employee_name"] for item in succeeded)
        payload["message"] = f"已成功录用 {len(succeeded)} 人：{names}。"
    elif succeeded:
        payload["message"] = (
            f"已录用 {len(succeeded)} 人，{len(failed)} 人失败，请查看 failed 详情。"
        )
    else:
        payload["message"] = "全部录用失败，请查看 failed 详情。"

    return json.dumps(payload, ensure_ascii=False, indent=2)
