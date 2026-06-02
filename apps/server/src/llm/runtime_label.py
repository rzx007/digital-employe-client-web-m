"""Runtime API helpers for active LLM display label."""

from __future__ import annotations

from src.llm.registry import LlmRegistry, find_provider


def resolve_llm_label(registry: LlmRegistry) -> str:
    if not registry.active_provider_id or not registry.active_model_id:
        return "未配置模型"
    provider = find_provider(registry, registry.active_provider_id)
    model_id = registry.active_model_id
    if provider is None:
        return model_id
    return f"{provider.display_name} / {model_id}"
