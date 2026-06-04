from typing import Any
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.core.config import is_offline_mode
from src.core.agent_runtime_policy import get_agent_runtime_policy
from src.core.runtime_capabilities import get_capabilities
from src.db.session import get_db
from src.llm.registry import load_registry
from src.llm.runtime_label import resolve_llm_label
from src.models.response import ResponseBase
from src.service.activation_service import ActivationService

router = APIRouter(tags=["系统"])

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
