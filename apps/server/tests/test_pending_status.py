import json
from src.models.workspace import Workspace
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.conversation import Conversation, ConversationMessage
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now


def _seed_plan_AB(db, *, conv_id=555):
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db.add(emp); db.flush()
    # OrchestrationPlan.conversation_id is non-nullable; create a minimal Conversation row
    conv = Conversation(id=conv_id, workspace_id=ws.id, target_type="employee", target_id=emp.id)
    db.add(conv); db.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=conv_id, status="confirmed",
                             plan_json="[]", user_input="(t)")
    db.add(plan); db.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="热搜聚合", orchestration_plan_id=plan.id)
    db.add(A); db.flush()
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="文档办公", orchestration_plan_id=plan.id)
    db.add(B); db.flush()
    plan.plan_json = json.dumps([{"depends_on": None}, {"depends_on": 0}])  # B 依赖 A
    db.commit()
    return ws, emp, plan, A, B


def _accept_log(db, *, task, ws_id, emp_id):
    log = TaskExecutionLog(
        task_id=task.id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot=task.task_name, run_status="success", run_result="r",
        input_json="{}", output_json="{}", conversation_id=None,
        orchestrator_conversation_id=555, started_at=cst_now(), ended_at=cst_now(),
        reported_at=cst_now(), qa_accepted_at=cst_now(),
    )
    db.add(log); db.commit()
    return log


def test_waiting_status_pending_release(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import waiting_status_for_task
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    _accept_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id)
    assert waiting_status_for_task(db_session, B) == "待放行"


def test_waiting_status_waiting_prereq(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import waiting_status_for_task
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    s = waiting_status_for_task(db_session, B)
    assert s is not None and "等待前置" in s and "热搜聚合" in s


def test_waiting_status_root_and_nonplan(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import waiting_status_for_task
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    assert waiting_status_for_task(db_session, A) == "待派发"
    orphan = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="x", orchestration_plan_id=None)
    db_session.add(orphan); db_session.commit()
    assert waiting_status_for_task(db_session, orphan) is None
