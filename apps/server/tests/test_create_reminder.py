"""create_reminder：纯提醒型计划（无员工任务），到点把提醒发进会话。"""
from __future__ import annotations

from sqlalchemy import select

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee_task import EmployeeTask
from src.models.orchestration_plan import OrchestrationPlan
from src.service.agent.orchestrator.runtime import set_context
from src.service.agent.orchestrator.tools import create_reminder
from src.service.task_scheduler_service import TaskSchedulerService


def _setup(db_session, workspace) -> Conversation:
    conv = Conversation(
        workspace_id=workspace.id, target_type="curator", target_id=1, title="总管",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)
    set_context(db=db_session, workspace_id=workspace.id, conversation_id=conv.id)
    return conv


def test_create_reminder_makes_reminder_plan_without_employee_tasks(
    db_session, workspace, monkeypatch
):
    _setup(db_session, workspace)
    monkeypatch.setattr(
        TaskSchedulerService, "reload_jobs", classmethod(lambda cls: None)
    )

    # 测试环境无 LLM：parse_schedule 的自然语言归类走 LLM，离线返回 None；
    # 用裸 5 段 cron 走确定性快路（→ recurring），稳定地验证 create_reminder 的 recurring 路径。
    raw = create_reminder.invoke(
        {"message": "该看世界杯了", "schedule": "0 10 * * *"}
    )

    assert "已设定提醒" in raw

    plans = db_session.scalars(
        select(OrchestrationPlan).where(
            OrchestrationPlan.workspace_id == workspace.id
        )
    ).all()
    assert len(plans) == 1
    plan = plans[0]
    assert plan.reminder_message == "该看世界杯了"
    assert plan.schedule_kind == "recurring"
    assert (plan.cron or "").strip()  # 解析出 cron
    assert plan.status == "confirmed"  # 提醒免确认，直接登记调度
    assert plan.total_tasks == 0

    # 纯提醒不创建任何员工任务
    tasks = db_session.scalars(
        select(EmployeeTask).where(EmployeeTask.workspace_id == workspace.id)
    ).all()
    assert tasks == []


def test_deliver_reminder_appends_message_to_conversation(db_session, workspace):
    conv = Conversation(
        workspace_id=workspace.id, target_type="curator", target_id=1, title="总管",
    )
    db_session.add(conv)
    db_session.commit()
    db_session.refresh(conv)

    plan = OrchestrationPlan(
        workspace_id=workspace.id,
        conversation_id=conv.id,
        user_input="定时提醒：开会",
        plan_json="[]",
        status="confirmed",
        total_tasks=0,
        schedule_kind="once",
        reminder_message="该开会了",
    )
    db_session.add(plan)
    db_session.commit()

    TaskSchedulerService._deliver_reminder(db_session, plan)

    msgs = db_session.scalars(
        select(ConversationMessage).where(
            ConversationMessage.conversation_id == conv.id,
            ConversationMessage.role == "assistant",
        )
    ).all()
    assert any("⏰ 该开会了" in (m.content or "") for m in msgs)
