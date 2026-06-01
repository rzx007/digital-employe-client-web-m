"""Agent 串行/并行策略：设置页热更新须即时生效。"""

from __future__ import annotations

from src.core.agent_runtime_policy import get_agent_runtime_policy


def test_agent_serial_mode_reads_fresh_kv(monkeypatch) -> None:
    kv = {"AGENT_SERIAL_MODE": "0"}

    monkeypatch.setattr(
        "src.core.config._read_config_kv_data",
        lambda: dict(kv),
    )

    assert get_agent_runtime_policy().serial_mode is False
    assert get_agent_runtime_policy().max_concurrent_streams == 0

    kv["AGENT_SERIAL_MODE"] = "1"
    policy = get_agent_runtime_policy()
    assert policy.serial_mode is True
    assert policy.max_concurrent_streams == 1
