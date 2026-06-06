from __future__ import annotations

from src.core.config import _get_kv_bool, _get_kv_value, _read_config_kv_data

AGENT_MAX_CONCURRENT_STREAMS_KV = "AGENT_MAX_CONCURRENT_STREAMS"
AGENT_MAX_CONCURRENT_STREAMS_DEFAULT = 1
AGENT_MAX_CONCURRENT_STREAMS_CAP = 8

# 资源阀门（默认开启，保守值）：总闸 4、重活闸 2。
# 历史默认是 0（不限），但群聊会并发拉起组长+多成员+汇总多条 heavy(orchestration) 流，
# 每条每个 super-step 都往全局唯一 checkpointer 连接写大 checkpoint（observed 110KB+），
# 不限并发时写队列雪崩 → 全流卡在 checkpoint、写锁长占、ORM 也 database is locked → 崩溃。
# 把重活并发压到 2（+1 轻预留，见 light_slot_reserve），把 checkpoint 写速率控制在
# 单连接可排空的范围；其余流排队。可经 config_kvs AGENT_MAX_INFLIGHT / AGENT_MAX_HEAVY 覆盖
# （设 0 = 关闭逃生阀）。
AGENT_MAX_INFLIGHT_KV = "AGENT_MAX_INFLIGHT"
# 4→2：实测 orchestration 突发并发(组长一次派多员工，每条还多一次 SkillsMiddleware
# before_agent 模型调用)会触发「调模型前卡 45s」竞态，~50% 流卡死。降到 2 减少同时
# 在飞的流→显著降低触发概率（群聊变串行一点，但能用）。可经 config_kvs AGENT_MAX_INFLIGHT 覆盖。
AGENT_MAX_INFLIGHT_DEFAULT = 2
AGENT_MAX_INFLIGHT_CAP = 32

AGENT_MAX_HEAVY_KV = "AGENT_MAX_HEAVY"
AGENT_MAX_HEAVY_DEFAULT = 2

# 启用槽位闸且总闸 >= 2 时，为 light 预留、heavy 不可占满的格数。
LIGHT_SLOT_RESERVE = 1

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
    # 编排/定时/组长统筹=heavy（批量交付、长任务）。
    # 群 @ 直接对话(group_room) 归为 light：交互式短对话，不应占唯一 heavy 槽挡总管。
    if source in (
        "orchestration",
        "scheduled",
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

    def effective_max_inflight_for(self, stream_class: str) -> int:
        """heavy 可见的总槽上限（0=不限）；light 始终用 ``effective_max_inflight()`` 全池。

        heavy 最多占 ``总闸 - LIGHT_SLOT_RESERVE``，为 light 留至少 1 格。
        light 入场只看总闸，heavy 未满时可占用空 heavy 槽（见 ``StreamRegistry.can_admit``）。
        """
        cap = self.effective_max_inflight()
        if cap <= 0 or stream_class != STREAM_CLASS_HEAVY:
            return cap
        if cap >= 2 and LIGHT_SLOT_RESERVE > 0:
            return max(1, cap - LIGHT_SLOT_RESERVE)
        return cap

    def light_slot_reserve(self) -> int:
        """为 light 预留、heavy 不可占用的槽位数（总闸 < 2 时为 0）。"""
        cap = self.effective_max_inflight()
        if cap >= 2 and LIGHT_SLOT_RESERVE > 0:
            return LIGHT_SLOT_RESERVE
        return 0

    def slot_gating_enabled(self) -> bool:
        """仅按**不分类的总并发闸**判定是否排队（heavy/light 不再用于槽位限流，
        改为控制单请求输出 token 上限，见 build_chat_model max_tokens）。"""
        return self.effective_max_inflight() > 0


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
