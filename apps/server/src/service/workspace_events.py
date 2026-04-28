from __future__ import annotations

import asyncio
import json
import logging
import queue
from typing import Any

logger = logging.getLogger(__name__)

TASK_STARTED = "task_started"
TASK_COMPLETED = "task_completed"
TASK_FAILED = "task_failed"
ORCHESTRATION_PLAN_GENERATED = "orchestration_plan_generated"


class WorkspaceEventBus:
    _subscribers: dict[int, set[queue.Queue]] = {}

    @classmethod
    def push(cls, workspace_id: int, event: dict) -> None:
        queues = cls._subscribers.get(workspace_id, set())
        if not queues:
            return
        data = json.dumps(event, ensure_ascii=False, default=str)
        dead: list[queue.Queue] = []
        for q in queues:
            try:
                q.put_nowait(data)
            except queue.Full:
                dead.append(q)
            except Exception:
                dead.append(q)
        for q in dead:
            queues.discard(q)

    @classmethod
    def subscribe(cls, workspace_id: int) -> queue.Queue[Any]:
        q: queue.Queue[Any] = queue.Queue(maxsize=256)
        if workspace_id not in cls._subscribers:
            cls._subscribers[workspace_id] = set()
        cls._subscribers[workspace_id].add(q)
        return q

    @classmethod
    def unsubscribe(cls, workspace_id: int, q: queue.Queue[Any]) -> None:
        queues = cls._subscribers.get(workspace_id)
        if queues:
            queues.discard(q)
            if not queues:
                cls._subscribers.pop(workspace_id, None)
