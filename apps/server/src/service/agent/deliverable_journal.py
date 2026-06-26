"""Per-turn 产物写入日志:以 conversation_id 为键累积本轮写入的文件(绝对 posix
路径 + create/modify),供流结束时写入消息 extra_meta.file_outputs。

为何进程级 dict 而非 contextvar:工具执行可能跨线程(deepagents to_thread / DB 写
线程),contextvar 不随线程传播;而 conversation_id 在各 backend 实例/上下文里都拿
得到,且同会话执行被串行化,用它作键既稳又简单。
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Literal, TypedDict

from src.service.resource_service import (
    _EXTERNAL_NOISE_DIRS,
    _is_internal_scratch,
)

logger = logging.getLogger(__name__)

# action: "create" | "modify"。新建优先于改动。
Action = Literal["create", "modify"]


class FileOutput(TypedDict):
    path: str
    action: Action


# conversation_id -> {abs_posix_path: action}。action: "create" | "modify"。
_journals: dict[int, dict[str, Action]] = {}
_lock = threading.Lock()


def _norm(path: str) -> str:
    return Path(str(path)).resolve().as_posix()


def begin(conversation_id: int | None) -> None:
    """开一轮:清掉该会话的旧累积(防上一轮残留)。"""
    if conversation_id is None:
        return
    with _lock:
        _journals[conversation_id] = {}


def record(conversation_id: int | None, path: str, action: Action) -> None:
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


def report_file_write(
    conversation_id: int | None, path: str, *, existed_before: bool, is_edit: bool
) -> None:
    """write/edit 成功后的统一上报。edit 必为 modify;write 视写前是否已存在分 create/modify。"""
    action: Action = "modify" if (is_edit or existed_before) else "create"
    record(conversation_id, path, action)


def snapshot_and_clear(conversation_id: int | None) -> list[FileOutput]:
    """取走并清空该会话累积,返回 [{path, action}]。"""
    if conversation_id is None:
        return []
    with _lock:
        bucket = _journals.pop(conversation_id, None)
    if not bucket:
        return []
    return [{"path": p, "action": a} for p, a in bucket.items()]


def merge_file_outputs_into_meta(extra_meta: str | None, outputs: list[dict]) -> str | None:
    """把 file_outputs 合并进 extra_meta(JSON 字符串),保留已有字段;空 outputs 原样返回。"""
    if not outputs:
        return extra_meta
    try:
        meta = json.loads(extra_meta) if extra_meta else {}
    except (json.JSONDecodeError, TypeError):
        meta = {}
    meta["file_outputs"] = outputs
    return json.dumps(meta, ensure_ascii=False)


def scan_tree(root: Path) -> dict[str, tuple[float, int]]:
    """递归扫一个目录,返回 {abs_posix: (mtime, size)}。跳过内部 scratch / 噪音目录 /
    隐藏目录,与 resource_service 的展示口径一致,顺带把扫描成本压在产物文件上。

    采用 iterdir + 原地剪枝(镜像 resource_service._scan_dir_flat):遇到噪音/隐藏
    目录直接不下钻,避免完整枚举 node_modules/.git 等再丢弃(热路径,每条 shell 前后各调一次)。
    """
    out: dict[str, tuple[float, int]] = {}
    if not root.is_dir():
        return out

    def _walk(d: Path) -> None:
        try:
            items = list(d.iterdir())
        except OSError:
            logger.debug("scan_tree iterdir failed: %s", d, exc_info=True)
            return
        for p in items:
            name = p.name
            if p.is_dir():
                if name in _EXTERNAL_NOISE_DIRS or name.startswith("."):
                    continue  # 剪枝:不下钻
                _walk(p)
            else:
                if _is_internal_scratch(name):
                    continue
                try:
                    st = p.stat()
                except OSError:
                    logger.debug("scan_tree stat failed: %s", p, exc_info=True)
                    continue
                out[p.resolve().as_posix()] = (st.st_mtime, st.st_size)

    _walk(root)
    return out


def record_shell_delta(
    conversation_id: int | None,
    before: dict[str, tuple[float, int]],
    after: dict[str, tuple[float, int]],
) -> None:
    """对比 shell 执行前后快照,新增→create、mtime/size 变化→modify,上报 journal。"""
    if conversation_id is None:
        return
    for path, sig in after.items():
        prev = before.get(path)
        if prev is None:
            record(conversation_id, path, "create")
        elif prev != sig:
            record(conversation_id, path, "modify")
