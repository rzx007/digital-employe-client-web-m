from __future__ import annotations

from dataclasses import dataclass

from src.core.config import read_agent_serial_mode


USER_CHAT_PRIORITY = 10
ORCHESTRATION_PRIORITY = 20
SCHEDULED_PRIORITY = 30
HITL_RESUME_PRIORITY = 0


@dataclass(frozen=True)
class AgentRuntimePolicy:
    serial_mode: bool
    max_concurrent_streams: int


def get_agent_runtime_policy() -> AgentRuntimePolicy:
    serial_mode = read_agent_serial_mode()
    return AgentRuntimePolicy(
        serial_mode=serial_mode,
        max_concurrent_streams=1 if serial_mode else 0,
    )
