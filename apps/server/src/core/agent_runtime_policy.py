from __future__ import annotations

from src.core.config import _get_kv_bool, _get_kv_value, _read_config_kv_data

AGENT_MAX_CONCURRENT_STREAMS_KV = "AGENT_MAX_CONCURRENT_STREAMS"
AGENT_MAX_CONCURRENT_STREAMS_DEFAULT = 1
AGENT_MAX_CONCURRENT_STREAMS_CAP = 8

# 资源阀门：常驻并发上限（与 serial_mode 解耦），默认对齐推理后端的并发槽。
# 当前 llama.cpp 启动参数 -np=4（见 scripts/apply-hanhai-tune.py 的 docker-compose），
# 换后端/换模型时改这一个 KV 即可。设为 0 表示不限（逃生阀）。
AGENT_MAX_INFLIGHT_KV = "AGENT_MAX_INFLIGHT"
AGENT_MAX_INFLIGHT_DEFAULT = 4
AGENT_MAX_INFLIGHT_CAP = 32

# heavy/light 分级：重活(长文档/批量交付)的并发上限，给交互问答(light)留余量。
# 默认 1 = 编排/组长等 heavy 串行，避免多路重活占满 GPU 槽导致轻活与慢流卡死。
# 设为 0 表示不单独限制重活（仅受 AGENT_MAX_INFLIGHT 总闸约束）。
AGENT_MAX_HEAVY_KV = "AGENT_MAX_HEAVY"
AGENT_MAX_HEAVY_DEFAULT = 1

USER_CHAT_PRIORITY = 10
ORCHESTRATION_PRIORITY = 20
SCHEDULED_PRIORITY = 30
HITL_RESUME_PRIORITY = 0

# 任务难度粗分类（heavy/light），用于资源阀门按类分配 GPU 槽。
STREAM_CLASS_HEAVY = "heavy"
STREAM_CLASS_LIGHT = "light"


def resolve_stream_class(explicit: str | None, source: str | None) -> str:
    """解析任务难度类别。

    优先用总管显式打标(explicit)；缺省时按来源推导：
    编排/定时任务=heavy(批量交付)，用户交互=light(等结果、对延迟敏感)。
    """
    if explicit in (STREAM_CLASS_HEAVY, STREAM_CLASS_LIGHT):
        return explicit  # type: ignore[return-value]
    # 编排/定时/群协作都算 heavy（批量交付、并发敏感）。
    # 群相关流（组长统筹/成员派活/汇总）并发执行时易触发死锁，
    # 归为 heavy 后可经 AGENT_MAX_HEAVY 闸串行兜底（方向A：稳定优先）。
    if source in (
        "orchestration",
        "scheduled",
        "group_room",
        "group_leader",
        "group_leader_summary",
    ):
        return STREAM_CLASS_HEAVY
    return STREAM_CLASS_LIGHT


class AgentRuntimePolicy:
    __slots__ = (
        "serial_mode",
        "max_concurrent_streams",
        "max_inflight",
        "max_heavy",
    )

    def __init__(
        self,
        serial_mode: bool,
        max_concurrent_streams: int,
        max_inflight: int = AGENT_MAX_INFLIGHT_DEFAULT,
        max_heavy: int = AGENT_MAX_HEAVY_DEFAULT,
    ) -> None:
        self.serial_mode = serial_mode
        self.max_concurrent_streams = max_concurrent_streams
        self.max_inflight = max_inflight
        self.max_heavy = max_heavy

    def effective_max_heavy(self) -> int:
        """生效的重活并发上限；返回 0 表示不单独限制重活。

        重活上限不可能超过总上限，故与 ``effective_max_inflight()`` 取 min。
        """
        if self.max_heavy <= 0:
            return 0
        cap = self.effective_max_inflight()
        if cap <= 0:
            return self.max_heavy
        return min(self.max_heavy, cap)

    def effective_max_inflight(self) -> int:
        """生效并发上限；返回 0 表示不限。

        - ``max_inflight`` > 0：常驻 GPU 物理上限（默认 = llama.cpp ``-np``），
          不论是否串行都生效——把"超并发阻塞"从模型层提到应用层，可见可控。
        - ``serial_mode`` 时叠加更严的限制：与 ``max_concurrent_streams`` 取 min。
        """
        caps: list[int] = []
        if self.max_inflight > 0:
            caps.append(self.max_inflight)
        if self.serial_mode and self.max_concurrent_streams > 0:
            caps.append(self.max_concurrent_streams)
        return min(caps) if caps else 0


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


def parse_agent_max_inflight(kv_data: dict[str, str]) -> int:
    """解析常驻并发上限 KV；缺省回默认值，0/负数表示不限，超 CAP 截断。"""
    raw = _get_kv_value(kv_data, AGENT_MAX_INFLIGHT_KV)
    if raw is None:
        return AGENT_MAX_INFLIGHT_DEFAULT
    try:
        value = int(str(raw).strip())
    except (ValueError, AttributeError):
        return AGENT_MAX_INFLIGHT_DEFAULT
    if value <= 0:
        return 0  # 不限（逃生阀）
    if value > AGENT_MAX_INFLIGHT_CAP:
        return AGENT_MAX_INFLIGHT_CAP
    return value


def parse_agent_max_heavy(kv_data: dict[str, str]) -> int:
    """解析重活并发上限 KV；缺省/0/负数表示不单独限制，超 CAP 截断。"""
    raw = _get_kv_value(kv_data, AGENT_MAX_HEAVY_KV)
    if raw is None:
        return AGENT_MAX_HEAVY_DEFAULT
    try:
        value = int(str(raw).strip())
    except (ValueError, AttributeError):
        return AGENT_MAX_HEAVY_DEFAULT
    if value <= 0:
        return 0
    if value > AGENT_MAX_INFLIGHT_CAP:
        return AGENT_MAX_INFLIGHT_CAP
    return value


def get_agent_runtime_policy() -> AgentRuntimePolicy:
    kv_data = _read_config_kv_data()
    serial_mode = _get_kv_bool(kv_data, "AGENT_SERIAL_MODE", default=False)
    max_concurrent = parse_agent_max_concurrent_streams(
        kv_data,
        serial_mode=serial_mode,
    )
    max_inflight = parse_agent_max_inflight(kv_data)
    max_heavy = parse_agent_max_heavy(kv_data)
    return AgentRuntimePolicy(
        serial_mode=serial_mode,
        max_concurrent_streams=max_concurrent,
        max_inflight=max_inflight,
        max_heavy=max_heavy,
    )
