"""数字员工批量解聘业务逻辑（对标 task_mutations 的批量删任务）。

- `_delete_employee_in_session` / `_delete_employee_with_fresh_session`：单人解聘，
  校验归属、禁止解聘总管助手，删除 + 清理最近联系人。
- `delete_employees_batch`：逐人独立 Session 解聘，部分失败不影响其余，整批只刷新一次调度。

@tool 包装见 `tools.employees.delete_employees_batch`。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from src.db.session import sqlite_db_session
from src.models.employee import Employee

logger = logging.getLogger(__name__)

MAX_DISMISS_BATCH = 5


def _delete_employee_in_session(
    db: Session,
    user_id: str | None,
    workspace_id: int,
    employee_id: int,
) -> dict[str, Any]:
    """在已有 Session 内解聘员工，成功返回 employee_id/employee_name，失败返回 error。"""
    employee = db.get(Employee, employee_id)
    if not employee:
        return {"employee_id": employee_id, "error": f"员工 ID={employee_id} 不存在。"}
    if employee.user_id != user_id:
        return {
            "employee_id": employee_id,
            "error": f"员工 ID={employee_id} 不属于当前用户。",
        }
    if employee.is_curator:
        return {
            "employee_id": employee_id,
            "error": "不能解聘总管助手。",
        }

    employee_name = employee.name or str(employee_id)

    from src.service.recent_contact_service import RecentContactService

    try:
        db.delete(employee)
        db.commit()
        RecentContactService.delete_by_target(
            db, workspace_id, "employee", employee_id
        )
    except Exception as exc:
        db.rollback()
        logger.error(
            "dismiss employee failed employee_id=%s: %s",
            employee_id,
            exc,
            exc_info=True,
        )
        return {"employee_id": employee_id, "error": str(exc)}

    return {"employee_id": employee_id, "employee_name": employee_name}


def _delete_employee_with_fresh_session(
    user_id: str | None,
    workspace_id: int,
    employee_id: int,
) -> dict[str, Any]:
    """每次解聘使用独立 Session，避免污染总管流式会话的 DB 连接。"""
    with sqlite_db_session() as db:
        return _delete_employee_in_session(db, user_id, workspace_id, employee_id)


def delete_employees_batch(
    user_id: str | None,
    workspace_id: int,
    employee_ids: list[int],
    *,
    reload_scheduler: bool = True,
) -> str:
    """批量解聘员工，每人独立 Session，部分失败不影响其余。"""
    if not employee_ids:
        return "错误：employee_ids 不能为空。"
    if len(employee_ids) > MAX_DISMISS_BATCH:
        return f"错误：单次最多解聘 {MAX_DISMISS_BATCH} 人。"

    succeeded: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for i, employee_id in enumerate(employee_ids, start=1):
        result = _delete_employee_with_fresh_session(user_id, workspace_id, employee_id)
        if result.get("error"):
            failed.append({
                "index": i,
                "employee_id": employee_id,
                "error": result["error"],
            })
            continue
        succeeded.append({
            "index": i,
            "employee_id": result["employee_id"],
            "employee_name": result.get("employee_name") or "",
        })

    if reload_scheduler and succeeded:
        from src.service.task_scheduler_service import TaskSchedulerService

        TaskSchedulerService.reload_jobs()

    payload: dict[str, Any] = {
        "type": "employees_dismissed",
        "total": len(employee_ids),
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
        "succeeded": succeeded,
        "failed": failed,
    }
    if succeeded and not failed:
        names = "、".join(item["employee_name"] for item in succeeded)
        payload["message"] = f"已成功解聘 {len(succeeded)} 人：{names}。"
    elif succeeded:
        payload["message"] = (
            f"已解聘 {len(succeeded)} 人，{len(failed)} 人失败，请查看 failed 详情。"
        )
    else:
        payload["message"] = "全部解聘失败，请查看 failed 详情。"

    return json.dumps(payload, ensure_ascii=False, indent=2)
