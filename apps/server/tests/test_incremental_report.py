"""增量汇报 turn：trigger_incremental_report 单测。

覆盖：
- 两条未汇报 success 日志 → 起流成功、标记 reported_at、brief 含两结果 + 快照段、返回 True；
- 再调一次（已全 reported）→ 无未汇报任务、返回 True 且不重复起流（幂等）；
- request_start 返回 REJECTED（占线）→ reported_at 仍为 NULL、返回 False。
"""

from __future__ import annotations

import json

from src.models.conversation import Conversation
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace, cst_now
from tests.conftest import add_employee


def _make_curator_conversation(db, workspace_id: int) -> Conversation:
    conv = Conversation(
        workspace_id=workspace_id,
        target_type="curator",
        target_id=0,
        title="总管会话",
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def _make_success_log(
    db, workspace_id: int, employee_id: int, conv_id: int, *, task_name: str, content: str
) -> TaskExecutionLog:
    log = TaskExecutionLog(
        workspace_id=workspace_id,
        employee_id=employee_id,
        orchestrator_conversation_id=conv_id,
        conversation_id=conv_id,
        task_name_snapshot=task_name,
        run_status="success",
        output_json=json.dumps({"content": content}),
        input_json="{}",
        started_at=cst_now(),
        ended_at=cst_now(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def _patch_stream(reentry, monkeypatch, db_session, result):
    """拦截起流通路，记录每次起流的 kwargs，并让 request_start 返回指定 result。"""
    started: list[dict] = []

    def _fake_start(**kw):
        started.append(kw)
        return result

    monkeypatch.setattr(reentry, "_start_incremental_stream", _fake_start)
    monkeypatch.setattr(reentry, "_new_session", lambda: db_session)
    monkeypatch.setattr(reentry, "_build_orchestrator_agent", lambda **kw: object())
    return started


def test_incremental_report_starts_turn_and_marks_reported(
    db_session, workspace: Workspace, monkeypatch
):
    from src.service.agent.orchestrator import reentry
    from src.service.agent_stream_queue import StartResult

    emp = add_employee(db_session, workspace.id, name="调研助手")
    conv = _make_curator_conversation(db_session, workspace.id)
    log_a = _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研A", content="A 的结论"
    )
    log_b = _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研B", content="B 的结论"
    )

    started = _patch_stream(reentry, monkeypatch, db_session, StartResult.STARTED)

    ok = reentry.trigger_incremental_report(db_session, conv.id, workspace.id)

    assert ok is True
    # 起了一轮流
    assert len(started) == 1
    assert started[0]["conversation_id"] == conv.id
    # 两任务均被标记 reported_at
    db_session.refresh(log_a)
    db_session.refresh(log_b)
    assert log_a.reported_at is not None
    assert log_b.reported_at is not None
    # brief 含两结果摘要 + 含快照段
    brief = started[0]["messages"][0]["content"]
    assert "调研A" in brief and "A 的结论" in brief
    assert "调研B" in brief and "B 的结论" in brief
    # 快照段（build_delegation_execution_context 的标志性表头）
    assert "执行快照" in brief or "执行 #" in brief


def test_incremental_report_idempotent_no_restream(
    db_session, workspace: Workspace, monkeypatch
):
    from src.service.agent.orchestrator import reentry
    from src.service.agent_stream_queue import StartResult

    emp = add_employee(db_session, workspace.id, name="调研助手")
    conv = _make_curator_conversation(db_session, workspace.id)
    _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研A", content="A 的结论"
    )
    _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研B", content="B 的结论"
    )

    started = _patch_stream(reentry, monkeypatch, db_session, StartResult.STARTED)

    # 第一次：消费两任务，起一轮流
    assert reentry.trigger_incremental_report(db_session, conv.id, workspace.id) is True
    assert len(started) == 1

    # 第二次：已全 reported → 无未汇报任务、返回 True 且不重复起流
    assert reentry.trigger_incremental_report(db_session, conv.id, workspace.id) is True
    assert len(started) == 1  # 未新增起流


def test_incremental_report_pushes_turn_started_event(
    db_session, workspace: Workspace, monkeypatch
):
    """成功起流后必须推 orchestrator_turn_started 事件,让前端 refetch→resume→实时显示。"""
    from src.service.agent.orchestrator import reentry
    from src.service.agent_stream_queue import StartResult
    import src.service.workspace_events as we

    pushes: list[tuple[int, dict]] = []
    monkeypatch.setattr(
        we.WorkspaceEventBus, "push", lambda wid, ev: pushes.append((wid, ev))
    )

    emp = add_employee(db_session, workspace.id, name="调研助手")
    conv = _make_curator_conversation(db_session, workspace.id)
    _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研A", content="A 的结论"
    )
    _patch_stream(reentry, monkeypatch, db_session, StartResult.STARTED)

    assert reentry.trigger_incremental_report(db_session, conv.id, workspace.id) is True
    turn_events = [
        ev for _, ev in pushes if ev.get("type") == "orchestrator_turn_started"
    ]
    assert len(turn_events) == 1
    assert turn_events[0]["orchestrator_conversation_id"] == conv.id


def test_incremental_report_rejected_no_turn_started_event(
    db_session, workspace: Workspace, monkeypatch
):
    """占线被拒(REJECTED)时不该推 orchestrator_turn_started(没起成流)。"""
    from src.service.agent.orchestrator import reentry
    from src.service.agent_stream_queue import StartResult
    import src.service.workspace_events as we

    pushes: list[tuple[int, dict]] = []
    monkeypatch.setattr(
        we.WorkspaceEventBus, "push", lambda wid, ev: pushes.append((wid, ev))
    )

    emp = add_employee(db_session, workspace.id, name="调研助手")
    conv = _make_curator_conversation(db_session, workspace.id)
    _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研A", content="A 的结论"
    )
    _patch_stream(reentry, monkeypatch, db_session, StartResult.REJECTED)

    assert reentry.trigger_incremental_report(db_session, conv.id, workspace.id) is False
    assert not [
        ev for _, ev in pushes if ev.get("type") == "orchestrator_turn_started"
    ]


def test_incremental_report_rejected_keeps_reported_null(
    db_session, workspace: Workspace, monkeypatch
):
    from src.service.agent.orchestrator import reentry
    from src.service.agent_stream_queue import StartResult

    emp = add_employee(db_session, workspace.id, name="调研助手")
    conv = _make_curator_conversation(db_session, workspace.id)
    log_a = _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研A", content="A 的结论"
    )
    log_b = _make_success_log(
        db_session, workspace.id, emp.id, conv.id, task_name="调研B", content="B 的结论"
    )

    started = _patch_stream(reentry, monkeypatch, db_session, StartResult.REJECTED)

    ok = reentry.trigger_incremental_report(db_session, conv.id, workspace.id)

    assert ok is False
    # 起流被尝试过一次（但被拒）
    assert len(started) == 1
    # 两任务 reported_at 仍为 NULL，留待补触发
    db_session.refresh(log_a)
    db_session.refresh(log_b)
    assert log_a.reported_at is None
    assert log_b.reported_at is None
