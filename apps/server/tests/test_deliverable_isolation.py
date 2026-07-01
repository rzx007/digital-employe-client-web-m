"""Bug 3 — 定时轮交付物按 PlanRun 隔离（session_flags 补 run_id + collect 按 run 过滤）。

Task 6 后：collect 改读 assistant 消息 extra_meta.file_outputs ∩ 文件系统。本文件的
run_id 隔离语义不变（run A 的产物不出现在 run B），但夹具改走 file_outputs + 真实磁盘文件，
不再 mock tool parts / 存在性过滤。
"""
from __future__ import annotations

import json

from datetime import datetime

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace
from src.service.agent.orchestrator.plan_run_service import (
    create_scheduled_run_conversation,
    open_plan_run,
)
from src.service.product_paths import resolve_conversation_product_root


def _mk_plan(db_session, root_path: str = "/tmp/w"):
    ws = Workspace(name="w", root_path=root_path, user_id="u")
    db_session.add(ws)
    db_session.flush()
    cur = Employee(
        workspace_id=ws.id, name="总管", employee_code="c", is_curator=True
    )
    db_session.add(cur)
    db_session.flush()
    # plan.conversation_id 指向真实会话，供 product_root 解析。
    plan_conv = Conversation(
        workspace_id=ws.id, target_type="curator", target_id=cur.id, title="plan"
    )
    db_session.add(plan_conv)
    db_session.flush()
    plan = OrchestrationPlan(
        workspace_id=ws.id,
        conversation_id=plan_conv.id,
        user_input="x",
        plan_json="[]",
        status="confirmed",
        total_tasks=0,
    )
    db_session.add(plan)
    db_session.flush()
    return ws, plan


def _emp_conv(db_session, ws_id: int) -> int:
    c = Conversation(
        workspace_id=ws_id, target_type="employee", target_id=1, title="emp"
    )
    db_session.add(c)
    db_session.flush()
    return c.id


def _write_artifact_and_journal(db_session, plan, conv_id: int, name: str) -> str:
    """在 plan 项目的 artifacts/ 下真实落一个文件，并把其 resolve-abs-posix 写进
    该会话 assistant 消息的 extra_meta.file_outputs。返回 resolve-abs-posix 路径。
    """
    plan_conv = db_session.get(Conversation, plan.conversation_id)
    product_root = resolve_conversation_product_root(db_session, plan_conv)
    artifacts_dir = product_root / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    f = artifacts_dir / name
    f.write_text("x", encoding="utf-8")
    key = f.resolve().as_posix()
    db_session.add(
        ConversationMessage(
            conversation_id=conv_id,
            role="assistant",
            content="",
            extra_meta=json.dumps(
                {"file_outputs": [{"path": key, "action": "create"}]},
                ensure_ascii=False,
            ),
        )
    )
    db_session.flush()
    return key


def test_session_flags_has_run_id(db_session):
    ws, plan = _mk_plan(db_session)
    run = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    db_session.commit()
    cid = create_scheduled_run_conversation(db_session, plan, run)
    db_session.commit()
    flags = json.loads(db_session.get(Conversation, cid).session_flags or "{}")
    assert flags["run_id"] == run.id


