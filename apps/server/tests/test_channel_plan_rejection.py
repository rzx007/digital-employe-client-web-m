"""channel(feishu) 来源遇「需确认」编排计划：直接拒绝（取消计划+回绝语，不留 pending）。

桌面来源（user_chat / 默认）路径必须 100% 不变：需确认仍留 pending。
"""

from __future__ import annotations

import json

import pytest

from src.models.conversation import Conversation
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.service.agent.orchestrator.runtime import (
    reset_context,
    set_context,
    set_orchestrator_source,
)
from src.service.agent.orchestrator.tools import create_orchestration_plan
from tests.conftest import add_employee


def _setup_orch(db_session, workspace):
    emp_a = add_employee(db_session, workspace.id, name="执行员工A")
    emp_b = add_employee(db_session, workspace.id, name="执行员工B")
    conv = Conversation(
        workspace_id=workspace.id, target_type="curator", target_id=1, title="总管",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=conv.id)
    return emp_a, emp_b


@pytest.fixture(autouse=True)
def _clear_source():
    # 每个用例后清掉 source ContextVar，避免跨用例污染（ContextVar 进程级）。
    yield
    set_orchestrator_source(None)


def _multi_task_args(emp_a, emp_b):
    """两个任务（两名不同员工）→ compute_requires_confirmation=True（多任务必确认）。"""
    return {
        "summary": "多任务计划",
        "tasks": [
            {
                "employee_id": emp_a.id,
                "task_name": "任务A",
                "prompt": "做A",
                "output_tier": "standard",
            },
            {
                "employee_id": emp_b.id,
                "task_name": "任务B",
                "prompt": "做B",
                "output_tier": "standard",
            },
        ],
    }


def test_channel_feishu_rejects_confirmation_plan(db_session, workspace, monkeypatch):
    """feishu 来源 + 需确认 → 计划置 cancelled、返回「已拒绝」，不留 pending。"""
    emp_a, emp_b = _setup_orch(db_session, workspace)
    import src.service.agent.orchestrator.tools.plans as plans_mod

    calls: list[int] = []
    monkeypatch.setattr(
        plans_mod, "execute_plan",
        lambda db, plan, workspace_id: calls.append(plan.id) or "X",
    )

    set_orchestrator_source("feishu")
    raw = create_orchestration_plan.invoke(_multi_task_args(emp_a, emp_b))

    payload = json.loads(raw.split("\n", 1)[0])
    assert payload["requires_confirmation"] is True
    # 不执行
    assert calls == []
    # 回绝语
    assert "已拒绝" in raw
    # 计划落 cancelled、不留 pending
    plan = db_session.get(OrchestrationPlan, payload["plan_id"])
    assert plan is not None
    assert plan.status == "cancelled"
    # 拒绝时已建子任务必须全部停用，不留「幽灵子任务」污染任务列表
    child_tasks = (
        db_session.query(EmployeeTask)
        .filter_by(orchestration_plan_id=plan.id)
        .all()
    )
    assert len(child_tasks) > 0
    assert all(t.is_active is False for t in child_tasks)


def test_desktop_source_still_pending(db_session, workspace, monkeypatch):
    """非 channel 来源（默认 None / user_chat）+ 需确认 → 仍留 pending，桌面路径不变。"""
    emp_a, emp_b = _setup_orch(db_session, workspace)
    import src.service.agent.orchestrator.tools.plans as plans_mod

    calls: list[int] = []
    monkeypatch.setattr(
        plans_mod, "execute_plan",
        lambda db, plan, workspace_id: calls.append(plan.id) or "X",
    )

    # source 不设（桌面），等价 None
    raw = create_orchestration_plan.invoke(_multi_task_args(emp_a, emp_b))

    payload = json.loads(raw.split("\n", 1)[0])
    assert payload["requires_confirmation"] is True
    assert calls == []
    assert "已拒绝" not in raw
    assert "卡片上确认" in raw
    plan = db_session.get(OrchestrationPlan, payload["plan_id"])
    assert plan is not None
    assert plan.status == "pending"
