def resolve_active_curator_conversation(db):
    """接盘最近活跃的总管会话；无则 ensure 默认工作空间总管会话。返回 Conversation。"""
    from sqlalchemy import select
    from src.models.conversation import Conversation
    conv = db.scalars(
        select(Conversation)
        .where(Conversation.target_type == "curator")
        .order_by(Conversation.updated_at.desc())
    ).first()
    if conv is not None:
        return conv
    from src.service.chat_service import ChatService
    from src.service.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace(db)
    read = ChatService.ensure_curator_conversation(db, ws.user_id, ws.id)
    return db.get(Conversation, read.id)
