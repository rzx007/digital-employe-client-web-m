"""Session-scoped conversation history offload + project compression hooks."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from deepagents.middleware.summarization import (
    SUMMARIZATION_SYSTEM_PROMPT,
    SummarizationMiddleware,
    SummarizationToolMiddleware,
)
from langchain.agents.middleware.types import ExtendedModelResponse, ModelRequest, ModelResponse
from langgraph.config import get_config

from src.core.config import get_settings
from src.service.model_context import (
    resolve_max_input_tokens,
    resolve_summarization_token_threshold,
)

logger = logging.getLogger(__name__)

CHECKPOINT_COMPACT_TOOL_PROMPT = (
    SUMMARIZATION_SYSTEM_PROMPT
    + """

Also call `compact_conversation` proactively when:
- A delegated sub-task has finished and older tool traces are no longer needed for the current goal
- The user clearly switches to an unrelated new task or says to ignore prior context
"""
)


class ConversationSummarizationMiddleware(SummarizationMiddleware):
    """Summarization with session history path + API usage / checkpoint triggers."""

    use_session_history_file: bool = False

    def _get_history_path(self) -> str:
        if self.use_session_history_file:
            return f"{self._history_path_prefix}/history.md"
        return super()._get_history_path()

    @staticmethod
    def _read_run_configurable() -> dict[str, Any]:
        try:
            config = get_config()
            configurable = config.get("configurable")
            return configurable if isinstance(configurable, dict) else {}
        except RuntimeError:
            return {}

    def _should_summarize(self, messages: list[Any], total_tokens: int) -> bool:
        configurable = self._read_run_configurable()
        reason = configurable.get("context_compact_reason")

        if configurable.get("force_context_compact"):
            logger.info(
                "summarization checkpoint: force compact reason=%s thread=%s",
                reason,
                configurable.get("thread_id"),
            )
            return True

        last_reported = configurable.get("last_reported_input_tokens")
        if isinstance(last_reported, int) and last_reported > 0:
            settings = get_settings()
            threshold = resolve_summarization_token_threshold(settings)
            if last_reported >= threshold:
                logger.info(
                    "summarization: API usage %s >= threshold %s, triggering compact",
                    last_reported,
                    threshold,
                )
                return True
            # Calibrate approximate counter when API says we're close
            pre_trigger = int(threshold * 0.92)
            if last_reported >= pre_trigger and total_tokens >= pre_trigger:
                if super()._should_summarize(messages, total_tokens):
                    logger.info(
                        "summarization: API-calibrated compact "
                        "(reported=%s approx=%s threshold=%s)",
                        last_reported,
                        total_tokens,
                        threshold,
                    )
                    return True

        return super()._should_summarize(messages, total_tokens)

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse | ExtendedModelResponse:
        response = super().wrap_model_call(request, handler)
        if isinstance(response, ExtendedModelResponse):
            configurable = self._read_run_configurable()
            logger.info(
                "context compact applied: reason=%s thread=%s",
                configurable.get("context_compact_reason") or "token_threshold",
                configurable.get("thread_id"),
            )
        return response

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse | ExtendedModelResponse:
        response = await super().awrap_model_call(request, handler)
        if isinstance(response, ExtendedModelResponse):
            configurable = self._read_run_configurable()
            logger.info(
                "context compact applied: reason=%s thread=%s",
                configurable.get("context_compact_reason") or "token_threshold",
                configurable.get("thread_id"),
            )
        return response


class ConversationSummarizationToolMiddleware(SummarizationToolMiddleware):
    """compact_conversation tool with project-specific usage nudges."""

    def __init__(
        self,
        summarization: ConversationSummarizationMiddleware,
        *,
        system_prompt: str | None = CHECKPOINT_COMPACT_TOOL_PROMPT,
    ) -> None:
        super().__init__(summarization, system_prompt=system_prompt)
