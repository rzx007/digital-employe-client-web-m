"""月历视图按 user_id 过滤工作空间的调度计划（修跨用户泄漏）。"""

from __future__ import annotations

from src.models.orchestration_plan import OrchestrationPlan
from src.models.workspace import Workspace
from src.service.task_service import TaskService


def _ws(db, user_id: str) -> Workspace:
    ws = Workspace(name="w", root_path="/tmp/w", user_id=user_id)
    db.add(ws)
    db.flush()
    return ws


def _recurring_plan(db, ws, title: str, cron: str) -> OrchestrationPlan:
    plan = OrchestrationPlan(
        workspace_id=ws.id,
        conversation_id=1,
        user_input=title,
        plan_json="[]",
        status="confirmed",
        total_tasks=0,
        schedule_kind="recurring",
        cron=cron,
        is_recurring=True,
    )
    db.add(plan)
    db.flush()
    return plan


def test_monthly_calendar_only_includes_requesting_user_plans(db_session):
    """月历只投影请求用户名下工作空间的计划，不泄漏其他用户。"""
    ws_u1 = _ws(db_session, "u1")
    ws_u2 = _ws(db_session, "u2")
    _recurring_plan(db_session, ws_u1, "Alice 每日计划", "0 9 * * *")
    _recurring_plan(db_session, ws_u2, "Bob 每日计划", "0 9 * * *")
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u1", year=2099, month=6
    )

    serialized = str(payload)
    assert "Alice" in serialized  # u1 自己的计划应出现
    assert "Bob" not in serialized  # 不得泄漏 u2 的计划

    titles = {
        run["title"]
        for day in payload["days"].values()
        for run in day["runs"]
    }
    assert "Alice 每日计划" in titles
    assert "Bob 每日计划" not in titles
