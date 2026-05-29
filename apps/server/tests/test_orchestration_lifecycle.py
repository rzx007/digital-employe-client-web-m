"""编排计划取消与任务删除生命周期。"""

from __future__ import annotations

from src.models.conversation import Conversation
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from src.service.agent.orchestrator.task_mutations import _delete_task_with_fresh_session
from src.service.orchestration_lifecycle import cancel_orchestration_plan
from tests.conftest import add_employee
from tests.test_task_mutations import add_task


def _add_plan(db, workspace_id: int, *, status: str = "confirmed") -> OrchestrationPlan:
    conv = Conversation(
        workspace_id=workspace_id,
        target_type="curator",
        target_id=1,
        title="总管",
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)

    plan = OrchestrationPlan(
        workspace_id=workspace_id,
        conversation_id=conv.id,
        user_input="test plan",
        plan_json="[]",
        status=status,
        total_tasks=1,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def test_delete_task_cancels_running_execution(
    db_session, workspace, patched_task_mutations_db, monkeypatch
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    task = add_task(db_session, workspace.id, employee.id, task_name="运行中任务")
    task_id = task.id

    conv = Conversation(
        workspace_id=workspace.id,
        target_type="employee",
        target_id=employee.id,
        title="执行会话",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)

    log = TaskExecutionLog(
        task_id=task_id,
        workspace_id=workspace.id,
        employee_id=employee.id,
        conversation_id=conv.id,
        task_name_snapshot=task.task_name,
        run_status="running",
        started_at=cst_now(),
    )
    db_session.add(log)
    db_session.commit()

    cancelled_convs: list[int] = []

    def _fake_cancel(conversation_id: int) -> bool:
        cancelled_convs.append(conversation_id)
        return True

    monkeypatch.setattr(
        "src.service.chat_service.ChatService.cancel_conversation_stream",
        _fake_cancel,
    )

    result = _delete_task_with_fresh_session(workspace.id, task_id)

    assert result.get("error") is None
    assert cancelled_convs == [conv.id]

    db_session.expire_all()
    refreshed_log = db_session.get(TaskExecutionLog, log.id)
    assert refreshed_log is not None
    assert refreshed_log.run_status == "cancelled"
    assert refreshed_log.run_result == "任务已删除，执行已取消"
    assert db_session.get(EmployeeTask, task_id) is None


def test_delete_last_plan_task_cancels_plan(
    db_session, workspace, patched_task_mutations_db
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    plan = _add_plan(db_session, workspace.id, status="confirmed")
    task = add_task(db_session, workspace.id, employee.id, task_name="计划子任务")
    task.orchestration_plan_id = plan.id
    db_session.commit()

    result = _delete_task_with_fresh_session(workspace.id, task.id)
    assert result.get("error") is None

    db_session.expire_all()
    refreshed_plan = db_session.get(OrchestrationPlan, plan.id)
    assert refreshed_plan is not None
    assert refreshed_plan.status == "cancelled"


def test_cancel_plan_deactivates_tasks_and_reloads_scheduler(
    db_session, workspace, monkeypatch
):
    employee = add_employee(db_session, workspace.id, name="执行员工")
    plan = _add_plan(db_session, workspace.id, status="confirmed")

    task_a = add_task(
        db_session,
        workspace.id,
        employee.id,
        task_name="定时A",
        cron="0 9 * * *",
    )
    task_b = add_task(db_session, workspace.id, employee.id, task_name="即时B")
    task_a.orchestration_plan_id = plan.id
    task_b.orchestration_plan_id = plan.id
    db_session.commit()

    reload_calls: list[int] = []
    monkeypatch.setattr(
        "src.service.task_scheduler_service.TaskSchedulerService.reload_jobs",
        lambda: reload_calls.append(1),
    )
    monkeypatch.setattr(
        "src.service.chat_service.ChatService.cancel_conversation_stream",
        lambda _cid: True,
    )

    err = cancel_orchestration_plan(db_session, plan.id)
    assert err is None
    assert len(reload_calls) == 1

    db_session.expire_all()
    refreshed_plan = db_session.get(OrchestrationPlan, plan.id)
    assert refreshed_plan is not None
    assert refreshed_plan.status == "cancelled"

    for task_id in (task_a.id, task_b.id):
        refreshed = db_session.get(EmployeeTask, task_id)
        assert refreshed is not None
        assert refreshed.is_active is False
