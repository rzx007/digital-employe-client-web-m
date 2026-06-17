import json
import pytest
from src.models.workspace import Workspace
from src.models.employee import Employee
from src.models.conversation import Conversation, ConversationMessage
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from src.service.task_service import TaskService


def _seed_conv_with_parts(db, parts_per_msg):
    """parts_per_msg: list of (role, parts_list)。返回 (ws, conv)。"""
    ws = Workspace(name="w", root_path="/tmp/w"); db.add(ws); db.flush()
    conv = Conversation(workspace_id=ws.id, target_type="employee", target_id=1, title="t")
    db.add(conv); db.flush()
    for role, parts in parts_per_msg:
        db.add(ConversationMessage(
            conversation_id=conv.id, role=role, content="",
            message_parts=json.dumps(parts) if parts is not None else None,
            stream_state="completed",
        ))
    db.commit()
    return ws, conv


def test_get_conversation_tool_parts_filters_tool_only(db_session):
    parts1 = [{"type": "text", "text": "hi"}, {"type": "tool-web_search", "toolCallId": "a", "state": "output-available"}]
    parts2 = [{"type": "tool-write_file", "toolCallId": "b", "state": "output-available"}]
    ws, conv = _seed_conv_with_parts(db_session, [("assistant", parts1), ("assistant", parts2)])
    out = TaskService.get_conversation_tool_parts(db_session, conv.id)
    assert [p["type"] for p in out] == ["tool-web_search", "tool-write_file"]


def test_get_conversation_tool_parts_empty_cases(db_session):
    assert TaskService.get_conversation_tool_parts(db_session, None) == []
    ws, conv = _seed_conv_with_parts(db_session, [("user", [{"type": "text", "text": "q"}])])
    assert TaskService.get_conversation_tool_parts(db_session, conv.id) == []


def test_get_execution_tool_footprint_404(db_session):
    from fastapi import HTTPException
    ws = Workspace(name="w", root_path="/tmp/w"); db_session.add(ws); db_session.commit()
    with pytest.raises(HTTPException):
        TaskService.get_execution_tool_footprint(db_session, ws.id, 99999)


def test_get_execution_tool_footprint_returns_parts(db_session):
    parts = [{"type": "tool-read_file", "toolCallId": "c", "state": "output-available"}]
    ws, conv = _seed_conv_with_parts(db_session, [("assistant", parts)])
    emp = Employee(workspace_id=ws.id, name="e", employee_code="c"); db_session.add(emp); db_session.flush()
    log = TaskExecutionLog(
        task_id=1, workspace_id=ws.id, employee_id=emp.id, skill_id=None,
        task_name_snapshot="t", run_status="success", run_result="r",
        input_json="{}", output_json="{}", conversation_id=conv.id,
        started_at=cst_now(),
    )
    db_session.add(log); db_session.commit()
    got = TaskService.get_execution_tool_footprint(db_session, ws.id, log.id)
    assert [p["type"] for p in got] == ["tool-read_file"]
