from src.models.task_execution_log import TaskExecutionLog


def test_execution_log_has_qa_accepted_at_field():
    assert "qa_accepted_at" in TaskExecutionLog.__table__.columns


# ---------------------------------------------------------------------------
# Task 2: 接受谓词 + 派发门槛测试
# ---------------------------------------------------------------------------
from src.models.employee import Employee
from src.models.workspace import Workspace, cst_now


def _seed_log(db, *, task_id, ws_id, emp_id, run_status="success",
              reported=True, accepted=False, orch_conv=999):
    log = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id, skill_id=None,
        task_name_snapshot="t", run_status=run_status, run_result="r",
        input_json="{}", output_json="{}", conversation_id=None,
        orchestrator_conversation_id=orch_conv, started_at=cst_now(),
        ended_at=cst_now(),
        reported_at=cst_now() if reported else None,
        qa_accepted_at=cst_now() if accepted else None,
    )
    db.add(log); db.commit()
    return log


def test_all_prereqs_accepted_pure():
    from src.service.agent.orchestrator.dependency_scheduler import _all_prereqs_accepted
    assert _all_prereqs_accepted([1, 2], {1, 2}) is True
    assert _all_prereqs_accepted([1, 2], {1}) is False
    assert _all_prereqs_accepted([], set()) is True


def test_load_accepted_task_ids_excludes_unaccepted_and_superseded(db_session):
    from src.service.agent.orchestrator.dependency_scheduler import _load_accepted_task_ids
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    _seed_log(db_session, task_id=1, ws_id=ws.id, emp_id=emp.id, accepted=True)
    _seed_log(db_session, task_id=2, ws_id=ws.id, emp_id=emp.id, accepted=False)
    _seed_log(db_session, task_id=3, ws_id=ws.id, emp_id=emp.id, run_status="superseded", accepted=True)
    got = _load_accepted_task_ids(db_session, [1, 2, 3])
    assert got == {1}


# ---------------------------------------------------------------------------
# Task 3: release_accepted_downstream + 幂等 + 过滤
# ---------------------------------------------------------------------------

class _NoCloseSession:
    """db_session 的透明代理，屏蔽 close() 调用——防止 release_accepted_downstream
    的 finally db.close() 把 fixture session 关掉，导致 expire_all 后无法 re-fetch。"""
    def __init__(self, real):
        self._real = real
    def close(self):
        pass  # no-op: 保持 fixture session 存活
    def __getattr__(self, name):
        return getattr(self._real, name)


def test_release_stamps_accepted_and_is_idempotent(db_session, monkeypatch):
    import src.service.agent.orchestrator.dependency_scheduler as ds
    proxy = _NoCloseSession(db_session)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: proxy))
    calls = []
    monkeypatch.setattr(ds, "on_employee_task_completed", lambda tid, wid: calls.append(tid))
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    log = _seed_log(db_session, task_id=1, ws_id=ws.id, emp_id=emp.id, accepted=False, orch_conv=777)
    n = ds.release_accepted_downstream(777)
    assert n == 1
    db_session.expire_all()
    assert db_session.get(TaskExecutionLog, log.id).qa_accepted_at is not None
    assert calls == [1]
    calls.clear()
    assert ds.release_accepted_downstream(777) == 0
    assert calls == []


def test_release_skips_superseded_and_unreported(db_session, monkeypatch):
    import src.service.agent.orchestrator.dependency_scheduler as ds
    proxy = _NoCloseSession(db_session)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: proxy))
    monkeypatch.setattr(ds, "on_employee_task_completed", lambda tid, wid: None)
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    _seed_log(db_session, task_id=1, ws_id=ws.id, emp_id=emp.id, run_status="superseded", orch_conv=888)
    _seed_log(db_session, task_id=2, ws_id=ws.id, emp_id=emp.id, reported=False, orch_conv=888)
    assert ds.release_accepted_downstream(888) == 0


# ---------------------------------------------------------------------------
# Task 5: 情景B 集成回归（上游打回→返工→接受，下游门控至最终接受）
# ---------------------------------------------------------------------------

def test_scenario_b_downstream_gated_until_rework_accepted(db_session, monkeypatch):
    """情景B:上游被打回→返工→接受,下游谓词只在最终接受后翻真;接受的是返工后的 log。"""
    import src.service.agent.orchestrator.dependency_scheduler as ds
    proxy = _NoCloseSession(db_session)
    monkeypatch.setattr(ds, "get_session_local", lambda: (lambda: proxy))
    monkeypatch.setattr(ds, "on_employee_task_completed", lambda tid, wid: None)
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.flush()
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    A, B = 1, 2  # A=热搜(前置), B=Word(下游)

    # ① A 首次 success(已 reported,未接受) → B 还不能派
    l1 = _seed_log(db_session, task_id=A, ws_id=ws.id, emp_id=emp.id, accepted=False, orch_conv=555)
    assert ds._all_prereqs_accepted([A], ds._load_accepted_task_ids(db_session, [A, B])) is False

    # ② 总管打回:l1 superseded,A 返工新 log l2(queued、未 reported)
    l1.run_status = "superseded"; db_session.commit()
    l2 = _seed_log(db_session, task_id=A, ws_id=ws.id, emp_id=emp.id,
                   run_status="queued", reported=False, accepted=False, orch_conv=555)
    # 评审流收尾对账:l1 superseded 排除、l2 未 success/未 reported → 无接受 → B 仍不可派
    assert ds.release_accepted_downstream(555) == 0
    assert ds._all_prereqs_accepted([A], ds._load_accepted_task_ids(db_session, [A, B])) is False

    # ③ A 返工完成:l2 success + reported → 再评审接受 → 放行对账盖 l2.qa_accepted_at
    l2.run_status = "success"; l2.reported_at = cst_now(); db_session.commit()
    assert ds.release_accepted_downstream(555) == 1
    db_session.expire_all()
    # 现在 B 的前置(A)已接受 → 可派；接受的是返工后的 l2，不是被否决的 l1
    assert ds._all_prereqs_accepted([A], ds._load_accepted_task_ids(db_session, [A, B])) is True
    assert db_session.get(TaskExecutionLog, l2.id).qa_accepted_at is not None
    assert db_session.get(TaskExecutionLog, l1.id).qa_accepted_at is None
