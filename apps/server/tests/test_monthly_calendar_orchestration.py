"""月历视图：从 OrchestrationPlan 调度计划投影本月即将到来的运行。"""

from __future__ import annotations

from datetime import datetime

from src.models.orchestration_plan import OrchestrationPlan
from src.models.workspace import CST, Workspace, cst_now
from src.service.task_service import TaskService


def _ws(db, user_id: str) -> Workspace:
    ws = Workspace(name="w", root_path="/tmp/w", user_id=user_id)
    db.add(ws)
    db.flush()
    return ws


def _plan(db, ws, **kw) -> OrchestrationPlan:
    defaults = dict(
        workspace_id=ws.id,
        conversation_id=1,
        user_input="测试需求",
        plan_json="[]",
        status="confirmed",
        total_tasks=0,
    )
    defaults.update(kw)
    plan = OrchestrationPlan(**defaults)
    db.add(plan)
    db.flush()
    return plan


def _all_runs(payload) -> list[dict]:
    return [run for day in payload["days"].values() for run in day["runs"]]


def test_aggregates_recurring_plans_across_multiple_workspaces(db_session):
    """同一用户拥有多个工作空间，应聚合所有空间的 recurring 计划。"""
    # 用一个未来年份，保证整月都在 cst_now() 之后（base = max(month_start, now)）。
    ws1 = _ws(db_session, "u-multi")
    ws2 = _ws(db_session, "u-multi")
    _plan(
        db_session,
        ws1,
        user_input="空间一每天任务",
        schedule_kind="recurring",
        cron="0 9 * * *",
        is_recurring=True,
    )
    _plan(
        db_session,
        ws2,
        user_input="空间二每天任务",
        schedule_kind="recurring",
        cron="30 14 * * *",
        is_recurring=True,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-multi", year=2099, month=6
    )

    # 每天都应有两个计划各一条运行（每天 9:00 和 14:30）。
    for day in payload["days"].values():
        times = sorted(r["time"] for r in day["runs"])
        assert times == ["09:00", "14:30"], day["date"]
        for r in day["runs"]:
            assert r["schedule_kind"] == "recurring"
            assert r["cron"] in ("0 9 * * *", "30 14 * * *")


def test_recurring_daily_cron_has_run_every_day_deduped(db_session):
    """每日 cron：每天恰好一条运行（去重，一个 plan 每天至多 1 条）。"""
    ws = _ws(db_session, "u-rec")
    plan = _plan(
        db_session,
        ws,
        schedule_kind="recurring",
        cron="0 8 * * *",
        is_recurring=True,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-rec", year=2099, month=6
    )

    for day in payload["days"].values():
        assert len(day["runs"]) == 1
        run = day["runs"][0]
        assert run["plan_id"] == plan.id
        assert run["time"] == "08:00"
        assert run["title"] == plan.user_input[:30]


def test_sub_daily_cron_caps_at_one_run_per_day(db_session):
    """细粒度 cron（每分钟）每天也只投影一条——验证按天跳进的迭代上限（防 ~4.3万次空转）。"""
    ws = _ws(db_session, "u-fine")
    _plan(
        db_session,
        ws,
        schedule_kind="recurring",
        cron="* * * * *",  # 每分钟
        is_recurring=True,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-fine", year=2099, month=6
    )
    # 6 月 30 天，每天恰好 1 条（不是每天 1440 条、更不是整月空转）。
    assert len(payload["days"]) == 30
    for day in payload["days"].values():
        assert len(day["runs"]) == 1


def test_current_month_truncates_past_days(db_session):
    """当月：base=max(月初, now)，今天之前的天不投影（只显即将到来）。"""
    ws = _ws(db_session, "u-cur")
    _plan(
        db_session,
        ws,
        schedule_kind="recurring",
        cron="0 8 * * *",
        is_recurring=True,
    )
    db_session.commit()

    today = cst_now().date()
    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-cur", year=today.year, month=today.month
    )
    for day_key, day in payload["days"].items():
        day_d = datetime.strptime(day_key, "%Y-%m-%d").date()
        if day_d < today:
            assert day["runs"] == [], f"过去的天不应有运行: {day_key}"
        # 今天及以后该有一条（今天若已过 08:00 由 cron 下一触发落明天——故只断言「未来天」必有）
        if day_d > today:
            assert len(day["runs"]) == 1, f"未来的天应有一条: {day_key}"


