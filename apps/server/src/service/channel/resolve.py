def resolve_active_curator_conversation(db):
    """接盘最近活跃的总管会话；无则 ensure 默认工作空间总管会话。返回 Conversation。"""
    from sqlalchemy import select
    from src.models.conversation import Conversation
    from src.models.plan_run import PlanRun
    # 排除定时轮(scheduled run)自动新建的临时会话——定时触发会把它顶成"最近活跃"，
    # 不该接飞书指令。子查询过滤掉 NULL，避免 NOT IN (含NULL) 整体返空。
    scheduled_conv_ids = select(PlanRun.conversation_id).where(
        PlanRun.trigger == "scheduled", PlanRun.conversation_id.isnot(None)
    )
    conv = db.scalars(
        select(Conversation)
        .where(
            Conversation.target_type == "curator",
            Conversation.id.notin_(scheduled_conv_ids),
        )
        .order_by(Conversation.updated_at.desc())
    ).first()
    if conv is not None:
        return conv
    from src.service.chat_service import ChatService
    from src.service.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace(db)
    read = ChatService.ensure_curator_conversation(db, ws.user_id, ws.id)
    return db.get(Conversation, read.id)
