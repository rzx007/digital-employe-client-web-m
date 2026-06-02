"""Heuristics for whether the active chat model accepts image (vision) input."""

from __future__ import annotations

import re
from dataclasses import dataclass

from src.llm.providers.catalog import is_catalog_vision_model
from src.llm.registry import (
    LlmModelEntry,
    OFFLINE_BOOTSTRAP_MODEL_ID,
    OFFLINE_BOOTSTRAP_PROVIDER_ID,
    OFFLINE_BOOTSTRAP_SUPPORTS_VISION,
    resolve_active_model_entry,
)

QWEN3_VL_IMAGE_FACTOR = 32
QWEN3_VL_PX_PER_TOKEN = QWEN3_VL_IMAGE_FACTOR * QWEN3_VL_IMAGE_FACTOR


@dataclass(frozen=True, slots=True)
class VisionResizeProfile:
    px_per_token: int = QWEN3_VL_PX_PER_TOKEN
    image_factor: int = QWEN3_VL_IMAGE_FACTOR
    default_max_tokens: int = 1024


DEFAULT_VISION_RESIZE_PROFILE = VisionResizeProfile()

_VISION_MODEL_PATTERN = re.compile(
    r"(?i)"
    r"(?:"
    r"qwen[\w./-]*vl|"
    r"qvq-|"
    r"glm-4[\w.-]*v(?:\b|[-_.]|$)|"
    r"glm-5[\w.-]*v(?:\b|[-_.]|$)|"
    r"gpt-4o|"
    r"gpt-4\.1|"
    r"deepseek-vl|"
    r"internvl|"
    r"minicpm-v|"
    r"claude-[34](?:\.\d+)?-(?:opus|sonnet|haiku)|"
    r"gemini(?:-[\w.]+)?-(?:pro|flash)(?:-vision)?|"
    r"gemini-2[\w.-]*-(?:pro|flash)|"
    r"kimi-k2(?:\.\d+)?|"
    r"moonshot-v1-[\w-]*vision|"
    r"kimi[\w.-]*vision|"
    r"[-_]vision(?:\b|[-_.]|$)|"
    r"[-_]vl(?:\b|[-_.]|$)"
    r")"
)


def resolve_vision_resize_profile(
    provider_id: str | None,
    model_id: str | None,
) -> VisionResizeProfile:
    """Return the resize profile for a vision model.

    Qwen3-VL/Hanhai uses patch16 x merge2 (32px alignment, 1024 px/token).
    Other providers currently share the same conservative default until they
    need provider-specific calibration.
    """
    return DEFAULT_VISION_RESIZE_PROFILE


def is_vision_capable_model(
    model_id: str | None,
    *,
    provider_id: str | None = None,
    registry_entry: LlmModelEntry | None = None,
) -> bool:
    """Return True when model id/name likely supports image understanding."""
    if registry_entry is not None and registry_entry.supports_vision is not None:
        return registry_entry.supports_vision

    name = (model_id or "").strip()
    if not name:
        return False

    if is_catalog_vision_model(provider_id, name):
        return True

    if _is_offline_bootstrap_vision_model(provider_id, name):
        return True

    return bool(_VISION_MODEL_PATTERN.search(name))


def _is_offline_bootstrap_vision_model(
    provider_id: str | None,
    model_id: str | None,
) -> bool:
    if not OFFLINE_BOOTSTRAP_SUPPORTS_VISION:
        return False
    if not provider_id or not model_id:
        return False
    return (
        provider_id == OFFLINE_BOOTSTRAP_PROVIDER_ID
        and model_id.strip() == OFFLINE_BOOTSTRAP_MODEL_ID
    )


def active_model_supports_vision() -> bool:
    """Whether the currently configured agent model accepts image input."""
    from src.core.config import _read_config_kv_data, get_settings

    settings = get_settings()
    provider_id = settings.llm_provider
    model_id = settings.deepagent_model
    registry_entry: LlmModelEntry | None = None

    try:
        pid, mid, entry = resolve_active_model_entry(_read_config_kv_data())
        if pid:
            provider_id = pid
        if mid:
            model_id = mid
        registry_entry = entry
    except Exception:
        pass

    return is_vision_capable_model(
        model_id,
        provider_id=provider_id,
        registry_entry=registry_entry,
    )


def active_vision_resize_profile() -> VisionResizeProfile:
    """Resize profile for the currently configured active model."""
    from src.core.config import _read_config_kv_data, get_settings

    settings = get_settings()
    provider_id = settings.llm_provider
    model_id = settings.deepagent_model

    try:
        pid, mid, _entry = resolve_active_model_entry(_read_config_kv_data())
        if pid:
            provider_id = pid
        if mid:
            model_id = mid
    except Exception:
        pass

    return resolve_vision_resize_profile(provider_id, model_id)
