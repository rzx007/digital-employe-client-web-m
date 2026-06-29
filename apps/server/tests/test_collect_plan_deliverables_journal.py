"""Task 6 — collect_plan_deliverables 改读 file_outputs ∩ 文件系统交集。

来源：各子任务执行日志会话的 assistant 消息 extra_meta.file_outputs（Task 5 写入，
path 为 resolve 绝对 posix）。聚合后与 ResourceService 扫描出的 artifacts/skills_draft
实际磁盘文件求交集——只保留磁盘上仍存在的（删除/空文件自然落选）。
"""
from __future__ import annotations

import json
import tempfile
from datetime import datetime
from pathlib import Path

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import Workspace
from src.service.product_paths import resolve_conversation_product_root


def _mk_ws(db, tmpdir: str) -> Workspace:
    # 外部 flat 工作空间：product_root == root_path，artifacts 落 <root>/artifacts/。
    ws = Workspace(name="w", root_path=tmpdir, user_id="u")
    db.add(ws)
    db.flush()
    return ws


def _mk_plan(db, ws: Workspace) -> OrchestrationPlan:
    # plan.conversation_id 指向一个真实会话，供 product_root 解析。
    plan_conv = Conversation(
        workspace_id=ws.id, target_type="curator", target_id=1, title="plan"
    )
    db.add(plan_conv)
    db.flush()
    plan = OrchestrationPlan(
        workspace_id=ws.id,
        conversation_id=plan_conv.id,
        user_input="x",
        plan_json="[]",
        status="confirmed",
        total_tasks=0,
    )
    db.add(plan)
    db.flush()
    return plan


def _assistant_msg_with_outputs(db, conv_id: int, outputs: list[dict]) -> None:
    db.add(
        ConversationMessage(
            conversation_id=conv_id,
            role="assistant",
            content="",
            extra_meta=json.dumps({"file_outputs": outputs}, ensure_ascii=False),
        )
    )
    db.flush()


def test_collect_intersects_journal_with_filesystem(db_session):
    """file_outputs 列两条，磁盘只放一条 → 只返回存在的那条，action 映射成 created。"""
    from src.service.orchestration_lifecycle import collect_plan_deliverables

    with tempfile.TemporaryDirectory(prefix="de-collect-") as tmpdir:
        ws = _mk_ws(db_session, tmpdir)
        plan = _mk_plan(db_session, ws)

        from src.models.plan_run import PlanRun

        run = PlanRun(
            plan_id=plan.id, workspace_id=ws.id, trigger="scheduled", status="running"
        )
        db_session.add(run)
        db_session.flush()

        task = EmployeeTask(
            workspace_id=ws.id,
            employee_id=1,
            task_name="t1",
            orchestration_plan_id=plan.id,
        )
        db_session.add(task)
        db_session.flush()

        # 员工会话（执行日志指向它）。
        emp_conv = Conversation(
            workspace_id=ws.id, target_type="employee", target_id=1, title="emp"
        )
        db_session.add(emp_conv)
        db_session.flush()

        log = TaskExecutionLog(
            task_id=task.id,
            workspace_id=ws.id,
            employee_id=1,
            conversation_id=emp_conv.id,
            task_name_snapshot="t1",
            run_status="success",
            run_id=run.id,
            started_at=datetime.now(),
        )
        db_session.add(log)
        db_session.flush()

        # product_root 由 plan.conversation 解析（与实现一致）。
        plan_conv = db_session.get(Conversation, plan.conversation_id)
        product_root = resolve_conversation_product_root(db_session, plan_conv)
        artifacts_dir = product_root / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        present = artifacts_dir / "present.md"
        present.write_text("hello", encoding="utf-8")
        present_key = present.resolve().as_posix()
        deleted_key = (artifacts_dir / "deleted.md").resolve().as_posix()

        _assistant_msg_with_outputs(
            db_session,
            emp_conv.id,
            [
                {"path": present_key, "action": "create"},
                {"path": deleted_key, "action": "modify"},
            ],
        )
        db_session.commit()

        results = collect_plan_deliverables(db_session, plan.id, run_id=run.id)
        basenames = {r["basename"] for r in results}
        assert basenames == {"present.md"}  # 磁盘不存在的 deleted.md 被过滤
        assert results[0]["action"] == "created"
        assert results[0]["task_id"] == task.id
        assert results[0]["task_name"] == "t1"
        assert results[0]["size"] == len("hello")
        assert results[0]["path"] == present_key


