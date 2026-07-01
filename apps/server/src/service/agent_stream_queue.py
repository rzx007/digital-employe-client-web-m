from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class StartResult(StrEnum):
    STARTED = "started"
    QUEUED = "queued"
    REJECTED = "rejected"


@dataclass(slots=True)
class PendingStart:
    conversation_id: int
    agent: Any
    messages: list[dict]
    config: dict
    stream_msg_id: int
    skill_name: str
    debug_content_only: bool
    priority: int
    source: str
    stream_class: str = "light"
    agent_input: Any | None = None
    task: Any | None = None
    orchestrator_owned_db: Any | None = None
    orchestrator_workspace_id: int | None = None
    orchestrator_conversation_id: int | None = None
    orchestrator_auth_token: str | None = None
    enqueued_at: float = field(default_factory=time.monotonic)
    sequence: int = 0


class AgentStreamQueue:
    def __init__(self) -> None:
        self._items: list[PendingStart] = []
        self._seq = itertools.count(1)

    def depth(self) -> int:
        return len(self._items)

    def contains(self, conversation_id: int) -> bool:
        return any(item.conversation_id == conversation_id for item in self._items)

    def enqueue(self, pending: PendingStart) -> bool:
        if self.contains(pending.conversation_id):
            return False
        pending.sequence = next(self._seq)
        self._items.append(pending)
        self._items.sort(key=lambda item: (item.priority, item.sequence))
        return True

    def pop_next(self) -> PendingStart | None:
        if not self._items:
            return None
        return self._items.pop(0)

    def remove(self, conversation_id: int) -> PendingStart | None:
        for index, item in enumerate(self._items):
            if item.conversation_id == conversation_id:
                return self._items.pop(index)
        return None