def test_once_past_day_in_current_month_not_shown(db_session):
    """当月已过去那天的未跑 once 不显示（与 recurring 的「即将到来」一致）。"""
    today = cst_now().date()
    if today.day <= 1:
        return  # 月初无「过去的天」，跳过
    ws = _ws(db_session, "u-once-past")
    past_day = datetime(today.year, today.month, 1, 9, 0, tzinfo=CST)
    _plan(
        db_session,
        ws,
        schedule_kind="once",
        run_at=past_day,
        last_run_at=None,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-once-past", year=today.year, month=today.month
    )
    assert _all_runs(payload) == []


def test_once_run_at_in_month_appears_on_that_day(db_session):
    ws = _ws(db_session, "u-once")
    ra = datetime(2099, 6, 15, 10, 30, tzinfo=CST)
    plan = _plan(
        db_session,
        ws,
        schedule_kind="once",
        run_at=ra,
        last_run_at=None,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-once", year=2099, month=6
    )

    runs = _all_runs(payload)
    assert len(runs) == 1
    assert runs[0]["plan_id"] == plan.id
    assert runs[0]["schedule_kind"] == "once"
    assert runs[0]["time"] == "10:30"
    assert runs[0]["cron"] is None
    assert payload["days"]["2099-06-15"]["runs"][0]["plan_id"] == plan.id


def test_once_naive_run_at_does_not_crash(db_session):
    """run_at 为 naive datetime（SQLite 取回常见）不应抛 TypeError。"""
    ws = _ws(db_session, "u-naive")
    plan = _plan(
        db_session,
        ws,
        schedule_kind="once",
        run_at=datetime(2099, 6, 10, 9, 0),  # naive
        last_run_at=None,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-naive", year=2099, month=6
    )
    runs = _all_runs(payload)
    assert len(runs) == 1
    assert runs[0]["plan_id"] == plan.id
    assert runs[0]["time"] == "09:00"


def test_once_already_run_is_absent(db_session):
    """once 计划已执行（last_run_at 非空）→ 不再投影。"""
    ws = _ws(db_session, "u-done")
    _plan(
        db_session,
        ws,
        schedule_kind="once",
        run_at=datetime(2099, 6, 15, 10, 30, tzinfo=CST),
        last_run_at=datetime(2099, 6, 15, 10, 31, tzinfo=CST),
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-done", year=2099, month=6
    )
    assert _all_runs(payload) == []


def test_unparseable_cron_is_skipped_without_crash(db_session):
    """无法解析的 cron 跳过该计划，不拖垮整个日历。"""
    ws = _ws(db_session, "u-bad")
    _plan(
        db_session,
        ws,
        user_input="坏 cron",
        schedule_kind="recurring",
        cron="this is not a cron",
        is_recurring=True,
    )
    good = _plan(
        db_session,
        ws,
        user_input="好 cron",
        schedule_kind="recurring",
        cron="0 7 * * *",
        is_recurring=True,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-bad", year=2099, month=6
    )
    # 坏 cron 被跳过，好 cron 仍每天投影。
    for day in payload["days"].values():
        assert len(day["runs"]) == 1
        assert day["runs"][0]["plan_id"] == good.id


def test_empty_when_no_plans_all_days_have_empty_runs(db_session):
    """无计划时：整月每天都存在且 runs=[]。"""
    _ws(db_session, "u-empty")
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-empty", year=2099, month=6
    )
    assert len(payload["days"]) == 30  # 6 月 30 天
    for day in payload["days"].values():
        assert day["runs"] == []


def test_non_confirmed_or_unscheduled_plans_excluded(db_session):
    """非 confirmed 或 schedule_kind 为 None 的计划不参与投影。"""
    ws = _ws(db_session, "u-filter")
    _plan(
        db_session,
        ws,
        status="pending",  # 未确认
        schedule_kind="recurring",
        cron="0 9 * * *",
        is_recurring=True,
    )
    _plan(
        db_session,
        ws,
        status="confirmed",
        schedule_kind=None,  # 即时，无调度
        cron=None,
    )
    db_session.commit()

    payload = TaskService.build_monthly_calendar(
        db_session, user_id="u-filter", year=2099, month=6
    )
    assert _all_runs(payload) == []
