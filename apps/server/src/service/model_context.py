"""Resolve max_input_tokens for deepagents summarization middleware."""

from __future__ import annotations

import logging

from langchain_openai import ChatOpenAI

from src.core.config import Settings

logger = logging.getLogger(__name__)

DEFAULT_MAX_INPUT_TOKENS = 131072
DEFAULT_SUMMARIZATION_TRIGGER_FRACTION = 0.75
DEFAULT_SUMMARIZATION_KEEP_FRACTION = 0.20


def resolve_max_input_tokens(settings: Settings) -> int:
    raw = settings.model_max_input_tokens
    if raw is None or raw <= 0:
        return DEFAULT_MAX_INPUT_TOKENS
    return raw


def apply_model_profile(model: ChatOpenAI, max_input_tokens: int) -> None:
    model.profile = {"max_input_tokens": max_input_tokens}
    logger.info("model profile max_input_tokens=%s", max_input_tokens)


def resolve_summarization_trigger(
    settings: Settings,
) -> tuple[str, float]:
    return ("fraction", settings.summarization_trigger_fraction)


def resolve_summarization_keep(settings: Settings) -> tuple[str, float]:
    return ("fraction", settings.summarization_keep_fraction)
