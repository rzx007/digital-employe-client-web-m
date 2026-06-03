"""ChatOpenAI subclass that injects OpenAI-compatible prompt cache markers."""

from __future__ import annotations

from typing import Any

from langchain_core.language_models import LanguageModelInput
from langchain_openai import ChatOpenAI

from src.llm.prompt_cache import (
    PromptCacheStrategy,
    apply_prompt_cache_to_payload,
    resolve_prompt_cache_strategy,
)


class PromptCacheChatOpenAI(ChatOpenAI):
    """Inject provider-appropriate prompt cache hints into chat-completions payloads."""

    prompt_cache_strategy: PromptCacheStrategy = "off"

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        if self.prompt_cache_strategy != "off":
            apply_prompt_cache_to_payload(payload, self.prompt_cache_strategy)
        return payload


def build_prompt_cache_strategy(
    *,
    base_url: str | None,
    provider_id: str | None,
    config_mode: str | None = None,
) -> PromptCacheStrategy:
    return resolve_prompt_cache_strategy(
        base_url=base_url,
        provider_id=provider_id,
        config_mode=config_mode,
    )
