from src.models.conversation import Conversation, ConversationMessage
from src.models.channel_inbox import ChannelInbox
from src.models.plan_run import PlanRun
from src.service.channel.report import build_channel_report


def test_pure_reply_report(db_session):
    conv = Conversation(workspace_id=1, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()
    db_session.add(ConversationMessage(conversation_id=conv.id, role="assistant",
                                       content="日报已生成", stream_state="completed"))
    db_session.commit()
    row = ChannelInbox(channel="feishu", external_event_id="e1", external_user_id="ou",
                       external_chat_id="oc", workspace_id=1, conversation_id=conv.id,
                       status="running", text="跑日报")
    db_session.add(row); db_session.commit()
    report = build_channel_report(db_session, row)
    assert "日报已生成" in report


def test_pure_reply_no_assistant_message(db_session):
    conv = Conversation(workspace_id=1, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()
    row = ChannelInbox(channel="feishu", external_event_id="e2", external_user_id="ou",
                       external_chat_id="oc", workspace_id=1, conversation_id=conv.id,
                       status="running", text="问句")
    db_session.add(row); db_session.commit()
    report = build_channel_report(db_session, row)
    assert "无文本回复" in report


def test_orchestration_run_report(db_session):
    conv = Conversation(workspace_id=1, user_id="1", target_type="curator",
                        target_id=0, status="idle")
    db_session.add(conv); db_session.commit()
    run = PlanRun(plan_id=999, workspace_id=1, status="settled",
                  conversation_id=conv.id)
    db_session.add(run); db_session.commit()
    row = ChannelInbox(channel="feishu", external_event_id="e3", external_user_id="ou",
                       external_chat_id="oc", workspace_id=1, conversation_id=conv.id,
                       plan_run_id=run.id, status="running", text="编排任务")
    db_session.add(row); db_session.commit()
    report = build_channel_report(db_session, row)
    # plan 999 无任何子任务 → 无交付物分支
    assert "【执行完成】" in report
    assert "编排任务" in report
    assert "交付物：（无）" in report
