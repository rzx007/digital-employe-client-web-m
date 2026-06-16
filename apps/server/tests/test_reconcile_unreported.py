"""test_reconcile_unreported.py

验证 reconcile_unreported_tasks 正确筛选出：
  - 终态(run_status in _SETTLED_STATES) 且 reported_at IS NULL 的 TaskExecutionLog
  - 属于某个 orchestrator_conversation_id（非空）
并去重返回 conv id 列表；不含纯 running / 已 reported 的会话。
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.models.conversation import Conversation
from src.models.employee import Employee
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace
from src.service.agent.orchestrator.dependency_scheduler import _SETTLED_STATES
from src.service.agent.orchestrator.report_debouncer import reconcile_unreported_tasks
from tests.conftest import add_employee


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_log(
    db,
    *,
    workspace_id: int,
    employee_id: int,
    orchestrator_conversation_id: int | None,
    run_status: str,
    reported_at: datetime | None = None,
) -> TaskExecutionLog:
    log = TaskExecutionLog(
        workspace_id=workspace_id,
        employee_id=employee_id,
        orchestrator_conversation_id=orchestrator_conversation_id,
        task_name_snapshot="test-task",
        run_status=run_status,
        reported_at=reported_at,
        started_at=datetime.now(timezone.utc),
        input_json="{}",
        output_json="{}",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def setup(db_session, workspace):
    """种一个 curator 会话 + 多条 log，返回 (curator_conv_id, db_session)。"""
    curator_emp = add_employee(db_session, workspace.id, name="总管", is_curator=True)

    # curator 对话
    orch_conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=curator_emp.id,
        title="总管会话",
    )
    db_session.add(orch_conv)
    db_session.commit()
    db_session.refresh(orch_conv)
    orch_conv_id = orch_conv.id

    # 员工（执行者）
    emp = add_employee(db_session, workspace.id, name="执行员工")

    # 终态 + reported_at NULL → 应被选中（两条同会话 → 去重后仍只 1 个 conv）
    settled_state = next(s for s in _SETTLED_STATES)  # 取第一个终态（"completed" / "success"）
    _make_log(db_session, workspace_id=workspace.id, employee_id=emp.id,
              orchestrator_conversation_id=orch_conv_id,
              run_status=settled_state, reported_at=None)
    _make_log(db_session, workspace_id=workspace.id, employee_id=emp.id,
              orchestrator_conversation_id=orch_conv_id,
              run_status=settled_state, reported_at=None)

    # 终态 + reported_at 非空 → 已汇报，不应出现
    _make_log(db_session, workspace_id=workspace.id, employee_id=emp.id,
              orchestrator_conversation_id=orch_conv_id,
              run_status=settled_state,
              reported_at=datetime.now(timezone.utc))

    # 非终态（running） + reported_at NULL → 不应出现
    _make_log(db_session, workspace_id=workspace.id, employee_id=emp.id,
              orchestrator_conversation_id=orch_conv_id,
              run_status="running", reported_at=None)

    return orch_conv_id, db_session


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_reconcile_returns_pending_conv_id(setup):
    orch_conv_id, db = setup
    result = reconcile_unreported_tasks(db)

    # 应含该总管会话
    assert orch_conv_id in result


def test_reconcile_deduplicates(setup):
    orch_conv_id, db = setup
    result = reconcile_unreported_tasks(db)

    # 两条终态 NULL log 属于同一会话 → 去重后只出现一次
    assert result.count(orch_conv_id) == 1


def test_reconcile_excludes_already_reported(db_session, workspace):
    """已 reported 的 log 对应会话不应出现在结果里（仅有 reported log 时）。"""
    emp = add_employee(db_session, workspace.id, name="员工A")
    orch_conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=emp.id,
        title="已汇报会话",
    )
    db_session.add(orch_conv)
    db_session.commit()
    db_session.refresh(orch_conv)

    settled_state = next(s for s in _SETTLED_STATES)
    _make_log(db_session, workspace_id=workspace.id, employee_id=emp.id,
              orchestrator_conversation_id=orch_conv.id,
              run_status=settled_state,
              reported_at=datetime.now(timezone.utc))  # 已报

    result = reconcile_unreported_tasks(db_session)
    assert orch_conv.id not in result


def test_reconcile_excludes_running_logs(db_session, workspace):
    """running 状态的 log 即便 reported_at NULL，也不应出现。"""
    emp = add_employee(db_session, workspace.id, name="员工B")
    orch_conv = Conversation(
        workspace_id=workspace.id,
        target_type="curator",
        target_id=emp.id,
        title="运行中会话",
    )
    db_session.add(orch_conv)
    db_session.commit()
    db_session.refresh(orch_conv)

    _make_log(db_session, workspace_id=workspace.id, employee_id=emp.id,
              orchestrator_conversation_id=orch_conv.id,
              run_status="running", reported_at=None)

    result = reconcile_unreported_tasks(db_session)
    assert orch_conv.id not in result


def test_reconcile_excludes_null_orch_conv(db_session, workspace):
    """orchestrator_conversation_id 为 NULL 的 log 不应出现（不关联总管会话）。"""
    emp = add_employee(db_session, workspace.id, name="员工C")
    settled_state = next(s for s in _SETTLED_STATES)
    _make_log(db_session, workspace_id=workspace.id, employee_id=emp.id,
              orchestrator_conversation_id=None,
              run_status=settled_state, reported_at=None)

    result = reconcile_unreported_tasks(db_session)
    # None 不应出现在结果里
    assert None not in result
    assert len(result) == 0
