"""总管会话与任务/执行日志关联：解析、回填。"""

from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan

logger = logging.getLogger(__name__)


def resolve_orchestrator_conversation_id(
    db: Session, task: EmployeeTask
) -> int | None:
    """解析任务归属的总管会话：优先 source_conversation_id，否则经编排计划。"""
    if task.source_conversation_id is not None:
        return int(task.source_conversation_id)
    if task.orchestration_plan_id is None:
        return None
    plan = db.get(OrchestrationPlan, task.orchestration_plan_id)
    if plan is None:
        return None
    return int(plan.conversation_id)


def backfill_orchestrator_conversation_links(engine) -> None:
    """启动时回填：仅更新仍为 NULL 的 source_conversation_id / orchestrator_conversation_id。"""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "employee_tasks" not in tables or "task_execution_logs" not in tables:
        return

    et_cols = {c["name"] for c in inspector.get_columns("employee_tasks")}
    log_cols = {c["name"] for c in inspector.get_columns("task_execution_logs")}
    if "source_conversation_id" not in et_cols:
        return
    if "orchestrator_conversation_id" not in log_cols:
        return

    with engine.begin() as conn:
        r1 = conn.execute(
            text(
                """
                UPDATE employee_tasks
                SET source_conversation_id = (
                    SELECT conversation_id FROM orchestration_plans
                    WHERE orchestration_plans.id = employee_tasks.orchestration_plan_id
                )
                WHERE orchestration_plan_id IS NOT NULL
                  AND source_conversation_id IS NULL
                """
            )
        )
        r2 = conn.execute(
            text(
                """
                UPDATE task_execution_logs
                SET orchestrator_conversation_id = (
                    SELECT p.conversation_id
                    FROM employee_tasks t
                    JOIN orchestration_plans p ON t.orchestration_plan_id = p.id
                    WHERE t.id = task_execution_logs.task_id
                )
                WHERE task_id IS NOT NULL
                  AND orchestrator_conversation_id IS NULL
                """
            )
        )
        r3 = conn.execute(
            text(
                """
                UPDATE task_execution_logs
                SET orchestrator_conversation_id = conversation_id
                WHERE orchestrator_conversation_id IS NULL
                  AND conversation_id IS NOT NULL
                  AND conversation_id IN (
                    SELECT id FROM conversations WHERE target_type = 'curator'
                  )
                """
            )
        )

    if any(getattr(r, "rowcount", 0) for r in (r1, r2, r3)):
        logger.info(
            "backfill orchestrator links: tasks=%s logs(plan)=%s logs(curator)=%s",
            getattr(r1, "rowcount", 0),
            getattr(r2, "rowcount", 0),
            getattr(r3, "rowcount", 0),
        )
