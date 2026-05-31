"""Heuristics for whether the active chat model accepts image (vision) input."""

from __future__ import annotations

import re

_VISION_MODEL_PATTERN = re.compile(
    r"(?i)"
    r"(?:"
    r"qwen[\w.-]*vl|"  # qwen-vl-max, qwen2.5-vl-72b-instruct, …
    r"glm-4v|"
    r"gpt-4o|"
    r"deepseek-vl|"
    r"internvl|"
    r"minicpm-v|"
    r"claude-3(?:\.\d+)?-(?:opus|sonnet|haiku|5)|"
    r"gemini(?:-[\w.]+)?-(?:pro|flash)(?:-vision)?|"
    r"vision|"
    r"kimi.*vision"
    r")"
)


def is_vision_capable_model(model_id: str | None) -> bool:
    """Return True when model id/name likely supports image understanding."""
    name = (model_id or "").strip()
    if not name:
        return False
    return bool(_VISION_MODEL_PATTERN.search(name))


def active_model_supports_vision() -> bool:
    """Whether the currently configured agent model accepts image input."""
    from src.core.config import get_settings

    settings = get_settings()
    return is_vision_capable_model(settings.deepagent_model)
