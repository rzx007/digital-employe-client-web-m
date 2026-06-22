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
    """取某 task 最新一条**编排**执行日志的 run_id（=该 task 当前所在轮）。无编排日志 → None。

    过滤 run_id 非空：非编排日志（独立 run_task_job，run_id=NULL）不参与，
    避免最新一条恰为非编排日志时误判该 task 不在任何轮。
    """
    return db.scalar(
        select(TaskExecutionLog.run_id)
        .where(
            TaskExecutionLog.task_id == task_id,
            TaskExecutionLog.run_id.is_not(None),
        )
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


def create_scheduled_run_conversation(db: Session, plan, run) -> int:
    """为一轮 scheduled run 新建专属 curator 会话（session_flags=scheduled_run）
    + 种 plan.user_input 上下文。返回 conversation_id。调用方负责 commit 与异常处理。
    run_plan_job 与 execute_plan_run 共用，避免 execution↔scheduler 循环依赖。"""
    import json
    from src.core.request_utils import DEFAULT_USER_ID
    from src.models.conversation import Conversation, ConversationMessage
    from src.models.workspace import Workspace
    from src.service.employee_service import EmployeeService

    ws = db.get(Workspace, plan.workspace_id)
    user_id = ws.user_id if ws is not None else DEFAULT_USER_ID
    curator = EmployeeService.ensure_curator_employee(db, user_id, plan.workspace_id)
    summary = (plan.user_input or "").strip().replace("\n", " ")
    if len(summary) > 30:
        summary = summary[:30] + "…"
    title = f"「{summary}」· 第{run.run_seq}轮"
    flags = json.dumps(
        {"kind": "scheduled_run", "plan_id": plan.id, "run_seq": run.run_seq},
        ensure_ascii=False,
    )
    conv = Conversation(
        workspace_id=plan.workspace_id, user_id=user_id,
        target_type="curator", target_id=curator.id, title=title, session_flags=flags,
    )
    db.add(conv); db.flush()
    db.add(ConversationMessage(
        conversation_id=conv.id, role="user",
        content=plan.user_input or title, stream_state="completed",
    ))
    return conv.id
