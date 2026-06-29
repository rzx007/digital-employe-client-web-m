"""Session-scoped conversation history offload + project compression hooks."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, NotRequired

from deepagents.middleware.summarization import (
    SUMMARIZATION_SYSTEM_PROMPT,
    SummarizationEvent,
    SummarizationMiddleware,
    SummarizationState,
    SummarizationToolMiddleware,
)
from langchain.agents.middleware.types import (
    ExtendedModelResponse,
    ModelRequest,
    ModelResponse,
    PrivateStateAttr,
)
from langgraph.config import get_config

from src.core.config import get_settings
from src.service.model_context import (
    resolve_max_input_tokens,
    resolve_summarization_token_threshold,
)

logger = logging.getLogger(__name__)


def _merge_summarization_event(
    left: SummarizationEvent | None,
    right: SummarizationEvent | None,
) -> SummarizationEvent | None:
    # deepagents 0.6.7 ships `_summarization_event` without a reducer, so two
    # writers landing in the same superstep (multiple `compact_conversation`
    # tool calls in one assistant turn, or wrap_model_call + tool call
    # converging) trip langgraph INVALID_CONCURRENT_GRAPH_UPDATE. Take the
    # event with the higher cutoff_index — that's the more recent compaction.
    if right is None:
        return left
    if left is None:
        return right
    return right if right.get("cutoff_index", 0) >= left.get("cutoff_index", 0) else left


class _PatchedSummarizationState(SummarizationState):
    _summarization_event: Annotated[
        NotRequired[SummarizationEvent | None],
        PrivateStateAttr,
        _merge_summarization_event,
    ]


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

    state_schema = _PatchedSummarizationState
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
            # 用户显式要求（换话题/重开/meta）无条件尊重——这是"清空重来"语义。
            # 但自动检查点（delegation_completed / topic_change 启发式）很频繁：总管
            # 每派完一个子任务就标记一次 pending compact，若无条件压，会在略大于 keep
            # 窗口的上下文上反复压缩、抖缓存、刷屏「上下文总结」。故自动检查点要求当前
            # 真实体量达到最低门槛（0.5×阈值，与 deepagents compact 工具的 eligibility
            # 一致）才强压；不到门槛就放行，落到下面按真实大小判定。
            if reason == "user_requested":
                logger.info(
                    "summarization checkpoint: force compact reason=%s thread=%s",
                    reason,
                    configurable.get("thread_id"),
                )
                return True
            settings = get_settings()
            floor = int(resolve_summarization_token_threshold(settings) * 0.5)
            if total_tokens >= floor:
                logger.info(
                    "summarization checkpoint: force compact reason=%s "
                    "total=%s floor=%s thread=%s",
                    reason,
                    total_tokens,
                    floor,
                    configurable.get("thread_id"),
                )
                return True
            logger.info(
                "summarization checkpoint: force compact reason=%s skipped, "
                "context small (total=%s < floor=%s) thread=%s",
                reason,
                total_tokens,
                floor,
                configurable.get("thread_id"),
            )

        last_reported = configurable.get("last_reported_input_tokens")
        if isinstance(last_reported, int) and last_reported > 0:
            settings = get_settings()
            threshold = resolve_summarization_token_threshold(settings)
            # API 报告的上一轮 input 用来触发压缩，但**必须有"当前真实体量"佐证**。
            # last_reported 是上一轮落库的峰值（stream_registry._extract_peak_usage_from_buffer），
            # 压缩后它仍可能 >= 阈值（尤其总管：系统提示词+工具基线本身就大），若仅凭这个
            # 陈旧峰值就 return True，会把刚压过、现已很小的上下文一轮一轮反复再压（死循环）。
            # 故要求当前近似 total_tokens 也进入触发带，确认上下文确实还很大才压；否则交给
            # 下面的 super()._should_summarize 按真实大小判定。
            pre_trigger = int(threshold * 0.92)
            if total_tokens >= pre_trigger and last_reported >= pre_trigger:
                logger.info(
                    "summarization: API-corroborated compact "
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

    state_schema = _PatchedSummarizationState

    def __init__(
        self,
        summarization: ConversationSummarizationMiddleware,
        *,
        system_prompt: str | None = CHECKPOINT_COMPACT_TOOL_PROMPT,
    ) -> None:
        super().__init__(summarization, system_prompt=system_prompt)
