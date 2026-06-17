import json
from sqlalchemy import select
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.conversation import Conversation
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now


class _NoCloseSession:
    """db_session 透明代理,屏蔽 close()——防自管 session 的函数把 fixture session 关掉。"""
    def __init__(self, real): self._real = real
    def close(self): pass
    def __getattr__(self, name): return getattr(self._real, name)


def _seed_plan_AB(db, *, dep=True):
    """建计划:A(根) → B(依赖A)。返回 (ws, emp, plan, A, B)。dep=False 则 B 无依赖。"""
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db.add(emp); db.flush()
    plan = OrchestrationPlan(workspace_id=ws.id, conversation_id=555, status="confirmed",
                             plan_json="[]", user_input="(test)")  # user_input 非空无默认,必给
    db.add(plan); db.flush()
    A = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="A", orchestration_plan_id=plan.id)
    db.add(A); db.flush()
    B = EmployeeTask(workspace_id=ws.id, employee_id=emp.id, task_name="B", orchestration_plan_id=plan.id)
    db.add(B); db.flush()
    plan.plan_json = json.dumps([{"depends_on": None}, {"depends_on": 0 if dep else None}])
    db.commit()
    return ws, emp, plan, A, B


def _seed_log(db, *, task, ws_id, emp_id, run_status="success", reported=True, accepted=False, conv_id=None):
    log = TaskExecutionLog(
        task_id=task.id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot=task.task_name, run_status=run_status, run_result="r",
        input_json="{}", output_json="{}",
        conversation_id=conv_id, orchestrator_conversation_id=555,
        started_at=cst_now(), ended_at=cst_now(),
        reported_at=cst_now() if reported else None,
        qa_accepted_at=cst_now() if accepted else None,
    )
    db.add(log); db.commit()
    return log


def test_task_prereqs_accepted(db_session):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, accepted=False)
    assert ds.task_prereqs_accepted(db_session, B) is False
    assert ds.task_prereqs_accepted(db_session, A) is True  # 根任务无前置
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, accepted=True)
    assert ds.task_prereqs_accepted(db_session, B) is True


def test_invalidate_downstream_supersedes_delivered(db_session, monkeypatch):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True)
    out = ds.invalidate_downstream(A.id)
    assert out == [B.id]
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"
    sset = ds._log_status_by_task(db_session, [B.id])
    assert ds._already_dispatched(B.id, sset) is False


def test_invalidate_downstream_cancels_inflight(db_session, monkeypatch):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    from src.service.chat_service import ChatService
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    cancelled = []
    monkeypatch.setattr(ChatService, "cancel_conversation_stream", staticmethod(lambda cid: cancelled.append(cid) or True))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="running", reported=False, conv_id=4242)
    out = ds.invalidate_downstream(A.id)
    assert out == [B.id]
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"
    assert cancelled == [4242]


def test_invalidate_downstream_skips_failed(db_session, monkeypatch):
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="failed", reported=False)
    out = ds.invalidate_downstream(A.id)
    assert out == []
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "failed"
