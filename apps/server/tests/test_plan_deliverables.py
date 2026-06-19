"""团队交付物聚合：从各子任务员工会话的 write_file/edit_file 归属产物文件。"""
from __future__ import annotations

import json

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from tests.conftest import add_employee


def _conv(db, ws, emp):
    c = Conversation(workspace_id=ws.id, target_type="employee", target_id=emp.id, title="t")
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _assistant_parts(db, conv_id, parts):
    db.add(ConversationMessage(
        conversation_id=conv_id, role="assistant", content="",
        message_parts=json.dumps(parts, ensure_ascii=False),
    ))
    db.commit()


def _task_with_log(db, ws, plan, emp, conv):
    t = EmployeeTask(
        workspace_id=ws.id, employee_id=emp.id, employee_name_snapshot=emp.name,
        task_name=f"任务-{emp.name}", dispatch_type="skill", user_prompt="x",
        task_input_json="{}", execute_mode="immediate", source="orchestration",
        orchestration_plan_id=plan.id, is_active=True,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    db.add(TaskExecutionLog(
        task_id=t.id, workspace_id=ws.id, employee_id=emp.id,
        task_name_snapshot=t.task_name, run_status="success",
        input_json="{}", output_json="{}", conversation_id=conv.id,
        started_at=cst_now(), ended_at=cst_now(),
    ))
    db.commit()
    return t


def _wf(file_path):
    return {"type": "tool-write_file", "toolCallId": "x", "state": "output-available",
            "input": {"file_path": file_path, "content": "..."}}


def test_collect_plan_deliverables_attributes_and_filters(db_session, workspace, monkeypatch, tmp_path):
    from src.service import orchestration_lifecycle as ol

    # 产物目录解析定向到 tmp（员工产物落此）；只保留磁盘上真实存在的文件。
    monkeypatch.setattr(ol, "_plan_artifacts_dir", lambda db, plan: tmp_path)
    (tmp_path / "报告.docx").write_bytes(b"PK real docx")
    (tmp_path / "slides.pptx").write_bytes(b"PK real pptx")
    # gen.py 是临时脚本：write 过但跑完已删 → 磁盘不存在（不创建它）

    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan = OrchestrationPlan(
        workspace_id=workspace.id, conversation_id=1, user_input="x",
        plan_json="[]", status="confirmed", total_tasks=2,
    )
    db_session.add(plan)
    db_session.commit()
    db_session.refresh(plan)

    ca = _conv(db_session, workspace, a)
    cb = _conv(db_session, workspace, b)
    ta = _task_with_log(db_session, workspace, plan, a, ca)
    tb = _task_with_log(db_session, workspace, plan, b, cb)

    # 甲：产物 docx + 临时脚本 gen.py(已删) + uploads(桶排除) + web_search(非文件)
    _assistant_parts(db_session, ca.id, [
        _wf("报告.docx"),
        _wf("gen.py"),
        _wf("D:/proj/uploads/原始数据.csv"),
        {"type": "tool-web_search", "toolCallId": "w", "state": "output-available"},
    ])
    # 乙：相对名产物 + 一个 edit_file
    _assistant_parts(db_session, cb.id, [
        _wf("slides.pptx"),
        {"type": "tool-edit_file", "toolCallId": "e", "state": "output-available",
         "input": {"file_path": "slides.pptx", "new_string": "..."}},
    ])

    out = ol.collect_plan_deliverables(db_session, plan.id)
    paths = [d["basename"] for d in out]
    assert "报告.docx" in paths
    assert "slides.pptx" in paths
    assert "gen.py" not in paths  # 临时脚本已删 → 存在性过滤掉
    assert "原始数据.csv" not in paths  # uploads 桶排除
    # 去重：slides.pptx 被 write+edit 两次 → 只一条
    assert paths.count("slides.pptx") == 1
    # 归属
    rep = next(d for d in out if d["basename"] == "报告.docx")
    assert rep["task_id"] == ta.id and rep["task_name"] == ta.task_name
    slide = next(d for d in out if d["basename"] == "slides.pptx")
    assert slide["task_id"] == tb.id


def test_collect_plan_deliverables_empty_when_no_writes(db_session, workspace):
    from src.service.orchestration_lifecycle import collect_plan_deliverables
    a = add_employee(db_session, workspace.id, name="甲")
    plan = OrchestrationPlan(
        workspace_id=workspace.id, conversation_id=1, user_input="x",
        plan_json="[]", status="confirmed", total_tasks=1,
    )
    db_session.add(plan)
    db_session.commit()
    db_session.refresh(plan)
    ca = _conv(db_session, workspace, a)
    _task_with_log(db_session, workspace, plan, a, ca)
    _assistant_parts(db_session, ca.id, [
        {"type": "tool-web_search", "toolCallId": "w", "state": "output-available"},
    ])
    assert collect_plan_deliverables(db_session, plan.id) == []
