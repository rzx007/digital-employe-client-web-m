"""list_today_tasks 按 plan 聚合的单测。"""
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now
from src.service.agent.orchestrator.plan_run_service import open_plan_run
from src.service.task_service import TaskService


def _seed_plan_two_tasks(db: Session):
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db.add(ws); db.flush()
    plan = OrchestrationPlan(
        workspace_id=ws.id, conversation_id=1, user_input="每2分钟查热搜并总结成文档",
        plan_json='[{"depends_on": null}, {"depends_on": [0]}]', status="confirmed",
        total_tasks=2, cron="*/2 * * * *", is_recurring=True,
    )
    db.add(plan); db.flush()
    emp = Employee(workspace_id=ws.id, name="emp", employee_code="c"); db.add(emp); db.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="获取热搜",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="a")
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="总结成文档",
                     execute_mode="immediate", orchestration_plan_id=plan.id, user_prompt="b")
    db.add_all([A, B]); db.commit()
    return ws, plan, emp, A, B


def _log(db, task, ws_id, emp_id, status, run_id):
    db.add(TaskExecutionLog(
        task_id=task.id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot=task.task_name, run_status=status, run_result="r",
        input_json="{}", output_json="{}", started_at=cst_now(), run_id=run_id,
    ))
    db.commit()


def test_plan_subtasks_fold_into_single_row(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    run.conversation_id = 999; db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "success", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    plan_rows = [i for i in items if i.get("is_plan")]
    assert len(plan_rows) == 1
    row = plan_rows[0]
    assert row["plan_id"] == plan.id
    assert row["run_seq"] == run.run_seq
    assert row["task_name"].startswith("每2分钟查热搜并总结成文档")
    assert row["run_status"] == "success"
    assert row["conversation_id"] == 999
    # 子任务不再单独占行
    sub_rows = [i for i in items if not i.get("is_plan") and i.get("task_id") in (A.id, B.id)]
    assert sub_rows == []


def test_plan_status_running_when_any_subtask_running(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "running", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    plan_rows = [i for i in items if i.get("is_plan")]
    assert plan_rows[0]["run_status"] == "running"


def test_plan_status_failed_priority(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "failed", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    assert [i for i in items if i.get("is_plan")][0]["run_status"] == "failed"


def test_plan_status_cancelled_when_only_cancelled_no_failure(db_session):
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    _log(db_session, B, ws.id, emp.id, "cancelled", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    assert [i for i in items if i.get("is_plan")][0]["run_status"] == "cancelled"


def test_standalone_task_not_affected(db_session):
    """无 orchestration_plan_id 的独立定时任务保持原样、不被聚合。"""
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="emp", employee_code="c"); db_session.add(emp); db_session.flush()
    standalone = EmployeeTask(
        workspace_id=ws.id, employee_id=emp.id, task_name="下班打卡提醒",
        execute_mode="scheduled", cron_expression="30 17 * * *",
        user_prompt="x", is_active=True,
    )
    db_session.add(standalone); db_session.commit()
    _log(db_session, standalone, ws.id, emp.id, "success", run_id=None)
    items = TaskService.list_today_tasks(db_session, ws.id)
    # 一定有这条独立任务、is_plan 不为 True
    found = [i for i in items if i.get("task_id") == standalone.id]
    assert len(found) == 1 and not found[0].get("is_plan")


def test_plan_status_ignores_superseded_uses_latest_per_task(db_session):
    """返工场景：同一子任务 superseded(旧)+success(新) → 取最新 success，不落 pending。"""
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "superseded", run.id)  # A 旧 log 被返工作废
    _log(db_session, A, ws.id, emp.id, "success", run.id)     # A 返工后新 log
    _log(db_session, B, ws.id, emp.id, "success", run.id)
    items = TaskService.list_today_tasks(db_session, ws.id)
    assert [i for i in items if i.get("is_plan")][0]["run_status"] == "success"


def test_plan_row_conversation_id_falls_back_to_plan_when_run_has_none(db_session):
    """latest_run.conversation_id 为空时（老数据/即时计划/未跑过）→ 行 conversation_id 回落 plan.conversation_id。"""
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    plan.conversation_id = 777; db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    # run.conversation_id 故意不设（保持 NULL，模拟老数据/即时计划未写本轮会话）
    db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    row = [i for i in TaskService.list_today_tasks(db_session, ws.id) if i.get("is_plan")][0]
    assert row["conversation_id"] == 777


def test_plan_row_conversation_id_uses_run_conv_when_present(db_session):
    """有本轮专属会话（定时轮）时优先用 run.conversation_id，不回落 plan。"""
    ws, plan, emp, A, B = _seed_plan_two_tasks(db_session)
    plan.conversation_id = 1; db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    run.conversation_id = 555; db_session.commit()
    _log(db_session, A, ws.id, emp.id, "success", run.id)
    row = [i for i in TaskService.list_today_tasks(db_session, ws.id) if i.get("is_plan")][0]
    assert row["conversation_id"] == 555


def test_unfired_recurring_plan_shows_as_pending_row(db_session):
    """确认态、定时(recurring)、今天还没跑过的计划 → 今日面板出现 pending plan 行(planned_at=下次触发)。"""
    from src.models.workspace import Workspace
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=9, user_input="每天10点查热搜",
        plan_json="[]", status="confirmed", total_tasks=1,
        schedule_kind="recurring", cron="0 10 * * *")
    db_session.add(plan); db_session.flush()
    sub = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="查",
        execute_mode="immediate", cron_expression="", orchestration_plan_id=plan.id, user_prompt="x", is_active=True)
    db_session.add(sub); db_session.commit()
    items = TaskService.list_today_tasks(db_session, ws.id)
    rows = [i for i in items if i.get("is_plan") and i.get("plan_id") == plan.id]
    assert len(rows) == 1
    r = rows[0]
    assert r["run_status"] == "pending"
    assert r["task_name"].startswith("每天10点查热搜")
    assert r["conversation_id"] == 9  # 创建源会话，可跳
    assert r["planned_at"] is not None  # 下次触发时间


