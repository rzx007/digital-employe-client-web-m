"""Agent 串行/并行策略：设置页热更新须即时生效。"""

from __future__ import annotations

from src.core.agent_runtime_policy import (
    AGENT_MAX_CONCURRENT_STREAMS_CAP,
    AGENT_MAX_INFLIGHT_CAP,
    AGENT_MAX_INFLIGHT_DEFAULT,
    AgentRuntimePolicy,
    get_agent_runtime_policy,
    parse_agent_max_concurrent_streams,
    parse_agent_max_inflight,
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


def test_max_inflight_default_when_serial_off(monkeypatch) -> None:
    """串行关闭且未配 KV 时槽位闸默认关闭（0=不限）。"""
    monkeypatch.setattr(
        "src.core.agent_runtime_policy._read_config_kv_data",
        lambda: {"AGENT_SERIAL_MODE": "0"},
    )
    policy = get_agent_runtime_policy()
    assert policy.serial_mode is False
    assert policy.max_inflight == AGENT_MAX_INFLIGHT_DEFAULT
    assert policy.effective_max_inflight() == 0
    assert policy.slot_gating_enabled() is False


def test_max_inflight_from_kv(monkeypatch) -> None:
    kv = {"AGENT_MAX_INFLIGHT": "6"}
    monkeypatch.setattr(
        "src.core.agent_runtime_policy._read_config_kv_data",
        lambda: dict(kv),
    )
    assert get_agent_runtime_policy().effective_max_inflight() == 6

    kv["AGENT_MAX_INFLIGHT"] = "999"
    assert get_agent_runtime_policy().max_inflight == AGENT_MAX_INFLIGHT_CAP

    kv["AGENT_MAX_INFLIGHT"] = "0"  # 逃生阀：0 = 不限
    assert get_agent_runtime_policy().effective_max_inflight() == 0

    kv["AGENT_MAX_INFLIGHT"] = "bad"
    assert get_agent_runtime_policy().max_inflight == AGENT_MAX_INFLIGHT_DEFAULT


def test_parse_agent_max_inflight_bounds() -> None:
    assert parse_agent_max_inflight({}) == AGENT_MAX_INFLIGHT_DEFAULT
    assert parse_agent_max_inflight({"AGENT_MAX_INFLIGHT": "-3"}) == 0
    assert parse_agent_max_inflight({"AGENT_MAX_INFLIGHT": "2"}) == 2


def test_effective_max_inflight_serial_takes_min() -> None:
    """serial_mode 作为更严的叠加限制：与 max_concurrent_streams 取 min。"""
    # 默认 inflight=4，serial 限到 2 → 生效 2
    p = AgentRuntimePolicy(serial_mode=True, max_concurrent_streams=2)
    assert p.effective_max_inflight() == 2
    # serial 限到 1 → 生效 1
    p = AgentRuntimePolicy(serial_mode=True, max_concurrent_streams=1)
    assert p.effective_max_inflight() == 1
    # 串行关闭 → 只受 inflight 约束
    p = AgentRuntimePolicy(serial_mode=False, max_concurrent_streams=0, max_inflight=4)
    assert p.effective_max_inflight() == 4
    # inflight=0（不限）+ 串行关闭 → 0（不限）
    p = AgentRuntimePolicy(serial_mode=False, max_concurrent_streams=0, max_inflight=0)
    assert p.effective_max_inflight() == 0


def test_heavy_reserves_light_slot() -> None:
    p = AgentRuntimePolicy(
        serial_mode=False, max_concurrent_streams=0, max_inflight=4, max_heavy=3
    )
    assert p.slot_gating_enabled() is True
    assert p.effective_max_inflight_for("light") == 4
    assert p.effective_max_inflight_for("heavy") == 3


def test_group_room_is_light() -> None:
    from src.core.agent_runtime_policy import resolve_stream_class

    assert resolve_stream_class(None, "group_room") == "light"
    assert resolve_stream_class(None, "group_leader") == "heavy"
    assert resolve_stream_class(None, "user_chat") == "light"


def test_slot_gating_off_by_default() -> None:
    p = AgentRuntimePolicy(serial_mode=False, max_concurrent_streams=0)
    assert p.slot_gating_enabled() is False
