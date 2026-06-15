"""总管再入整合协调器：组队子任务全部完成后，唤醒总管起一轮整合 turn。"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog

logger = logging.getLogger(__name__)


def collect_plan_execution_results(db: Session, plan) -> list[dict[str, Any]]:
    """收集某编排计划下所有子任务的执行结论（每任务取最新一条终态日志）。"""
    tasks = db.scalars(
        select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan.id)
    ).all()
    results: list[dict[str, Any]] = []
    for t in tasks:
        log = db.scalars(
            select(TaskExecutionLog)
            .where(TaskExecutionLog.task_id == t.id)
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if log is None:
            results.append({"task_name": t.task_name, "status": "unknown",
                            "content": "", "error": None})
            continue
        content = ""
        if log.output_json:
            try:
                content = json.loads(log.output_json).get("content", "") or ""
            except (ValueError, TypeError):
                content = ""
        results.append({
            "task_name": t.task_name,
            "status": log.run_status,
            "content": content,
            "result": log.run_result or "",
            "error": log.error_message,
        })
    return results
