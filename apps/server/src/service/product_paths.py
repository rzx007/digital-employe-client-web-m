from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.service.agent.workspace_paths import APP_PROJECTS_BASE, resolve_workspace_product_root

# 会话所钉项目已删除时的孤儿产物根（读为空，不回退 legacy 全局）。
_ORPHANED_BASE = APP_PROJECTS_BASE.parent / "_orphaned"


def orphan_root_for_conversation(conversation_id: int) -> Path:
    """会话所钉项目已删除时的孤儿产物根（读为空，绝不回退 legacy 全局）。"""
    return _ORPHANED_BASE / f"conv-{conversation_id}"


def orphan_root_for_workspace(workspace_id: int) -> Path:
    """工作空间已删除时的孤儿产物根（读为空，绝不回退 legacy 全局）。"""
    return _ORPHANED_BASE / f"ws-{workspace_id}"


def resolve_conversation_product_root(db: Session, conversation: Conversation) -> Path:
    """会话→其所钉项目→产物根。

    SP1 保证 conversation.workspace_id 非空；但工作空间可能已被删除（会话是用户级、
    删工作空间不删会话），此时 workspace 行不存在 → 返回确定性孤儿目录（读为空）而非崩溃。
    """
    ws = db.get(Workspace, conversation.workspace_id)
    if ws is None:
        return orphan_root_for_conversation(conversation.id)
    return resolve_workspace_product_root(ws.root_path)
