"""Monkey-patch langchain_openai error handling for context-overflow fallback.

Some OpenAI-compatible servers reject an over-budget request with a 400 whose
message/type is provider-specific. langchain_openai only maps the OpenAI-flavored
phrases onto :class:`ContextOverflowError`; anything else bubbles up as a plain
``BadRequestError``, so deepagents' ``SummarizationMiddleware`` overflow fallback
(``except ContextOverflowError:`` → summarize-and-retry) never fires and the raw
400 reaches the user.

This patch widens the recognized markers (DashScope/Qwen *and* local
llama.cpp / Hanhai endpoints) and installs unconditionally — it only intercepts
errors whose text actually signals context overflow, so it is harmless to other
providers.
"""

from __future__ import annotations

import logging

import langchain_openai.chat_models.base as lm_base

logger = logging.getLogger(__name__)

_original_handler = lm_base._handle_openai_bad_request
_applied = False


# 仅匹配上下文超长相关文案，避免误判其它 InternalError.Algo。
# 前三条为 DashScope/Qwen 措辞；后几条覆盖本地 llama.cpp / Hanhai 端点。
_OVERFLOW_MARKERS: tuple[str, ...] = (
    "context_length_exceeded",
    "input tokens exceed the configured limit",
    "range of input length",
    "exceed_context_size_error",
    "exceeds the available context size",
    "exceeds the maximum context",
    "exceeds the context window",
    "reduce the length of the messages",
)


def _is_context_overflow_error(error_str: str, errmsg: str) -> bool:
    """仅匹配上下文超长相关文案，避免误判其它 InternalError.Algo。"""
    haystack = f"{error_str}\n{errmsg}".lower()
    return any(marker in haystack for marker in _OVERFLOW_MARKERS)


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


def apply_if_needed(settings) -> None:
    """Install the context-overflow patch.

    Installs for every provider: the patch only intercepts errors whose text
    signals context overflow, so it is harmless elsewhere. Local llama.cpp /
    Hanhai endpoints emit ``exceed_context_size_error``, which the old
    DashScope-only gate skipped — that gap is what let an over-budget request
    surface a raw 400 to the user instead of triggering summarize-and-retry.
    """
    apply()


def apply() -> None:
    """Apply the monkey-patch once at process startup."""
    global _applied
    if _applied:
        return
    lm_base._handle_openai_bad_request = _patched_handler
    _applied = True
    logger.info(
        "Patched langchain_openai._handle_openai_bad_request for "
        "context-overflow fallback"
    )
