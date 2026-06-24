from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from src.models.channel_inbox import ChannelInbox

_PENDING = ("acked", "running")


def record_event(db, *, channel, external_event_id, external_user_id,
                 external_chat_id, workspace_id, conversation_id, text,
                 status="acked"):
    row = ChannelInbox(channel=channel, external_event_id=external_event_id,
                       external_user_id=external_user_id, external_chat_id=external_chat_id,
                       workspace_id=workspace_id, conversation_id=conversation_id,
                       text=text, status=status)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    db.refresh(row)
    return row


def find_pending_by_conversation(db, conversation_id):
    return db.scalars(
        select(ChannelInbox)
        .where(ChannelInbox.conversation_id == conversation_id,
               ChannelInbox.status.in_(_PENDING))
        .order_by(ChannelInbox.id.desc())
    ).first()


def find_pending_by_plan_run(db, plan_run_id):
    return db.scalars(
        select(ChannelInbox)
        .where(ChannelInbox.plan_run_id == plan_run_id,
               ChannelInbox.status.in_(_PENDING))
        .order_by(ChannelInbox.id.desc())
    ).first()


def mark(db, row, status, *, plan_run_id=None, assistant_message_id=None,
         user_message_id=None, reported=False):
    from src.models.workspace import cst_now
    row.status = status
    if plan_run_id is not None:
        row.plan_run_id = plan_run_id
    if assistant_message_id is not None:
        row.assistant_message_id = assistant_message_id
    if user_message_id is not None:
        row.user_message_id = user_message_id
    if reported:
        row.reported_at = cst_now()
    db.commit()


def list_unsettled(db):
    return list(db.scalars(
        select(ChannelInbox).where(ChannelInbox.status.in_(_PENDING))))
