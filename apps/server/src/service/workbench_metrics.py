"""Workbench metric registry — single source of truth for the metric whitelist.

Each resolver is **async** so it can be safely awaited inside FastAPI endpoints
without the ``asyncio.run()``-inside-running-loop ``RuntimeError``.

Return shapes match the frontend widget contract:
- kpi   → ``{"items": [{"label", "value", "unit"?, "delta"?, "deltaDir"?}]}``
- table → ``{"columns": [{"key", "label"}], "rows": [...]}``
- list  → ``{"items": [{"title", "value"?, "badge"?}]}``
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.cst import cst_now
from src.models.employee import Employee
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace
from src.service.performance_balance_service import PerformanceBalanceService
from src.service.task_service import TaskService

logger = logging.getLogger(__name__)

# workspace_file 读取上限,防误读超大文件拖垮轮询
_MAX_FILE_BYTES = 5 * 1024 * 1024


def _ws(params: dict[str, Any]) -> int:
    return int(params.get("workspace_id") or 1)


def _day_start(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


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


async def _task_execution_stats(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """KPI widget: 今日任务执行统计 + 成功率(读 task_execution_log，按工作空间)。"""
    ws = _ws(params)
    today0 = _day_start(cst_now())
    rows = db.execute(
        select(TaskExecutionLog.run_status, func.count())
        .where(
            TaskExecutionLog.workspace_id == ws,
            TaskExecutionLog.started_at >= today0,
        )
        .group_by(TaskExecutionLog.run_status)
    ).all()
    by = {status: int(n) for status, n in rows}
    success = by.get("success", 0)
    failed = by.get("failed", 0)
    running = by.get("running", 0) + by.get("queued", 0) + by.get("pending", 0)
    done = success + failed
    rate = round(success / done * 100) if done else None
    return {
        "items": [
            {"label": "今日成功", "value": success, "deltaDir": "up"},
            {"label": "失败", "value": failed, "deltaDir": "down" if failed else "flat"},
            {"label": "进行中", "value": running},
            {"label": "成功率", "value": rate, "unit": "%"},
        ]
    }


async def _employee_overview(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """KPI widget: 员工概览(在职员工数 + 近7天新增；排除 AI 总管 is_curator)。"""
    ws = _ws(params)
    week_ago = cst_now() - timedelta(days=7)
    headcount = (
        db.scalar(
            select(func.count())
            .select_from(Employee)
            .where(Employee.workspace_id == ws, Employee.is_curator.is_(False))
        )
        or 0
    )
    recent = (
        db.scalar(
            select(func.count())
            .select_from(Employee)
            .where(
                Employee.workspace_id == ws,
                Employee.is_curator.is_(False),
                Employee.created_at >= week_ago,
            )
        )
        or 0
    )
    return {
        "items": [
            {"label": "在职员工", "value": int(headcount)},
            {
                "label": "近7天新增",
                "value": int(recent),
                "deltaDir": "up" if recent else "flat",
            },
        ]
    }


async def _plan_progress(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """KPI widget: 编排计划进度(按状态计数，读 orchestration_plan)。"""
    ws = _ws(params)
    rows = db.execute(
        select(OrchestrationPlan.status, func.count())
        .where(OrchestrationPlan.workspace_id == ws)
        .group_by(OrchestrationPlan.status)
    ).all()
    by = {status: int(n) for status, n in rows}
    return {
        "items": [
            {"label": "待确认", "value": by.get("pending", 0)},
            {"label": "进行中", "value": by.get("running", 0)},
            {"label": "已完成", "value": by.get("completed", 0)},
            {"label": "已取消", "value": by.get("cancelled", 0)},
        ]
    }


async def _skill_usage(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """KPI widget: 技能使用情况(总数 + 按来源；读本地技能目录)。"""
    ws = _ws(params)
    try:
        from src.service.agent.orchestrator.tools.skills import (
            format_workspace_skills_list,
        )

        # db=None 跳过需要 orchestrator runtime 上下文的 assignees 查询,只取来源计数
        items = format_workspace_skills_list(ws, compact=True, db=None)
    except Exception:
        logger.debug("skill_usage 读取技能目录失败", exc_info=True)
        items = []
    total = len(items)
    builtin = sum(1 for it in items if it.get("source") == "builtin")
    return {
        "items": [
            {"label": "技能总数", "value": total},
            {"label": "内置", "value": builtin},
            {"label": "工作区", "value": total - builtin},
        ]
    }


async def _task_execution_trend(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """Trend widget: 近7天执行趋势(line/area 形状)。"""
    ws = _ws(params)
    start = _day_start(cst_now()) - timedelta(days=6)  # 含今天共7天
    raw = db.execute(
        select(func.date(TaskExecutionLog.started_at), TaskExecutionLog.run_status, func.count())
        .where(TaskExecutionLog.workspace_id == ws, TaskExecutionLog.started_at >= start)
        .group_by(func.date(TaskExecutionLog.started_at), TaskExecutionLog.run_status)
    ).all()
    agg: dict[str, dict[str, int]] = {}
    for d, st, n in raw:
        agg.setdefault(str(d), {})[st] = int(n)
    rows = []
    for i in range(7):
        day = start + timedelta(days=i)
        b = agg.get(day.strftime("%Y-%m-%d"), {})
        rows.append({"date": day.strftime("%m-%d"), "success": b.get("success", 0), "failed": b.get("failed", 0)})
    return {
        "xKey": "date",
        "series": [{"key": "success", "label": "成功"}, {"key": "failed", "label": "失败"}],
        "rows": rows,
    }


async def _task_status_distribution(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """Pie widget: 近7天任务状态分布。"""
    ws = _ws(params)
    start = _day_start(cst_now()) - timedelta(days=6)
    raw = db.execute(
        select(TaskExecutionLog.run_status, func.count())
        .where(TaskExecutionLog.workspace_id == ws, TaskExecutionLog.started_at >= start)
        .group_by(TaskExecutionLog.run_status)
    ).all()
    LABELS = {
        "success": "成功",
        "failed": "失败",
        "running": "进行中",
        "queued": "排队",
        "timeout": "超时",
        "cancelled": "已取消",
        "pending": "待执行",
    }
    return {"items": [{"name": LABELS.get(st, st), "value": int(n)} for st, n in raw]}


async def _plan_status_distribution(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """Pie widget: 编排计划状态分布。"""
    ws = _ws(params)
    raw = db.execute(
        select(OrchestrationPlan.status, func.count())
        .where(OrchestrationPlan.workspace_id == ws)
        .group_by(OrchestrationPlan.status)
    ).all()
    LABELS = {"pending": "待确认", "running": "进行中", "completed": "已完成", "cancelled": "已取消"}
    return {"items": [{"name": LABELS.get(st, st), "value": int(n)} for st, n in raw]}


async def _workspace_file(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    """读工作空间内的 JSON 文件当 widget 数据(定时任务写文件 → 看板按 refreshSec 自动刷)。

    - ``params.path``:相对工作空间根目录的路径(允许子目录如 ``artifacts/wc-today.json``),
      限制在工作空间目录内(防 ``..`` 越权),只允许 ``.json``。
    - 文件内容须为 JSON 对象,形状匹配所绑定的 widget type(如 table→{columns,rows}、
      kpi→{items});顶层是数组则按 ``{"items": [...]}`` 兜底包一层。
    - 文件缺失 / 解析失败 → 返回 ``{}``(widget 显示空态),不抛 500,适配实时轮询。
    """
    ws_id = _ws(params)
    rel = str(params.get("path") or "").strip().replace("\\", "/")
    if not rel:
        raise ValueError("workspace_file 需要 params.path")
    ws = db.get(Workspace, ws_id)
    if ws is None or not ws.root_path:
        return {}
    base = Path(ws.root_path).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base):
        raise ValueError("path 越出工作空间目录")
    if target.suffix.lower() != ".json":
        raise ValueError("workspace_file 只支持 .json 文件")
    if not target.is_file():
        logger.debug("workspace_file 文件不存在: %s", target)
        return {}
    try:
        if target.stat().st_size > _MAX_FILE_BYTES:
            logger.warning("workspace_file 文件过大,跳过: %s", target)
            return {}
        parsed = json.loads(target.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("workspace_file 读取/解析失败: %s", target, exc_info=True)
        return {}
    if isinstance(parsed, list):
        return {"items": parsed}
    if not isinstance(parsed, dict):
        return {}
    return parsed


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, Callable[[Session, dict[str, Any]], Awaitable[dict[str, Any]]]] = {
    "monthly_performance": _monthly_performance,
    "task_calendar": _task_calendar,
    "today_tasks": _today_tasks,
    "task_execution_stats": _task_execution_stats,
    "employee_overview": _employee_overview,
    "plan_progress": _plan_progress,
    "skill_usage": _skill_usage,
    "workspace_file": _workspace_file,
    "task_execution_trend": _task_execution_trend,
    "task_status_distribution": _task_status_distribution,
    "plan_status_distribution": _plan_status_distribution,
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
