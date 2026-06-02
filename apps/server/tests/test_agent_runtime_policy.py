"""Agent 串行/并行策略：设置页热更新须即时生效。"""

from __future__ import annotations

from src.core.agent_runtime_policy import (
    AGENT_MAX_CONCURRENT_STREAMS_CAP,
    get_agent_runtime_policy,
    parse_agent_max_concurrent_streams,
)


def test_agent_serial_mode_reads_fresh_kv(monkeypatch) -> None:
    kv = {"AGENT_SERIAL_MODE": "0"}

    monkeypatch.setattr(
        "src.core.agent_runtime_policy._read_config_kv_data",
        lambda: dict(kv),
    )

    assert get_agent_runtime_policy().serial_mode is False
    assert get_agent_runtime_policy().max_concurrent_streams == 0

    kv["AGENT_SERIAL_MODE"] = "1"
    policy = get_agent_runtime_policy()
    assert policy.serial_mode is True
    assert policy.max_concurrent_streams == 1


def test_agent_max_concurrent_streams_from_kv(monkeypatch) -> None:
    kv = {
        "AGENT_SERIAL_MODE": "1",
        "AGENT_MAX_CONCURRENT_STREAMS": "3",
    }
    monkeypatch.setattr(
        "src.core.agent_runtime_policy._read_config_kv_data",
        lambda: dict(kv),
    )
    policy = get_agent_runtime_policy()
    assert policy.max_concurrent_streams == 3

    kv["AGENT_MAX_CONCURRENT_STREAMS"] = "99"
    assert get_agent_runtime_policy().max_concurrent_streams == AGENT_MAX_CONCURRENT_STREAMS_CAP

    kv["AGENT_MAX_CONCURRENT_STREAMS"] = "0"
    assert get_agent_runtime_policy().max_concurrent_streams == 1

    kv["AGENT_MAX_CONCURRENT_STREAMS"] = "bad"
    assert get_agent_runtime_policy().max_concurrent_streams == 1


def test_parse_agent_max_concurrent_when_serial_off() -> None:
    assert (
        parse_agent_max_concurrent_streams(
            {"AGENT_MAX_CONCURRENT_STREAMS": "5"},
            serial_mode=False,
        )
        == 0
    )