def test_journal_path_hits_filesystem_index(db_session):
    """守住路径坐标系：手放一个文件 → 其 resolve-abs-posix 命中文件系统索引键。"""
    from src.service.orchestration_lifecycle import _filesystem_deliverable_index

    with tempfile.TemporaryDirectory(prefix="de-collect-idx-") as tmpdir:
        product_root = Path(tmpdir)
        artifacts_dir = product_root / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        f = artifacts_dir / "报告.md"
        f.write_text("x", encoding="utf-8")

        index = _filesystem_deliverable_index(product_root)
        assert f.resolve().as_posix() in index


def test_run_id_isolation(db_session):
    """run_id 过滤：run1 的产物不出现在 run2 的收集结果里。"""
    from src.service.orchestration_lifecycle import collect_plan_deliverables
    from src.models.plan_run import PlanRun

    with tempfile.TemporaryDirectory(prefix="de-collect-iso-") as tmpdir:
        ws = _mk_ws(db_session, tmpdir)
        plan = _mk_plan(db_session, ws)

        run1 = PlanRun(
            plan_id=plan.id, workspace_id=ws.id, trigger="scheduled", status="running"
        )
        run2 = PlanRun(
            plan_id=plan.id, workspace_id=ws.id, trigger="scheduled", status="running"
        )
        db_session.add_all([run1, run2])
        db_session.flush()

        task = EmployeeTask(
            workspace_id=ws.id,
            employee_id=1,
            task_name="t1",
            orchestration_plan_id=plan.id,
        )
        db_session.add(task)
        db_session.flush()

        plan_conv = db_session.get(Conversation, plan.conversation_id)
        product_root = resolve_conversation_product_root(db_session, plan_conv)
        artifacts_dir = product_root / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        f1 = artifacts_dir / "run1.txt"
        f1.write_text("a", encoding="utf-8")
        f2 = artifacts_dir / "run2.txt"
        f2.write_text("b", encoding="utf-8")

        # 两轮各一条 log，指向不同会话。
        conv1 = Conversation(
            workspace_id=ws.id, target_type="employee", target_id=1, title="c1"
        )
        conv2 = Conversation(
            workspace_id=ws.id, target_type="employee", target_id=1, title="c2"
        )
        db_session.add_all([conv1, conv2])
        db_session.flush()

        db_session.add_all(
            [
                TaskExecutionLog(
                    task_id=task.id,
                    workspace_id=ws.id,
                    employee_id=1,
                    conversation_id=conv1.id,
                    task_name_snapshot="t1",
                    run_status="success",
                    run_id=run1.id,
                    started_at=datetime.now(),
                ),
                TaskExecutionLog(
                    task_id=task.id,
                    workspace_id=ws.id,
                    employee_id=1,
                    conversation_id=conv2.id,
                    task_name_snapshot="t1",
                    run_status="success",
                    run_id=run2.id,
                    started_at=datetime.now(),
                ),
            ]
        )
        db_session.flush()

        _assistant_msg_with_outputs(
            db_session, conv1.id, [{"path": f1.resolve().as_posix(), "action": "create"}]
        )
        _assistant_msg_with_outputs(
            db_session, conv2.id, [{"path": f2.resolve().as_posix(), "action": "create"}]
        )
        db_session.commit()

        res1 = collect_plan_deliverables(db_session, plan.id, run_id=run1.id)
        assert {r["basename"] for r in res1} == {"run1.txt"}

        res2 = collect_plan_deliverables(db_session, plan.id, run_id=run2.id)
        assert {r["basename"] for r in res2} == {"run2.txt"}
