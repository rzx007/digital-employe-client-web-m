from typing import Any
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import logging

from src.core.config import is_offline_mode
from src.core.agent_runtime_policy import get_agent_runtime_policy
from src.core.runtime_capabilities import get_capabilities
from src.db.session import get_db
from src.llm.registry import load_registry
from src.llm.runtime_label import resolve_llm_label
from src.models.response import ResponseBase
from src.service.activation_service import ActivationService

router = APIRouter(tags=["系统"])
logger = logging.getLogger(__name__)


@router.get("/system/streams/debug", response_model=ResponseBase[dict[str, Any]])
def debug_streams() -> ResponseBase[dict[str, Any]]:
    """运行时自省：dump 所有流（含僵尸）的完整状态，不重启即可定位卡死。

    用法：浏览器 / curl 直接打 GET <server>/system/streams/debug 即可。
    关注点：
    - gates.can_admit_heavy=false 且 active_heavy 已满 → 槽被占满；
    - tasks 里 age_seconds 很大、is_stale=true / asyncio_task_done=true
      的就是僵尸流（占槽元凶），用 force-clear 接口解封。
    """
    from src.service.stream_registry import registry

    return ResponseBase(data=registry.debug_dump_streams())


@router.post(
    "/system/streams/{conversation_id}/force-clear",
    response_model=ResponseBase[dict[str, Any]],
)
def force_clear_stream(conversation_id: int) -> ResponseBase[dict[str, Any]]:
    """运行时手动解封：强制清掉一个卡死的流并释放槽位（不重启）。

    用法：curl -X POST <server>/system/streams/<conversation_id>/force-clear
    """
    from src.service.stream_registry import registry

    result = registry.force_clear_stream(conversation_id)
    logger.warning("force_clear_stream via API: %s", result)
    return ResponseBase(data=result)

@router.get("/system/runtime", response_model=ResponseBase[dict[str, Any]])
def get_runtime_config(db: Session = Depends(get_db)) -> ResponseBase[dict[str, Any]]:
    caps = get_capabilities()
    agent_policy = get_agent_runtime_policy()
    activation = ActivationService.get_status()
    active_items: list[dict[str, Any]] = []
    queued_items: list[dict[str, Any]] = []
    metrics_snapshot: dict[str, Any] = {}
    try:
        from src.service.stream_registry import registry

        active_streams = registry.count_active_streams()
        queued_starts = registry.queue_depth()
        snapshot = registry.snapshot_agent_runtime_status()
        active_items = snapshot.get("active_items", [])
        queued_items = snapshot.get("queued_items", [])
    except Exception:
        active_streams = 0
        queued_starts = 0

    try:
        from src.service.stream_metrics import metrics as _stream_metrics

        metrics_snapshot = _stream_metrics.snapshot()
    except Exception:
        metrics_snapshot = {"inflight": [], "recent": [], "summary": {"count": 0}}

    try:
        llm_label = resolve_llm_label(load_registry(db))
    except Exception:
        llm_label = "未配置模型"

    return ResponseBase(
        data={
            "offline_mode": is_offline_mode(),
            "llm_label": llm_label,
            "agent_runtime": {
                "serial_mode": agent_policy.serial_mode,
                "max_concurrent_streams": agent_policy.max_concurrent_streams,
                "max_inflight": agent_policy.max_inflight,
                "effective_max_inflight": agent_policy.effective_max_inflight(),
                "max_heavy": agent_policy.max_heavy,
                "effective_max_heavy": agent_policy.effective_max_heavy(),
                "light_slot_reserve": agent_policy.light_slot_reserve(),
                "heavy_inflight_ceiling": agent_policy.effective_max_inflight_for(
                    "heavy"
                ),
                "active_streams": active_streams,
                "queued_starts": queued_starts,
                "active_items": active_items,
                "queued_items": queued_items,
                "metrics": metrics_snapshot,
            },
            "capabilities": {
                "remote_login": caps.remote_login,
                "remote_model_sync": caps.remote_model_sync,
                "remote_skills": caps.remote_skills,
                "remote_mcp": caps.remote_mcp,
                "remote_performance": caps.remote_performance,
                "dispatch_order_sync": caps.dispatch_order_sync,
                "oauth": caps.oauth,
                "feishu_platform": caps.feishu_platform,
                "skill_rating_upload": caps.skill_rating_upload,
                "mcp_task_execution": caps.mcp_task_execution,
                "activation_enforced": caps.activation_enforced,
            },
            "activation": {
                "enforced": activation.enforced,
                "activated": activation.activated,
                "expires_at": activation.expires_at,
                "days_remaining": activation.days_remaining,
                "reason": activation.reason,
            },
        }
    )
