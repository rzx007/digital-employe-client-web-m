"""Per-turn 产物写入日志:以 conversation_id 为键累积本轮写入的文件(绝对 posix
路径 + create/modify),供流结束时写入消息 extra_meta.file_outputs。

为何进程级 dict 而非 contextvar:工具执行可能跨线程(deepagents to_thread / DB 写
线程),contextvar 不随线程传播;而 conversation_id 在各 backend 实例/上下文里都拿
得到,且同会话执行被串行化,用它作键既稳又简单。
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# conversation_id -> {abs_posix_path: action}。action: "create" | "modify"。
_journals: dict[int, dict[str, str]] = {}
_lock = threading.Lock()


def _norm(path: str) -> str:
    return Path(str(path)).resolve().as_posix()


def begin(conversation_id: int | None) -> None:
    """开一轮:清掉该会话的旧累积(防上一轮残留)。"""
    if conversation_id is None:
        return
    with _lock:
        _journals[conversation_id] = {}


def record(conversation_id: int | None, path: str, action: str) -> None:
    """上报一次写入。create 优先级高于 modify(同文件出现过 create 即 create)。"""
    if conversation_id is None or not path:
        return
    try:
        key = _norm(path)
    except OSError:
        return
    with _lock:
        bucket = _journals.setdefault(conversation_id, {})
        if bucket.get(key) == "create":
            return
        bucket[key] = action


def snapshot_and_clear(conversation_id: int | None) -> list[dict]:
    """取走并清空该会话累积,返回 [{path, action}]。"""
    if conversation_id is None:
        return []
    with _lock:
        bucket = _journals.pop(conversation_id, None)
    if not bucket:
        return []
    return [{"path": p, "action": a} for p, a in bucket.items()]