def test_unfired_once_plan_shows_as_pending_row(db_session):
    from src.models.workspace import Workspace, cst_now
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from datetime import timedelta
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    run_at = cst_now() + timedelta(minutes=5)
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=9, user_input="5分钟后提醒",
        plan_json="[]", status="confirmed", total_tasks=1,
        schedule_kind="once", run_at=run_at)
    db_session.add(plan); db_session.flush()
    sub = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="提醒",
        execute_mode="immediate", cron_expression="", orchestration_plan_id=plan.id, user_prompt="x", is_active=True)
    db_session.add(sub); db_session.commit()
    rows = [i for i in TaskService.list_today_tasks(db_session, ws.id) if i.get("is_plan") and i.get("plan_id") == plan.id]
    assert len(rows) == 1 and rows[0]["run_status"] == "pending" and rows[0]["planned_at"] is not None


def test_fired_plan_not_duplicated_by_pending_scan(db_session):
    """已跑过(有 PlanRun)的定时计划：仍只出现一行(不被 pending 扫描重复)。"""
    from src.models.workspace import Workspace
    from src.models.orchestration_plan import OrchestrationPlan
    from src.models.employee import Employee
    from src.models.employee_task import EmployeeTask
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now
    from src.service.agent.orchestrator.plan_run_service import open_plan_run
    ws = Workspace(name="w", root_path="/tmp/w", user_id="u-ws1"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=9, user_input="每天查",
        plan_json="[]", status="confirmed", total_tasks=1, schedule_kind="recurring", cron="0 10 * * *")
    db_session.add(plan); db_session.flush()
    sub = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="查",
        execute_mode="immediate", cron_expression="", orchestration_plan_id=plan.id, user_prompt="x", is_active=True)
    db_session.add(sub); db_session.commit()
    run = open_plan_run(db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True)
    run.conversation_id = 9; db_session.commit()
    db_session.add(TaskExecutionLog(task_id=sub.id, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="查", run_status="success", run_result="r", input_json="{}", output_json="{}",
        started_at=cst_now(), run_id=run.id)); db_session.commit()
    rows = [i for i in TaskService.list_today_tasks(db_session, ws.id) if i.get("is_plan") and i.get("plan_id") == plan.id]
    assert len(rows) == 1 and rows[0]["run_status"] == "success"  # 跑过的取最新轮状态，不重复
