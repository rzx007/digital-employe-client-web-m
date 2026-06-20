from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.service.agent.destructive_hitl import parse_session_flags


def is_outside_workspace(target: str, roots: list[Path]) -> bool:
    """target.resolve() 不在任何 root 之下 → True(越界)。
    resolve 吃掉 ../ 与符号链接，杜绝绕过；用 is_relative_to 避免 foo/foobar 前缀误判。"""
    try:
        t = Path(target).resolve()
    except (OSError, ValueError):
        return True
    for root in roots:
        try:
            if t.is_relative_to(Path(root).resolve()):
                return False
        except (OSError, ValueError):
            continue
    return True


def collect_workspace_roots(root_path: str, skills_root=None, memories_dir=None) -> list[Path]:
    """工作区合法写入根集合(按 spike 结论)。
    Path(root_path) 整根涵盖 artifacts/uploads/skills-draft/每会话目录;
    skills_root、memories_dir 在独立另一棵树,必须显式加入。"""
    roots = [Path(root_path)]
    if skills_root:
        roots.append(Path(skills_root))
    if memories_dir:
        roots.append(Path(memories_dir))
    return roots


# ---------------------------------------------------------------------------
# 会话级工作区外目录写授权辅助
# ---------------------------------------------------------------------------

VALID_MODES = {"ask", "auto", "deny"}


def _save_flags(db: Session, conversation_id: int, flags: dict) -> None:
    """将 flags 写回 Conversation.session_flags 并 commit。"""
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    conv.session_flags = json.dumps(flags, ensure_ascii=False) if flags else None
    db.add(conv)
    db.commit()


def get_external_dir_mode(db: Session, conversation_id: int) -> str:
    """返回会话的外部目录模式：ask(默认)/auto/deny。"""
    conv = db.get(Conversation, conversation_id)
    flags = parse_session_flags(conv.session_flags if conv else None)
    mode = flags.get("external_dir_mode")
    return mode if mode in VALID_MODES else "ask"


def set_external_dir_mode(db: Session, conversation_id: int, mode: str) -> None:
    """设置会话外部目录模式。mode 必须是 ask/auto/deny，否则抛 ValueError。"""
    if mode not in VALID_MODES:
        raise ValueError(f"invalid mode: {mode!r}，合法值：{VALID_MODES}")
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    flags = parse_session_flags(conv.session_flags)
    flags["external_dir_mode"] = mode
    _save_flags(db, conversation_id, flags)


def _add_dir_to_list(db: Session, conversation_id: int, key: str, path: str) -> None:
    """向 session_flags[key]（列表）追加 path，已存在则跳过。"""
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return
    flags = parse_session_flags(conv.session_flags)
    lst: list[str] = flags.get(key, [])
    if path not in lst:
        lst.append(path)
    flags[key] = lst
    _save_flags(db, conversation_id, flags)


def add_session_granted_dir(db: Session, conversation_id: int, path: str) -> None:
    """向本会话永久授权目录列表追加 path。"""
    _add_dir_to_list(db, conversation_id, "granted_dirs", path)


def get_session_granted_dirs(db: Session, conversation_id: int) -> list[str]:
    """返回本会话永久授权目录列表。"""
    conv = db.get(Conversation, conversation_id)
    return parse_session_flags(conv.session_flags if conv else None).get("granted_dirs", [])


def add_once_granted_dir(db: Session, conversation_id: int, path: str) -> None:
    """向一次性令牌列表追加 path（使用一次后即移除）。"""
    _add_dir_to_list(db, conversation_id, "once_granted_dirs", path)


def consume_once_granted_dir(db: Session, conversation_id: int, target: str) -> bool:
    """target 命中某 once 令牌前缀 → 移除该令牌并返回 True；否则返回 False。"""
    conv = db.get(Conversation, conversation_id)
    if not conv:
        return False
    flags = parse_session_flags(conv.session_flags)
    tokens: list[str] = flags.get("once_granted_dirs", [])
    try:
        t = Path(target).resolve()
    except (OSError, ValueError):
        return False
    for tok in list(tokens):
        try:
            if t.is_relative_to(Path(tok).resolve()):
                tokens.remove(tok)
                flags["once_granted_dirs"] = tokens
                _save_flags(db, conversation_id, flags)
                return True
        except (OSError, ValueError):
            continue
    return False
