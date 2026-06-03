"""Unified context compression settings for deepagents summarization stack.

Pipeline order (each LLM call, outer → inner):

1. ``ChatService._load_history_for_agent`` + ``_select_head_tail`` — DB 条数级保头保尾
2. ``OpenAICompatibleFilesystemMiddleware.wrap_model_call`` — ``read_file`` 同路径占位去重 + 历史大块只留路径（§C）
3. ``SummarizationMiddleware.wrap_model_call`` — 大 tool args 截断 → token 阈值 → LLM 摘要
4. ``PromptCacheChatOpenAI._get_request_payload`` — system + 摘要指纹 → cache 断点 / key

See ``docs/token-usage-compression-improvement.md`` and ``docs/提示词治理-问答整理.html`` §3.7.
"""

from __future__ import annotations

from typing import Any

from langchain_openai import ChatOpenAI

from src.core.config import Settings
from src.service.conversation_summarization import (
    ConversationSummarizationMiddleware,
    ConversationSummarizationToolMiddleware,
)
from src.service.model_context import (
    resolve_summarization_keep,
    resolve_summarization_trigger,
)

# Lighter than full summarization (default 0.75): clip old write_file / execute args first.
DEFAULT_TRUNCATE_ARGS_TRIGGER_FRACTION = 0.50
DEFAULT_TRUNCATE_ARGS_MAX_LENGTH = 2000
DEFAULT_TRUNCATE_ARGS_SUFFIX = "...(argument truncated)"


def resolve_truncate_args_settings(settings: Settings) -> dict[str, Any]:
    """Pre-summarization tool-argument truncation (deepagents truncate_args_settings)."""
    return {
        "trigger": ("fraction", DEFAULT_TRUNCATE_ARGS_TRIGGER_FRACTION),
        "keep": resolve_summarization_keep(settings),
        "max_length": DEFAULT_TRUNCATE_ARGS_MAX_LENGTH,
        "truncation_text": DEFAULT_TRUNCATE_ARGS_SUFFIX,
    }


def build_summarization_middleware_stack(
    *,
    model: ChatOpenAI,
    backend: Any,
    settings: Settings,
    use_session_history_file: bool = False,
) -> tuple[ConversationSummarizationMiddleware, ConversationSummarizationToolMiddleware]:
    """Create summarization + compact_conversation tool middleware with project defaults."""
    summarization_mw = ConversationSummarizationMiddleware(
        model=model,
        backend=backend,
        trigger=resolve_summarization_trigger(settings),
        keep=resolve_summarization_keep(settings),
        truncate_args_settings=resolve_truncate_args_settings(settings),
    )
    summarization_mw.use_session_history_file = use_session_history_file
    tool_mw = ConversationSummarizationToolMiddleware(summarization_mw)
    return summarization_mw, tool_mw
