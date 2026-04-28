from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from src.service.stream_registry import StreamRegistry

logger = logging.getLogger(__name__)

_registry: StreamRegistry | None = None

WORKSPACE_PREFIX = "ws-"

TASK_STARTED = "task_started"
TASK_COMPLETED = "task_completed"
TASK_FAILED = "task_failed"
ORCHESTRATION_PLAN_GENERATED = "orchestration_plan_generated"


def _make_key(workspace_id: int) -> str:
    return f"{WORKSPACE_PREFIX}{workspace_id}"


class WorkspaceEventBus:
    _subscribers: dict[int, set[asyncio.Queue]] = {}

    @classmethod
    def push(cls, workspace_id: int, event: dict) -> None:
        queues = cls._subscribers.get(workspace_id, set())
        if not queues:
            return
        data = json.dumps(event, ensure_ascii=False, default=str)
        dead: list[asyncio.Queue] = []
        for q in queues:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                dead.append(q)
            except Exception:
                dead.append(q)
        for q in dead:
            queues.discard(q)

    @classmethod
    def subscribe(cls, workspace_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        if workspace_id not in cls._subscribers:
            cls._subscribers[workspace_id] = set()
        cls._subscribers[workspace_id].add(q)
        return q

    @classmethod
    def unsubscribe(cls, workspace_id: int, queue: asyncio.Queue) -> None:
        queues = cls._subscribers.get(workspace_id)
        if queues:
            queues.discard(queue)
            if not queues:
                cls._subscribers.pop(workspace_id, None)
