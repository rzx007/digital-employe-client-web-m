"""完成驱动 DAG：失败传播（fail-fast 级联跳过）。

验证 HIGH-2 修复：
- 前置失败 → 直接/传递依赖它的下游被标 skipped，不再永久卡死；
- 纯判定函数 _any_prereq_failed / _is_settled 行为正确。
"""

from __future__ import annotations

import json

from sqlalchemy import select

from src.service.agent.orchestrator import dependency_scheduler as ds
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

from tests.conftest import add_employee


# ---------- 纯判定函数 ----------

def test_any_prereq_failed_detects_fail_and_skip() -> None:
    status = {1: {"success"}, 2: {"failed"}, 3: {"skipped"}, 4: {"running"}}
    assert ds._any_prereq_failed([1], status) is False
    assert ds._any_prereq_failed([1, 2], status) is True   # failed
    assert ds._any_prereq_failed([1, 3], status) is True   # skipped 也算失败传播
    assert ds._any_prereq_failed([1, 4], status) is False  # running 不算失败
    assert ds._any_prereq_failed([], status) is False


def test_is_settled() -> None:
    status = {
        1: {"success"}, 2: {"failed"}, 3: {"cancelled"},
        4: {"skipped"}, 5: {"running"}, 6: {"queued"},
    }
    for tid in (1, 2, 3, 4):
        assert ds._is_settled(tid, status) is True
    for tid in (5, 6, 7):
        assert ds._is_settled(tid, status) is False


# ---------- DB 集成：级联跳过 ----------

def _make_plan_with_chain(db, ws_id: int, emp_id: int):
    """建一个 A → B → C 的链式计划（C 依赖 B，B 依赖 A）。"""
    plan = OrchestrationPlan(
        workspace_id=ws_id,
        conversation_id=999,  # 测试库不强制 FK
        user_input="做个东西",
        plan_json=json.dumps(
            [{"depends_on": None}, {"depends_on": 0}, {"depends_on": 1}]
        ),
        status="confirmed",
    )
    db.add(plan)
    db.flush()
    tasks = []
    for name in ("A", "B", "C"):
        t = EmployeeTask(
            workspace_id=ws_id,
            employee_id=emp_id,
            task_name=name,
            orchestration_plan_id=plan.id,
            task_input_json="{}",
            user_prompt=f"do {name}",
            execute_mode="immediate",
        )
        db.add(t)
        db.flush()
        tasks.append(t)
    db.commit()
    return plan, tasks


def _statuses(db, task_id: int) -> set[str]:
    rows = db.scalars(
        select(TaskExecutionLog).where(TaskExecutionLog.task_id == task_id)
    ).all()
    return {r.run_status for r in rows}


def test_failed_prereq_cascades_skip(
    patched_task_mutations_db, db_session, workspace
) -> None:
    emp = add_employee(db_session, workspace.id, name="worker")
    plan, (a, b, c) = _make_plan_with_chain(db_session, workspace.id, emp.id)

    # A 失败
    db_session.add(
        TaskExecutionLog(
            task_id=a.id,
            workspace_id=workspace.id,
            employee_id=emp.id,
            task_name_snapshot="A",
            run_status="failed",
            run_result="boom",
            started_at=cst_now(),
            ended_at=cst_now(),
        )
    )
    db_session.commit()

    # 触发回调（A 终态）
    ds.on_employee_task_completed(a.id, workspace.id)

    # B、C 应被级联跳过（C 是传递依赖）
    sess = patched_task_mutations_db()
    try:
        assert "skipped" in _statuses(sess, b.id), "B 应被跳过"
        assert "skipped" in _statuses(sess, c.id), "C 应被传递跳过"
    finally:
        sess.close()


def test_success_does_not_skip(
    patched_task_mutations_db, db_session, workspace, monkeypatch
) -> None:
    """A 成功时不应跳过任何任务（仅验证不误伤；不实际派发）。"""
    emp = add_employee(db_session, workspace.id, name="worker2")
    plan, (a, b, c) = _make_plan_with_chain(db_session, workspace.id, emp.id)

    db_session.add(
        TaskExecutionLog(
            task_id=a.id,
            workspace_id=workspace.id,
            employee_id=emp.id,
            task_name_snapshot="A",
            run_status="success",
            run_result="ok",
            output_json=json.dumps({"content": "done"}),
            started_at=cst_now(),
            ended_at=cst_now(),
        )
    )
    db_session.commit()

    # 让派发成为 no-op（避免真起流）：B 派发时容量不足 → defer
    monkeypatch.setattr(
        "src.service.agent.orchestrator.runtime.can_assign_to_employee",
        lambda db, emp_id: False,
    )

    ds.on_employee_task_completed(a.id, workspace.id)

    sess = patched_task_mutations_db()
    try:
        for tid in (b.id, c.id):
            assert "skipped" not in _statuses(sess, tid)
    finally:
        sess.close()


def test_successor_deferred_when_no_stream_slot(
    patched_task_mutations_db, db_session, workspace, monkeypatch
) -> None:
    """槽位满时后继不派发，等下次完成事件再试。"""
    emp = add_employee(db_session, workspace.id, name="worker3")
    plan, (a, b, _) = _make_plan_with_chain(db_session, workspace.id, emp.id)

    db_session.add(
        TaskExecutionLog(
            task_id=a.id,
            workspace_id=workspace.id,
            employee_id=emp.id,
            task_name_snapshot="A",
            run_status="success",
            run_result="ok",
            output_json=json.dumps({"content": "done"}),
            started_at=cst_now(),
            ended_at=cst_now(),
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "src.service.stream_registry.registry.can_admit",
        lambda _cls: False,
    )
    dispatch_calls: list[int] = []
    monkeypatch.setattr(
        ds,
        "_dispatch_successor",
        lambda db, task, employee, ws_id, briefing, **kw: dispatch_calls.append(
            task.id
        ),
    )

    ds.on_employee_task_completed(a.id, workspace.id)

    assert dispatch_calls == []
    sess = patched_task_mutations_db()
    try:
        assert _statuses(sess, b.id) == set()
    finally:
        sess.close()