def test_collect_deliverables_filtered_by_run(db_session, tmp_path):
    """run_id 过滤：只返该轮子任务执行日志会话的产物（走 file_outputs ∩ 文件系统）。"""
    from src.service.orchestration_lifecycle import collect_plan_deliverables

    ws, plan = _mk_plan(db_session, root_path=str(tmp_path))

    # 一个子任务，两轮 run、每轮一条 log（不同 conversation_id + run_id）。
    run1 = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    run2 = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    db_session.flush()

    task = EmployeeTask(
        workspace_id=ws.id,
        employee_id=1,
        task_name="t1",
        orchestration_plan_id=plan.id,
    )
    db_session.add(task)
    db_session.flush()

    conv1 = _emp_conv(db_session, ws.id)
    conv2 = _emp_conv(db_session, ws.id)

    log1 = TaskExecutionLog(
        task_id=task.id,
        workspace_id=ws.id,
        employee_id=1,
        conversation_id=conv1,
        task_name_snapshot="t1",
        run_status="success",
        run_id=run1.id,
        started_at=datetime.now(),
    )
    log2 = TaskExecutionLog(
        task_id=task.id,
        workspace_id=ws.id,
        employee_id=1,
        conversation_id=conv2,
        task_name_snapshot="t1",
        run_status="success",
        run_id=run2.id,
        started_at=datetime.now(),
    )
    db_session.add_all([log1, log2])
    db_session.flush()

    key1 = _write_artifact_and_journal(db_session, plan, conv1, "run1.txt")
    key2 = _write_artifact_and_journal(db_session, plan, conv2, "run2.txt")
    db_session.commit()

    # run1 过滤：只应有 run1 的产物。
    res1 = collect_plan_deliverables(db_session, plan.id, run_id=run1.id)
    assert {d["path"] for d in res1} == {key1}

    # run2 过滤：只应有 run2 的产物。
    res2 = collect_plan_deliverables(db_session, plan.id, run_id=run2.id)
    assert {d["path"] for d in res2} == {key2}

    # 无 run_id：取最新一条 log 的会话 → run2。
    res_all = collect_plan_deliverables(db_session, plan.id)
    assert {d["path"] for d in res_all} == {key2}


def test_resolve_run_id_for_conversation(db_session):
    from src.service.orchestration_lifecycle import resolve_run_id_for_conversation

    ws, plan = _mk_plan(db_session)
    run = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    db_session.flush()
    run.conversation_id = 555
    db_session.commit()

    assert resolve_run_id_for_conversation(db_session, plan.id, 555) == run.id
    assert resolve_run_id_for_conversation(db_session, plan.id, 999) is None


def test_get_plan_filters_artifacts_by_conversation(db_session, tmp_path):
    """get_plan?conversation_id= → 按该会话所属 run 过滤交付物；
    非任何 run 的会话 → 空；不传 → 全 plan（向后兼容）。走 file_outputs ∩ 文件系统。
    """
    from src.api.orchestration_api import get_plan

    ws, plan = _mk_plan(db_session, root_path=str(tmp_path))

    # 一轮 scheduled（专属会话 201），一轮 manual（共用 plan.conversation_id）。
    sched = open_plan_run(
        db_session, plan.id, ws.id, trigger="scheduled", auto_accept=True
    )
    manual = open_plan_run(
        db_session, plan.id, ws.id, trigger="manual", auto_accept=True
    )
    db_session.flush()
    sched.conversation_id = 201
    manual.conversation_id = plan.conversation_id
    db_session.flush()

    task = EmployeeTask(
        workspace_id=ws.id,
        employee_id=1,
        task_name="t1",
        orchestration_plan_id=plan.id,
    )
    db_session.add(task)
    db_session.flush()

    conv_sched = _emp_conv(db_session, ws.id)
    conv_manual = _emp_conv(db_session, ws.id)

    log_sched = TaskExecutionLog(
        task_id=task.id,
        workspace_id=ws.id,
        employee_id=1,
        conversation_id=conv_sched,
        task_name_snapshot="t1",
        run_status="success",
        run_id=sched.id,
        started_at=datetime.now(),
    )
    log_manual = TaskExecutionLog(
        task_id=task.id,
        workspace_id=ws.id,
        employee_id=1,
        conversation_id=conv_manual,
        task_name_snapshot="t1",
        run_status="success",
        run_id=manual.id,
        started_at=datetime.now(),
    )
    db_session.add_all([log_sched, log_manual])
    db_session.flush()

    key_sched = _write_artifact_and_journal(db_session, plan, conv_sched, "sched.txt")
    key_manual = _write_artifact_and_journal(
        db_session, plan, conv_manual, "manual.txt"
    )
    db_session.commit()

    # scheduled per-run 会话 → 只该轮产物。
    resp = get_plan(plan.id, conversation_id=201, db=db_session)
    assert {a.path for a in resp.data.artifacts} == {key_sched}

    # 非任何 run 的会话 → 空（不退化成全 plan）。
    resp_none = get_plan(plan.id, conversation_id=99999, db=db_session)
    assert resp_none.data.artifacts == []

    # 不传 conversation_id → 全 plan（最新 log 的会话 → manual）。
    resp_all = get_plan(plan.id, conversation_id=None, db=db_session)
    assert {a.path for a in resp_all.data.artifacts} == {key_manual}
