from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.schemas.employee import EmployeeCreate, EmployeeProfile
from src.service.employee_generation_service import EmployeeGenerationService
from src.service.employee_service import EmployeeService

logger = logging.getLogger(__name__)

MIN_RECRUIT_COUNT = 1
MAX_RECRUIT_COUNT = 5
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
    return "（未匹配技能）"


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

    profiles, skills = run_coro_on_main_loop(_run())
    if not skills:
        return (
            "错误：无法获取可用技能列表（远程技能需登录 token，本地技能目录可能为空）。"
            "请检查技能配置或使用招聘页面。"
        )
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
            "用户确认后调用 hire_employee，传入对应 name、description、"
            'skill_ids（JSON 数组字符串，如 "[-101,-102]"）。'
        ),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def hire_candidate(
    db: Session,
    workspace_id: int,
    name: str,
    description: str,
    skill_ids: list[int],
    *,
    token: str | None = None,
    user_id: str | None = None,
) -> str:
    """确认录用候选人，创建数字员工。"""
    emp_name = (name or "").strip()
    if not emp_name:
        return "错误：员工名称不能为空。"
    if emp_name.lower() in _RESERVED_EMPLOYEE_NAMES or emp_name == "总管助手":
        return "错误：不能使用保留名称「总管助手」或 curator 作为新员工名称。"

    existing_curator = db.scalar(
        select(Employee).where(
            Employee.workspace_id == workspace_id,
            Employee.is_curator.is_(True),
        )
    )
    if existing_curator and emp_name == (existing_curator.name or ""):
        return "错误：该名称已被总管助手占用。"

    dup = db.scalar(
        select(Employee).where(
            Employee.workspace_id == workspace_id,
            Employee.name == emp_name,
        )
    )
    if dup:
        return f"错误：工作空间已存在名为「{emp_name}」的员工（ID={dup.id}）。"

    if not skill_ids:
        return "错误：skill_ids 不能为空，请从候选人信息中复制有效的技能 ID 列表。"

    employee_in = EmployeeCreate(
        workspace_id=workspace_id,
        employee_name=emp_name,
        capability_desc=(description or "").strip() or None,
        status=1,
        skill_ids=skill_ids,
        mcp_ids=None,
        shift_schedule=None,
        tasks=None,
        user_id=user_id or "1",
    )

    try:
        employee = EmployeeService.create_employee(
            db, employee_in, token or ""
        )
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, list):
            detail = "; ".join(str(d) for d in detail)
        return f"错误：创建员工失败 — {detail}"
    except Exception as exc:
        logger.error("hire_candidate failed: %s", exc, exc_info=True)
        return f"错误：创建员工失败 — {exc}"

    detail = EmployeeService.employee_detail_dict(db, employee)
    meta_skills = (detail.get("metadata") or {}).get("skills") or []
    skill_labels = [
        s.get("skill_name_zh") or s.get("skill_name") or str(s.get("skill_id", ""))
        for s in meta_skills
        if isinstance(s, dict)
    ]

    result = {
        "type": "employee_hired",
        "employee_id": employee.id,
        "employee_name": employee.name,
        "employee_code": employee.employee_code,
        "skills": skill_labels,
        "message": f"「{employee.name}」已入职（员工 ID={employee.id}）。",
    }
    return json.dumps(result, ensure_ascii=False, indent=2)
