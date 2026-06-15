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
            results.append({
                "task_name": t.task_name,
                "status": "unknown",
                "content": "",
                "result": "",
                "error": None,
            })
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


def build_reentry_brief(results: list[dict[str, Any]]) -> str:
    """把各子任务结论拼成给总管的整合指令（系统消息）。"""
    lines: list[str] = []
    for r in results:
        head = f"### 子任务：{r['task_name']}（{r['status']}）"
        lines.append(head)
        if r.get("content"):
            lines.append(r["content"])
        elif r.get("error"):
            lines.append(f"（失败）{r['error']}")
        elif r.get("result"):
            lines.append(r["result"])
        lines.append("")
    body = "\n".join(lines).strip()
    return (
        "（系统）你派出的团队子任务已全部完成。以下是各子任务的结论，"
        "团队的产物文件都在共享工作桌（$WORKSPACE_DIR，可直接 ls/read 查看）。\n\n"
        f"{body}\n\n"
        "请你**整合**这些成果，必要时读取共享桌上的产物文件核对，"
        "然后向用户给出一份完整、连贯的交付与说明。"
        "若有子任务失败，请如实说明并给出后续建议。不要重新派活，除非确有必要。"
    )
