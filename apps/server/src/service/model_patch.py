"""Monkey-patch langchain_openai error handling for DashScope compatibility."""

from __future__ import annotations

import logging

import langchain_openai.chat_models.base as lm_base

logger = logging.getLogger(__name__)

_original_handler = lm_base._handle_openai_bad_request
_applied = False


def _is_context_overflow_error(error_str: str, errmsg: str) -> bool:
    """仅匹配上下文超长相关文案，避免误判其它 InternalError.Algo。"""
    if "context_length_exceeded" in error_str:
        return True
    if "Input tokens exceed the configured limit" in errmsg:
        return True
    if "Range of input length" in error_str:
        return True
    return False


def _patched_handler(e: lm_base.openai.BadRequestError) -> None:
    error_str = str(e)
    errmsg = e.message if hasattr(e, "message") else ""

    if _is_context_overflow_error(error_str, errmsg):
        logger.warning(
            "Context overflow from provider (%s), converting for summarization fallback",
            error_str[:120],
        )
        raise lm_base.OpenAIContextOverflowError(
            message=e.message,
            response=e.response,
            body=e.body,
        ) from e

    return _original_handler(e)


def apply() -> None:
    """Apply the monkey-patch once at process startup."""
    global _applied
    if _applied:
        return
    lm_base._handle_openai_bad_request = _patched_handler
    _applied = True
    logger.info(
        "Patched langchain_openai._handle_openai_bad_request for DashScope"
    )
