"""会话级写守卫注册表：按 conversation_id 查 roots + workspace_id。

仿 orchestrator/runtime.py 的 _stream_sessions：流式启动时把本会话的
工作区合法写入根集合（roots）与 workspace_id 注册进来；write_file/edit_file
工具在写盘前用 conversation_id 反查，交给 guard_external_write 判定越界。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# 从 orchestrator.runtime re-export，避免写工具直接耦合 orchestrator 包。
from src.service.agent.orchestrator.runtime import (
    conversation_id_from_runtime as conv_id_from_runtime,
)

__all__ = [
    "WriteGuardCtx",
    "conv_id_from_runtime",
    "register_write_guard",
    "lookup_write_guard",
    "clear_write_guard",
]


@dataclass
class WriteGuardCtx:
    roots: list[Path]
    workspace_id: int


_registry: dict[int, WriteGuardCtx] = {}


def register_write_guard(
    conversation_id: int | None, roots: list[Path], workspace_id: int
) -> None:
    if conversation_id is None:
        return
    _registry[int(conversation_id)] = WriteGuardCtx(
        roots=list(roots), workspace_id=workspace_id
    )


def lookup_write_guard(conversation_id: int | None) -> WriteGuardCtx | None:
    if conversation_id is None:
        return None
    return _registry.get(int(conversation_id))


def clear_write_guard(conversation_id: int | None) -> None:
    if conversation_id is None:
        return
    _registry.pop(int(conversation_id), None)
