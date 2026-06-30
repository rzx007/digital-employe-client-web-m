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
        "workspace_file",
        "task_execution_trend",
        "task_status_distribution",
        "plan_status_distribution",
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


def _make_workspace(db_session, root: str) -> int:
    from src.models.workspace import Workspace

    ws = Workspace(name="w", root_path=root, user_id="u1")
    db_session.add(ws)
    db_session.commit()
    return ws.id


def test_workspace_file_reads_json(db_session, tmp_path):
    import json as _json

    (tmp_path / "wc-today.json").write_text(
        _json.dumps({"items": [{"label": "今日比赛", "value": 1}]}), encoding="utf-8"
    )
    ws_id = _make_workspace(db_session, str(tmp_path))
    out = asyncio.run(
        wm.resolve_metric(
            db_session,
            "workspace_file",
            {"workspace_id": ws_id, "path": "wc-today.json"},
        )
    )
    assert out["items"][0]["label"] == "今日比赛"


def test_workspace_file_subdir_and_array_wrap(db_session, tmp_path):
    import json as _json

    sub = tmp_path / "artifacts"
    sub.mkdir()
    (sub / "scorers.json").write_text(_json.dumps([{"title": "梅西"}]), encoding="utf-8")
    ws_id = _make_workspace(db_session, str(tmp_path))
    out = asyncio.run(
        wm.resolve_metric(
            db_session,
            "workspace_file",
            {"workspace_id": ws_id, "path": "artifacts/scorers.json"},
        )
    )
    assert out == {"items": [{"title": "梅西"}]}  # 顶层数组兜底包成 items


def test_workspace_file_app_managed_reads_from_artifacts(db_session, tmp_path, monkeypatch):
    """app 托管项目:文件在 root/artifacts,path 直接写文件名应能读到(对齐 $WORKSPACE_DIR)。"""
    import json as _json

    from src.service.agent import workspace_paths

    monkeypatch.setattr(workspace_paths, "APP_PROJECTS_BASE", tmp_path)
    root = tmp_path / "projects" / "1"
    (root / "artifacts").mkdir(parents=True)
    (root / "artifacts" / "wc-today.json").write_text(
        _json.dumps({"items": [{"label": "今日", "value": 1}]}), encoding="utf-8"
    )
    ws_id = _make_workspace(db_session, str(root))
    out = asyncio.run(
        wm.resolve_metric(
            db_session, "workspace_file", {"workspace_id": ws_id, "path": "wc-today.json"}
        )
    )
    assert out["items"][0]["label"] == "今日"  # 文件名即可,自动落到 artifacts


def test_workspace_file_traversal_blocked(db_session, tmp_path):
    ws_id = _make_workspace(db_session, str(tmp_path))
    with pytest.raises(ValueError):
        asyncio.run(
            wm.resolve_metric(
                db_session,
                "workspace_file",
                {"workspace_id": ws_id, "path": "../secret.json"},
            )
        )


def test_workspace_file_missing_returns_empty(db_session, tmp_path):
    ws_id = _make_workspace(db_session, str(tmp_path))
    out = asyncio.run(
        wm.resolve_metric(
            db_session, "workspace_file", {"workspace_id": ws_id, "path": "nope.json"}
        )
    )
    assert out == {}


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


def test_task_execution_trend(db_session):
    from src.core.cst import cst_now
    from src.models.task_execution_log import TaskExecutionLog

    now = cst_now()
    for st in ["success", "success", "failed"]:
        db_session.add(
            TaskExecutionLog(
                workspace_id=1,
                employee_id=1,
                task_name_snapshot="t",
                run_status=st,
                started_at=now,
            )
        )
    db_session.commit()
    out = asyncio.run(wm.resolve_metric(db_session, "task_execution_trend", {"workspace_id": 1}))
    assert out["xKey"] == "date"
    assert len(out["rows"]) == 7
    series_keys = {s["key"] for s in out["series"]}
    assert "success" in series_keys
    assert "failed" in series_keys
    # Today is the last row (index 6)
    today_row = out["rows"][-1]
    assert today_row["success"] == 2
    assert today_row["failed"] == 1


def test_task_status_distribution(db_session):
    from src.core.cst import cst_now
    from src.models.task_execution_log import TaskExecutionLog

    now = cst_now()
    for st in ["success", "success", "failed"]:
        db_session.add(
            TaskExecutionLog(
                workspace_id=1,
                employee_id=1,
                task_name_snapshot="t",
                run_status=st,
                started_at=now,
            )
        )
    db_session.commit()
    out = asyncio.run(wm.resolve_metric(db_session, "task_status_distribution", {"workspace_id": 1}))
    by_name = {it["name"]: it["value"] for it in out["items"]}
    assert by_name["成功"] == 2
    assert by_name["失败"] == 1


def test_plan_status_distribution(db_session):
    from src.models.orchestration_plan import OrchestrationPlan

    for st in ["pending", "running", "completed"]:
        db_session.add(
            OrchestrationPlan(workspace_id=1, conversation_id=1, user_input="x", status=st)
        )
    db_session.commit()
    out = asyncio.run(wm.resolve_metric(db_session, "plan_status_distribution", {"workspace_id": 1}))
    by_name = {it["name"]: it["value"] for it in out["items"]}
    assert by_name["待确认"] == 1
    assert by_name["进行中"] == 1
    assert by_name["已完成"] == 1
