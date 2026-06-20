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


# ---------------------------------------------------------------------------
# 工作区外目录写授权：6级短路检查链 + 按scope落地
# ---------------------------------------------------------------------------

from src.models.workspace import Workspace  # noqa: E402
from src.service.authorized_dir_service import grant_dir, list_authorized_dirs  # noqa: E402


def _prefix_hit(target: str, dirs: list[str]) -> bool:
    """target 落在 dirs 中任一目录前缀之下 → True。"""
    try:
        t = Path(target).resolve()
    except (OSError, ValueError):
        return False
    for d in dirs:
        try:
            if t.is_relative_to(Path(d).resolve()):
                return True
        except (OSError, ValueError):
            continue
    return False


def is_granted(db: Session, workspace_id: int, conversation_id: int, target: str) -> bool:
    """6级短路：命中任一即放行（返回 True）。
    1. workspace.auto_grant_external_dirs
    2. 会话 external_dir_mode == "auto"
    3. 工作区永久授权目录前缀
    4. 会话级授权目录前缀
    5. 一次性令牌前缀（命中即消费）
    6. 以上均未命中 → False
    """
    ws = db.get(Workspace, workspace_id)
    if ws and ws.auto_grant_external_dirs:
        return True
    if get_external_dir_mode(db, conversation_id) == "auto":
        return True
    if _prefix_hit(target, list_authorized_dirs(db, workspace_id)):
        return True
    if _prefix_hit(target, get_session_granted_dirs(db, conversation_id)):
        return True
    if consume_once_granted_dir(db, conversation_id, target):
        return True
    return False


def guard_external_write(target: str, *, db: Session, workspace_id: int, conversation_id: int, roots: list[Path]) -> str | None:
    """返回 None=放行写；返回错误提示串=挡回(调用方转 error ToolMessage)。

    判定顺序：
    1. 目标在工作区内 → None（放行）
    2. 已授权（is_granted 含 auto/永久/会话/once）→ None
    3. 会话 mode == "deny" → 返回"严格模式拒绝"串
    4. 否则（ask 且未授权）→ 返回"请先调用 request_external_dir_access 申请授权"串
    """
    if not is_outside_workspace(target, roots):
        return None
    if is_granted(db, workspace_id, conversation_id, target):
        return None
    if get_external_dir_mode(db, conversation_id) == "deny":
        return f"严格模式：拒绝写入工作区外目录 {target}"
    parent = str(Path(target).resolve().parent)
    return (
        f"目标 {target} 在工作区外且未授权。请先调用 "
        f'request_external_dir_access(path="{parent}") 申请授权，获批后再写。'
    )


def record_grant(db: Session, workspace_id: int, conversation_id: int, path: str, scope: str) -> None:
    """按 scope 把授权落到对应存储。
    scope 取值：permanent / session / auto / once；其他值抛 ValueError。
    """
    if scope not in {"permanent", "session", "auto", "once"}:
        raise ValueError(f"invalid scope: {scope!r}，合法值：permanent/session/auto/once")
    parent = str(Path(path).resolve())
    if scope == "permanent":
        grant_dir(db, workspace_id, parent)
    elif scope == "session":
        add_session_granted_dir(db, conversation_id, parent)
    elif scope == "auto":
        set_external_dir_mode(db, conversation_id, "auto")
    elif scope == "once":
        add_once_granted_dir(db, conversation_id, parent)
