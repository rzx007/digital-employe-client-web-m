"""PlanRun（一轮执行实例）的开启/收尾与 run_id 推导 helper。"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.plan_run import PlanRun
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now


def open_plan_run(
    db: Session, plan_id: int, workspace_id: int, *, trigger: str, auto_accept: bool
) -> PlanRun:
    """为某计划开一轮新 run（run_seq = 现有 max + 1）。调用方负责 commit。"""
    max_seq = db.scalar(
        select(func.max(PlanRun.run_seq)).where(PlanRun.plan_id == plan_id)
    ) or 0
    run = PlanRun(
        plan_id=plan_id,
        workspace_id=workspace_id,
        run_seq=max_seq + 1,
        trigger=trigger,
        auto_accept=auto_accept,
        status="running",
    )
    db.add(run)
    db.flush()
    return run


def latest_run_id_for_task(db: Session, task_id: int) -> int | None:
    """取某 task 最新一条执行日志的 run_id（=该 task 当前所在轮）。无日志/非编排 → None。"""
    return db.scalar(
        select(TaskExecutionLog.run_id)
        .where(TaskExecutionLog.task_id == task_id)
        .order_by(TaskExecutionLog.id.desc())
        .limit(1)
    )


def latest_run_id_for_plan(db: Session, plan_id: int) -> int | None:
    """取某计划最新一轮 run 的 id（按 run_seq）。无 run → None。"""
    return db.scalar(
        select(PlanRun.id)
        .where(PlanRun.plan_id == plan_id)
        .order_by(PlanRun.run_seq.desc())
        .limit(1)
    )


def settle_plan_run(db: Session, run_id: int) -> None:
    """标记一轮 run 全部定局。调用方负责 commit。"""
    run = db.get(PlanRun, run_id)
    if run is not None and run.status != "settled":
        run.status = "settled"
        run.ended_at = cst_now()
