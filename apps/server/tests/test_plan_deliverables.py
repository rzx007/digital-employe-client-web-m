"""团队交付物聚合：从各子任务员工会话的 file_outputs ∩ 文件系统归属产物文件。

Task 6 后：collect_plan_deliverables 改读 assistant 消息 extra_meta.file_outputs
（Task 5 写入，path 为 resolve 绝对 posix），再与 ResourceService 扫出的实际磁盘文件
求交集——只保留磁盘上仍存在的（删除/空文件/跑完即删的临时脚本自然落选）。
"""
from __future__ import annotations

import json
from pathlib import Path

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now
from src.service.product_paths import resolve_conversation_product_root
from tests.conftest import add_employee


def _conv(db, ws, emp):
    c = Conversation(workspace_id=ws.id, target_type="employee", target_id=emp.id, title="t")
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _mk_plan(db, ws, total_tasks: int):
    # plan.conversation_id 指向真实会话，供 product_root 解析。
    plan_conv = Conversation(
        workspace_id=ws.id, target_type="curator", target_id=1, title="plan"
    )
    db.add(plan_conv)
    db.commit()
    db.refresh(plan_conv)
    plan = OrchestrationPlan(
        workspace_id=ws.id, conversation_id=plan_conv.id, user_input="x",
        plan_json="[]", status="confirmed", total_tasks=total_tasks,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def _artifacts_dir(db, plan) -> Path:
    plan_conv = db.get(Conversation, plan.conversation_id)
    product_root = resolve_conversation_product_root(db, plan_conv)
    d = product_root / "artifacts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _assistant_outputs(db, conv_id, outputs):
    """写一条 assistant 消息，其 extra_meta.file_outputs = outputs（[{path, action}]）。"""
    db.add(ConversationMessage(
        conversation_id=conv_id, role="assistant", content="",
        extra_meta=json.dumps({"file_outputs": outputs}, ensure_ascii=False),
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


def test_collect_plan_deliverables_attributes_and_filters(db_session, workspace):
    """归属 + 文件系统交集：磁盘存在的浮现、不存在的（跑完即删脚本）落选。"""
    from src.service import orchestration_lifecycle as ol

    a = add_employee(db_session, workspace.id, name="甲")
    b = add_employee(db_session, workspace.id, name="乙")
    plan = _mk_plan(db_session, workspace, total_tasks=2)

    art = _artifacts_dir(db_session, plan)
    # 真实落盘：报告.docx（甲）、slides.pptx（乙）。gen.py 是临时脚本，不落盘 → 应落选。
    (art / "报告.docx").write_bytes(b"PK real docx")
    (art / "slides.pptx").write_bytes(b"PK real pptx")
    key_report = (art / "报告.docx").resolve().as_posix()
    key_slides = (art / "slides.pptx").resolve().as_posix()
    key_gen = (art / "gen.py").resolve().as_posix()  # 不落盘

    ca = _conv(db_session, workspace, a)
    cb = _conv(db_session, workspace, b)
    ta = _task_with_log(db_session, workspace, plan, a, ca)
    tb = _task_with_log(db_session, workspace, plan, b, cb)

    # 甲：报告.docx（create）+ gen.py（create，但磁盘已删）
    _assistant_outputs(db_session, ca.id, [
        {"path": key_report, "action": "create"},
        {"path": key_gen, "action": "create"},
    ])
    # 乙：slides.pptx（create），再来一条 modify（同 path 合并、create 不被降级）
    _assistant_outputs(db_session, cb.id, [
        {"path": key_slides, "action": "create"},
    ])
    _assistant_outputs(db_session, cb.id, [
        {"path": key_slides, "action": "modify"},
    ])

    out = ol.collect_plan_deliverables(db_session, plan.id)
    bn = [d["basename"] for d in out]
    assert "报告.docx" in bn
    assert "slides.pptx" in bn
    assert "gen.py" not in bn          # 临时脚本磁盘不存在 → 交集落选
    assert bn.count("slides.pptx") == 1  # 同 path 多次写 → 只一条
    # 归属
    rep = next(d for d in out if d["basename"] == "报告.docx")
    assert rep["task_id"] == ta.id and rep["task_name"] == ta.task_name
    slide = next(d for d in out if d["basename"] == "slides.pptx")
    assert slide["task_id"] == tb.id
    # create 不被后续 modify 降级
    assert slide["action"] == "create"
    # size 取文件系统 entry 大小
    assert rep["size"] == len("PK real docx")
    assert slide["size"] == len("PK real pptx")


def test_collect_plan_deliverables_action_modify(db_session, workspace):
    """仅 modify 过的已有文件：action=modify、size 取磁盘大小。"""
    from src.service import orchestration_lifecycle as ol

    a = add_employee(db_session, workspace.id, name="甲")
    plan = _mk_plan(db_session, workspace, total_tasks=1)
    art = _artifacts_dir(db_session, plan)
    (art / "已有稿.md").write_text("real-content", encoding="utf-8")
    key = (art / "已有稿.md").resolve().as_posix()

    ca = _conv(db_session, workspace, a)
    _task_with_log(db_session, workspace, plan, a, ca)
    _assistant_outputs(db_session, ca.id, [{"path": key, "action": "modify"}])

    out = ol.collect_plan_deliverables(db_session, plan.id)
    assert out and out[0]["basename"] == "已有稿.md"
    assert out[0]["action"] == "modify"
    assert out[0]["size"] == len("real-content")


def test_collect_plan_deliverables_empty_when_no_writes(db_session, workspace):
    from src.service.orchestration_lifecycle import collect_plan_deliverables
    a = add_employee(db_session, workspace.id, name="甲")
    plan = _mk_plan(db_session, workspace, total_tasks=1)
    ca = _conv(db_session, workspace, a)
    _task_with_log(db_session, workspace, plan, a, ca)
    # assistant 消息无 file_outputs → 收不到任何交付物。
    db_session.add(ConversationMessage(
        conversation_id=ca.id, role="assistant", content="",
        extra_meta=json.dumps({"usage": {"t": 1}}, ensure_ascii=False),
    ))
    db_session.commit()
    assert collect_plan_deliverables(db_session, plan.id) == []
