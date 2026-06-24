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
CONVERSATION_STATUS_CHANGED = "conversation_status_changed"
PLAN_RUN_SETTLED = "plan_run_settled"


class WorkspaceEventBus:
    _subscribers: dict[int, set[queue.Queue]] = {}
    # 全局订阅者：不绑定 workspace，收所有 workspace 的事件（ChannelManager 用）。
    _global_subscribers: set[queue.Queue] = set()

    @classmethod
    def push(cls, workspace_id: int, event: dict) -> None:
        # 即使该 workspace 无 per-workspace 订阅者，也要投全局队列；故先序列化、
        # 不再因 per-workspace 为空而早退。
        data = json.dumps(event, ensure_ascii=False, default=str)
        queues = cls._subscribers.get(workspace_id, set())
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

        dead_global: list[queue.Queue] = []
        for q in cls._global_subscribers:
            try:
                q.put_nowait(data)
            except queue.Full:
                dead_global.append(q)
            except Exception:
                dead_global.append(q)
        for q in dead_global:
            cls._global_subscribers.discard(q)

    @classmethod
    def subscribe_all(cls) -> queue.Queue[Any]:
        q: queue.Queue[Any] = queue.Queue(maxsize=512)
        cls._global_subscribers.add(q)
        return q

    @classmethod
    def unsubscribe_all(cls, q: queue.Queue[Any]) -> None:
        cls._global_subscribers.discard(q)

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
