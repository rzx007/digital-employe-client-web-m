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


def _make_conv(db, ws_id, emp_id):
    c = Conversation(workspace_id=ws_id, target_type="employee", target_id=emp_id, title="t")
    db.add(c); db.flush()
    return c.id


def test_redispatch_refuses_when_prereq_not_accepted(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(rework, "_build_employee_agent_for_rework", lambda *a, **k: None)
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, accepted=False)  # A 未接受
    bconv = _make_conv(db_session, ws.id, emp.id)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", conv_id=bconv)
    db_session.commit()
    msg = rework.redispatch_task_in_session(ws.id, B.id, "改B")
    assert "前置" in msg  # gate 拒绝
    db_session.expire_all()
    assert db_session.get(EmployeeTask, B.id).rework_count == 0   # 未消耗
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "success"  # 未打回


def test_redispatch_invalidates_downstream(db_session, monkeypatch):
    from src.service.agent.orchestrator import rework
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(rework, "_build_employee_agent_for_rework", lambda *a, **k: None)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    aconv = _make_conv(db_session, ws.id, emp.id)
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True, conv_id=aconv)
    bconv = _make_conv(db_session, ws.id, emp.id)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True, conv_id=bconv)
    db_session.commit()
    msg = rework.redispatch_task_in_session(ws.id, A.id, "改A")  # 返工根任务 A → 打回A + 作废下游B
    assert "返工" in msg or "打回" in msg
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"  # B 被作废


def test_ordering_A_then_B(db_session, monkeypatch):
    """先返工A:作废B;再返工B → gate 拒(A不再接受)。"""
    from src.service.agent.orchestrator import rework
    from src.service.agent.orchestrator import dependency_scheduler as ds
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(rework, "_build_employee_agent_for_rework", lambda *a, **k: None)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    aconv = _make_conv(db_session, ws.id, emp.id)
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True, conv_id=aconv)
    bconv = _make_conv(db_session, ws.id, emp.id)
    bl = _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True, conv_id=bconv)
    db_session.commit()
    rework.redispatch_task_in_session(ws.id, A.id, "改A")          # 返工A → 打回A + 作废B
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, bl.id).run_status == "superseded"
    msg_b = rework.redispatch_task_in_session(ws.id, B.id, "改B")  # 再返工B → A不再接受 → gate 拒
    assert "前置" in msg_b


def test_ordering_B_then_A_cancels_inflight(db_session, monkeypatch):
    """先返工B(A仍接受,gate过,B起返工queued);再返工A → 作废闭包含B的在飞返工 → superseded + cancel。"""
    from sqlalchemy import select as _select
    from src.service.agent.orchestrator import rework
    from src.service.agent.orchestrator import dependency_scheduler as ds
    from src.service.chat_service import ChatService
    monkeypatch.setattr(rework, "_new_session", lambda: _NoCloseSession(db_session))
    monkeypatch.setattr(rework, "_schedule_employee_rework_stream", lambda **k: None)
    monkeypatch.setattr(rework, "_build_employee_agent_for_rework", lambda *a, **k: None)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: _NoCloseSession(db_session)))
    cancelled = []
    monkeypatch.setattr(ChatService, "cancel_conversation_stream",
                        staticmethod(lambda cid: cancelled.append(cid) or True))
    ws, emp, plan, A, B = _seed_plan_AB(db_session)
    aconv = _make_conv(db_session, ws.id, emp.id)
    _seed_log(db_session, task=A, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True, conv_id=aconv)
    bconv = _make_conv(db_session, ws.id, emp.id)
    _seed_log(db_session, task=B, ws_id=ws.id, emp_id=emp.id, run_status="success", accepted=True, conv_id=bconv)
    db_session.commit()
    # 先返工 B(A 仍接受 → gate 过)→ B 起返工(新 queued log,conversation_id=bconv)
    rework.redispatch_task_in_session(ws.id, B.id, "改B")
    # 再返工 A → 作废 B 的下游闭包中含 B 自己的在飞返工 → 取消 + superseded
    rework.redispatch_task_in_session(ws.id, A.id, "改A")
    db_session.expire_all()
    latest_b = db_session.scalars(
        _select(TaskExecutionLog).where(TaskExecutionLog.task_id == B.id).order_by(TaskExecutionLog.id.desc())
    ).first()
    assert latest_b.run_status == "superseded"   # B 的在飞返工被作废
    assert bconv in cancelled                      # 取消了 B 的在飞返工流
