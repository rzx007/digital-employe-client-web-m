"""2A：子任务终态写 journal。"""
import json
from pathlib import Path

from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from tests.conftest import add_employee


def _settle_log(db, ws_id, emp_id, *, status="success", task_id=None):
    log = TaskExecutionLog(
        task_id=task_id, workspace_id=ws_id, employee_id=emp_id,
        task_name_snapshot="查询抖音热搜", run_status=status,
        run_result="任务执行成功" if status == "success" else "任务执行失败",
        output_json=json.dumps({"content": "抖音热搜Top10：…"}, ensure_ascii=False),
        error_message=None if status == "success" else "boom",
        started_at=cst_now(), ended_at=cst_now(), duration_ms=12345,
    )
    db.add(log); db.commit(); db.refresh(log)
    return log


def test_capture_journal_entry_appends_jsonl(db_session, workspace, monkeypatch, tmp_path):
    from src.service.learning import journal
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))

    emp = add_employee(db_session, workspace.id, name="调研员")
    log = _settle_log(db_session, workspace.id, emp.id, status="success")

    journal.capture_journal_entry(db_session, log)

    jdir = tmp_path / str(emp.id) / "journal"
    files = list(jdir.glob("*.jsonl"))
    assert len(files) == 1
    lines = files[0].read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["task_name"] == "查询抖音热搜"
    assert entry["status"] == "success"
    assert entry["duration_ms"] == 12345
    assert "抖音热搜" in entry["conclusion"]
    assert entry["error"] is None
    assert entry["employee_id"] == emp.id


def test_capture_journal_entry_failed_records_error(db_session, workspace, monkeypatch, tmp_path):
    from src.service.learning import journal
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))
    emp = add_employee(db_session, workspace.id, name="调研员")
    log = _settle_log(db_session, workspace.id, emp.id, status="failed")
    journal.capture_journal_entry(db_session, log)
    entry = json.loads(
        next((tmp_path / str(emp.id) / "journal").glob("*.jsonl")).read_text("utf-8").strip()
    )
    assert entry["status"] == "failed"
    assert entry["error"] == "boom"


def test_capture_journal_entry_no_employee_noop(db_session, workspace, monkeypatch, tmp_path):
    """employee_id 为 None（孤儿）→ 不写、不抛。"""
    from src.service.learning import journal
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))
    # 直接构造内存对象（不入 DB：employee_id=None 违反 NOT NULL 约束）
    log = TaskExecutionLog(
        task_id=None, workspace_id=workspace.id, employee_id=None,
        task_name_snapshot="x", run_status="success", output_json="{}",
        started_at=cst_now(), ended_at=cst_now(),
    )
    journal.capture_journal_entry(db_session, log)  # 不抛
    assert list(tmp_path.glob("*/journal/*.jsonl")) == []


def test_journal_records_tools_used(db_session, workspace, monkeypatch, tmp_path):
    from src.service.learning import journal
    from src.models.conversation import Conversation, ConversationMessage
    monkeypatch.setattr(journal, "_brain_root_for", lambda eid: tmp_path / str(eid))
    emp = add_employee(db_session, workspace.id, name="调研员")
    conv = Conversation(workspace_id=workspace.id, target_type="employee", target_id=emp.id, title="t")
    db_session.add(conv); db_session.flush()
    msg = ConversationMessage(
        conversation_id=conv.id, role="assistant", content="done",
        message_parts=json.dumps([
            {
                "type": "tool-shell_execute",
                "toolCallId": "call-abc",
                "state": "output-available",
                "input": {"command": "ls"},
                "output": {"status": "success", "text": "ok", "toolName": "shell_execute"},
            },
            {"type": "text", "text": "done", "state": "done"},
        ], ensure_ascii=False),
    )
    db_session.add(msg); db_session.commit()
    log = _settle_log(db_session, workspace.id, emp.id, status="success")
    log.conversation_id = conv.id; db_session.commit(); db_session.refresh(log)

    journal.capture_journal_entry(db_session, log)
    entry = json.loads(
        next((tmp_path / str(emp.id) / "journal").glob("*.jsonl")).read_text("utf-8").strip().splitlines()[-1]
    )
    assert "shell_execute" in entry["tools_used"]


def test_finalize_calls_journal_capture(monkeypatch):
    """挂载点契约：_capture_journal_safe 会调 capture_journal_entry。"""
    import src.service.learning.journal as journal_mod
    calls = []
    monkeypatch.setattr(journal_mod, "capture_journal_entry", lambda db, log: calls.append(log))
    from src.service.stream_registry import _capture_journal_safe
    class _L:
        employee_id = 1
    sentinel = _L()
    _capture_journal_safe(object(), sentinel)
    assert calls == [sentinel]


def test_capture_journal_safe_swallows_errors(monkeypatch):
    """_capture_journal_safe 容错：capture 抛异常也不上抛。"""
    import src.service.learning.journal as journal_mod
    def _boom(db, log):
        raise RuntimeError("boom")
    monkeypatch.setattr(journal_mod, "capture_journal_entry", _boom)
    from src.service.stream_registry import _capture_journal_safe
    _capture_journal_safe(object(), object())  # 不抛即通过
