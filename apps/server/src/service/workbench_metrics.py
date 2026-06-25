"""Workbench metric registry — single source of truth for the metric whitelist.

Each resolver is **async** so it can be safely awaited inside FastAPI endpoints
without the ``asyncio.run()``-inside-running-loop ``RuntimeError``.

Return shapes match the frontend widget contract:
- kpi   → ``{"items": [{"label", "value", "unit"?, "delta"?, "deltaDir"?}]}``
- table → ``{"columns": [{"key", "label"}], "rows": [...]}``
- list  → ``{"items": [{"title", "value"?, "badge"?}]}``
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

from sqlalchemy.orm import Session

from src.service.performance_balance_service import PerformanceBalanceService
from src.service.task_service import TaskService


# ---------------------------------------------------------------------------
# Resolvers
# ---------------------------------------------------------------------------


async def _monthly_performance(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """KPI widget: 本月绩效结算摘要。"""
    data = await PerformanceBalanceService.get_remote_monthly_balance(db)
    # Remote API may return any shape; use .get() defensively.
    if not isinstance(data, dict):
        data = {}
    return {
        "items": [
            {"label": "本月结算", "value": data.get("balance"), "unit": "¥"},
            {"label": "GDP系数", "value": data.get("gdp")},
            {"label": "排名", "value": data.get("rank")},
        ]
    }


async def _task_calendar(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """Table widget: 本月任务日历（编排计划触发时间）。"""
    payload = TaskService.build_monthly_calendar(
        db=db,
        user_id=params.get("user_id", "1"),
        year=params.get("year"),
        month=params.get("month"),
        employee_id=params.get("employee_id"),
    )
    # payload: {"year": int, "month": int, "days": {"YYYY-MM-DD": {"day": int, "date": str, "runs": [...]}}}
    rows: list[dict[str, Any]] = []
    for date_key, info in (payload.get("days") or {}).items():
        for run in info.get("runs", []):
            rows.append(
                {
                    "date": date_key,
                    "time": run.get("time"),
                    "title": run.get("title"),
                }
            )
    return {
        "columns": [
            {"key": "date", "label": "日期"},
            {"key": "time", "label": "时间"},
            {"key": "title", "label": "任务"},
        ],
        "rows": rows,
    }


async def _today_tasks(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """List widget: 今日任务统一视图（待执行 + 已执行）。"""
    workspace_id: int = int(params.get("workspace_id") or 1)
    items_raw = TaskService.list_today_tasks(db, workspace_id)
    # Each item has: task_name, run_status, execute_mode, employee_name, planned_at, ...
    # Map to list widget shape: title = task_name, value = execute_mode, badge = run_status
    return {
        "items": [
            {
                "title": it.get("task_name"),
                "value": it.get("execute_mode"),
                "badge": it.get("run_status"),
            }
            for it in items_raw
        ]
    }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, Callable[[Session, dict[str, Any]], Awaitable[dict[str, Any]]]] = {
    "monthly_performance": _monthly_performance,
    "task_calendar": _task_calendar,
    "today_tasks": _today_tasks,
}


def metric_ids() -> set[str]:
    """Return the set of known metric IDs (the whitelist)."""
    return set(_REGISTRY)


async def resolve_metric(
    db: Session,
    metric_id: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Resolve a metric by ID.

    Raises ``KeyError`` for unknown metric_id values.
    """
    if metric_id not in _REGISTRY:
        raise KeyError(metric_id)
    return await _REGISTRY[metric_id](db, params)
