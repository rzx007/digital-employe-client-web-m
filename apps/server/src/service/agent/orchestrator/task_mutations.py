from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from src.db.session import get_session_local
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask

logger = logging.getLogger(__name__)

MAX_TASK_DELETE_BATCH = 20


def _delete_task_in_session(
    db: Session,
    workspace_id: int,
    task_id: int,
) -> dict[str, Any]:
    """在已有 Session 内删除任务，成功返回 task_id/task_name，失败返回 error。"""
    task = db.get(EmployeeTask, task_id)
    if not task:
        return {"task_id": task_id, "error": f"任务 #{task_id} 不存在。"}
    if task.workspace_id != workspace_id:
        return {
            "task_id": task_id,
            "error": f"任务 #{task_id} 不属于当前工作空间。",
        }

    task_name = task.task_name
    try:
        db.delete(task)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("delete task failed task_id=%s: %s", task_id, exc, exc_info=True)
        return {"task_id": task_id, "error": str(exc)}

    return {"task_id": task_id, "task_name": task_name}


def _delete_task_with_fresh_session(
    workspace_id: int,
    task_id: int,
) -> dict[str, Any]:
    """每次删除使用独立 Session，避免污染总管流式会话的 DB 连接。"""
    db = get_session_local()()
    try:
        return _delete_task_in_session(db, workspace_id, task_id)
    finally:
        db.close()


def delete_tasks_batch(
    workspace_id: int,
    task_ids: list[int],
    *,
    reload_scheduler: bool = True,
) -> str:
    """批量删除任务，每人独立 Session，部分失败不影响其余。"""
    if not task_ids:
        return "错误：task_ids 不能为空。"
    if len(task_ids) > MAX_TASK_DELETE_BATCH:
        return f"错误：单次最多删除 {MAX_TASK_DELETE_BATCH} 个任务。"

    succeeded: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for i, task_id in enumerate(task_ids, start=1):
        result = _delete_task_with_fresh_session(workspace_id, task_id)
        if result.get("error"):
            failed.append({
                "index": i,
                "task_id": task_id,
                "error": result["error"],
            })
            continue
        succeeded.append({
            "index": i,
            "task_id": result["task_id"],
            "task_name": result.get("task_name") or "",
        })

    if reload_scheduler and succeeded:
        from src.service.task_scheduler_service import TaskSchedulerService

        TaskSchedulerService.reload_jobs()

    payload: dict[str, Any] = {
        "type": "tasks_deleted",
        "total": len(task_ids),
        "succeeded_count": len(succeeded),
        "failed_count": len(failed),
        "succeeded": succeeded,
        "failed": failed,
    }
    if succeeded and not failed:
        names = "、".join(
            f"#{item['task_id']} {item['task_name']}".strip()
            for item in succeeded
        )
        payload["message"] = f"已成功删除 {len(succeeded)} 个任务：{names}。"
    elif succeeded:
        payload["message"] = (
            f"已删除 {len(succeeded)} 个任务，{len(failed)} 个失败，请查看 failed 详情。"
        )
    else:
        payload["message"] = "全部删除失败，请查看 failed 详情。"

    return json.dumps(payload, ensure_ascii=False, indent=2)


def _update_task_in_session(
    db: Session,
    workspace_id: int,
    task_id: int,
    *,
    task_name: str | None = None,
    prompt: str | None = None,
    cron: str | None = None,
    employee_id: int | None = None,
) -> dict[str, Any]:
    """在已有 Session 内更新任务，返回 changed 列表或 error。"""
    task = db.get(EmployeeTask, task_id)
    if not task:
        return {"error": f"任务 #{task_id} 不存在。"}
    if task.workspace_id != workspace_id:
        return {"error": f"任务 #{task_id} 不属于当前工作空间。"}

    changed: list[str] = []
    if task_name is not None:
        task.task_name = task_name
        changed.append("任务名称")
    if prompt is not None:
        task.user_prompt = prompt
        changed.append("执行指令")
    if cron is not None:
        task.cron_expression = cron if cron else ""
        task.execute_mode = "scheduled" if cron else "immediate"
        changed.append("调度时间")
    if employee_id is not None:
        emp = db.get(Employee, employee_id)
        if not emp:
            return {"error": f"员工 ID={employee_id} 不存在。"}
        if emp.workspace_id != workspace_id:
            return {
                "error": f"员工 ID={employee_id} 不属于当前工作空间。",
            }
        task.employee_id = employee_id
        task.employee_name_snapshot = emp.name or ""
        changed.append("执行员工")

    if not changed:
        return {
            "task_id": task_id,
            "task_name": task.task_name,
            "changed": [],
            "message": "未做任何修改。",
        }

    try:
        db.commit()
        db.refresh(task)
    except Exception as exc:
        db.rollback()
        logger.error("update task failed task_id=%s: %s", task_id, exc, exc_info=True)
        return {"error": str(exc)}

    return {
        "task_id": task_id,
        "task_name": task.task_name,
        "changed": changed,
        "message": f"任务 #{task_id} ({task.task_name}) 已更新：{'、'.join(changed)}。",
    }


def _update_task_with_fresh_session(
    workspace_id: int,
    task_id: int,
    *,
    task_name: str | None = None,
    prompt: str | None = None,
    cron: str | None = None,
    employee_id: int | None = None,
) -> dict[str, Any]:
    """每次更新使用独立 Session。"""
    db = get_session_local()()
    try:
        return _update_task_in_session(
            db,
            workspace_id,
            task_id,
            task_name=task_name,
            prompt=prompt,
            cron=cron,
            employee_id=employee_id,
        )
    finally:
        db.close()
