import asyncio
import pytest
from src.service import workbench_metrics as wm


def test_metric_ids_whitelist():
    assert wm.metric_ids() == {
        "monthly_performance",
        "task_calendar",
        "today_tasks",
        "task_execution_stats",
        "employee_overview",
        "plan_progress",
        "skill_usage",
    }


def test_resolve_unknown_raises():
    with pytest.raises(KeyError):
        asyncio.run(wm.resolve_metric(None, "ghost", {}))


def test_monthly_performance_shapes_kpi(monkeypatch):
    async def fake(db):
        return {"name": "张三", "month": "2026-06", "balance": 1234.5, "gdp": 0.8, "rank": 2}

    monkeypatch.setattr(wm.PerformanceBalanceService, "get_remote_monthly_balance", staticmethod(fake))
    out = asyncio.run(wm.resolve_metric(None, "monthly_performance", {}))
    assert out["items"][0]["label"] and "value" in out["items"][0]


def test_task_calendar_shapes_table(monkeypatch):
    def fake_calendar(db, user_id, year, month, employee_id):
        return {
            "year": 2026,
            "month": 6,
            "days": {
                "2026-06-25": {
                    "day": 25,
                    "date": "2026-06-25",
                    "runs": [{"plan_id": 1, "title": "日报", "schedule_kind": "recurring", "time": "09:00", "cron": "0 9 * * *"}],
                }
            },
        }

    monkeypatch.setattr(wm.TaskService, "build_monthly_calendar", staticmethod(fake_calendar))
    out = asyncio.run(wm.resolve_metric(None, "task_calendar", {"user_id": "1", "year": 2026, "month": 6}))
    assert "columns" in out and "rows" in out
    assert out["rows"][0]["date"] == "2026-06-25"
    assert out["rows"][0]["title"] == "日报"
    assert out["rows"][0]["time"] == "09:00"


def test_today_tasks_shapes_list(monkeypatch):
    def fake_today(db, workspace_id):
        return [
            {
                "task_id": 1,
                "task_name": "发周报",
                "run_status": "pending",
                "execute_mode": "scheduled",
                "employee_name": "张三",
                "planned_at": "2026-06-25 09:00:00",
            }
        ]

    monkeypatch.setattr(wm.TaskService, "list_today_tasks", staticmethod(fake_today))
    out = asyncio.run(wm.resolve_metric(None, "today_tasks", {"workspace_id": 1}))
    assert "items" in out
    assert out["items"][0]["title"] == "发周报"
    assert "value" in out["items"][0]
    assert "badge" in out["items"][0]


def _kpi(out):
    return {it["label"]: it["value"] for it in out["items"]}


def test_task_execution_stats(db_session):
    from src.core.cst import cst_now
    from src.models.task_execution_log import TaskExecutionLog

    now = cst_now()
    for st in ["success", "success", "failed", "running"]:
        db_session.add(
            TaskExecutionLog(
                workspace_id=1,
                employee_id=1,
                task_name_snapshot="t",
                run_status=st,
                started_at=now,
            )
        )
    # 另一个工作空间的不应计入
    db_session.add(
        TaskExecutionLog(
            workspace_id=2,
            employee_id=1,
            task_name_snapshot="t",
            run_status="success",
            started_at=now,
        )
    )
    db_session.commit()
    items = _kpi(asyncio.run(wm.resolve_metric(db_session, "task_execution_stats", {"workspace_id": 1})))
    assert items["今日成功"] == 2
    assert items["失败"] == 1
    assert items["进行中"] == 1
    assert items["成功率"] == 67  # 2/(2+1)


def test_employee_overview(db_session):
    from src.models.employee import Employee

    db_session.add(Employee(workspace_id=1, employee_code="e1"))
    db_session.add(Employee(workspace_id=1, employee_code="e2"))
    db_session.add(Employee(workspace_id=1, employee_code="cur", is_curator=True))
    db_session.commit()
    items = _kpi(asyncio.run(wm.resolve_metric(db_session, "employee_overview", {"workspace_id": 1})))
    assert items["在职员工"] == 2  # 排除 is_curator
    assert items["近7天新增"] == 2


def test_plan_progress(db_session):
    from src.models.orchestration_plan import OrchestrationPlan

    for st in ["pending", "running", "running", "completed"]:
        db_session.add(
            OrchestrationPlan(workspace_id=1, conversation_id=1, user_input="x", status=st)
        )
    db_session.commit()
    items = _kpi(asyncio.run(wm.resolve_metric(db_session, "plan_progress", {"workspace_id": 1})))
    assert items["待确认"] == 1
    assert items["进行中"] == 2
    assert items["已完成"] == 1
    assert items["已取消"] == 0


def test_skill_usage(monkeypatch):
    import src.service.agent.orchestrator.tools.skills as skills_mod

    monkeypatch.setattr(
        skills_mod,
        "format_workspace_skills_list",
        lambda ws, compact, db: [
            {"source": "builtin"},
            {"source": "workspace"},
            {"source": "workspace"},
        ],
    )
    items = _kpi(asyncio.run(wm.resolve_metric(None, "skill_usage", {"workspace_id": 1})))
    assert items["技能总数"] == 3
    assert items["内置"] == 1
    assert items["工作区"] == 2
