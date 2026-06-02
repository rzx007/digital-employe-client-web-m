from __future__ import annotations

from src.core.config import _get_kv_bool, _get_kv_value, _read_config_kv_data

AGENT_MAX_CONCURRENT_STREAMS_KV = "AGENT_MAX_CONCURRENT_STREAMS"
AGENT_MAX_CONCURRENT_STREAMS_DEFAULT = 1
AGENT_MAX_CONCURRENT_STREAMS_CAP = 8

USER_CHAT_PRIORITY = 10
ORCHESTRATION_PRIORITY = 20
SCHEDULED_PRIORITY = 30
HITL_RESUME_PRIORITY = 0


class AgentRuntimePolicy:
    __slots__ = ("serial_mode", "max_concurrent_streams")

    def __init__(self, serial_mode: bool, max_concurrent_streams: int) -> None:
        self.serial_mode = serial_mode
        self.max_concurrent_streams = max_concurrent_streams


def parse_agent_max_concurrent_streams(
    kv_data: dict[str, str],
    *,
    serial_mode: bool,
) -> int:
    """串行关闭返回 0；开启时解析 KV 并限制在 [1, CAP]。"""
    if not serial_mode:
        return 0
    raw = _get_kv_value(kv_data, AGENT_MAX_CONCURRENT_STREAMS_KV)
    if raw is None:
        return AGENT_MAX_CONCURRENT_STREAMS_DEFAULT
    try:
        value = int(raw.strip())
    except ValueError:
        return AGENT_MAX_CONCURRENT_STREAMS_DEFAULT
    if value < 1:
        return 1
    if value > AGENT_MAX_CONCURRENT_STREAMS_CAP:
        return AGENT_MAX_CONCURRENT_STREAMS_CAP
    return value


def get_agent_runtime_policy() -> AgentRuntimePolicy:
    kv_data = _read_config_kv_data()
    serial_mode = _get_kv_bool(kv_data, "AGENT_SERIAL_MODE", default=False)
    max_concurrent = parse_agent_max_concurrent_streams(
        kv_data,
        serial_mode=serial_mode,
    )
    return AgentRuntimePolicy(
        serial_mode=serial_mode,
        max_concurrent_streams=max_concurrent,
    )
