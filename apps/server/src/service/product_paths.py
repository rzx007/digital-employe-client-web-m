from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.service.agent.workspace_paths import resolve_workspace_product_root


def resolve_conversation_product_root(db: Session, conversation: Conversation) -> Path:
    """会话→其所钉项目→产物根。SP1 保证 conversation.workspace_id 必有。"""
    ws = db.get(Workspace, conversation.workspace_id)
    return resolve_workspace_product_root(ws.root_path)
