import asyncio
import pytest
from src.service import workbench_metrics as wm


def test_metric_ids_whitelist():
    assert wm.metric_ids() == {"monthly_performance", "task_calendar", "today_tasks"}


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
