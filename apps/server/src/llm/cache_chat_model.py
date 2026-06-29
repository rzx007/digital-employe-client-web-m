"""ChatOpenAI subclass that injects OpenAI-compatible prompt cache markers."""

from __future__ import annotations

from typing import Any

from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessageChunk
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

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict,
        default_chunk_class: type,
        base_generation_info: dict | None,
    ):
        """补回 base ChatOpenAI 丢弃的 reasoning_content（DeepSeek/Qwen3 思考增量）。

        官方 ChatOpenAI 只对接标准 OpenAI 字段，第三方的 reasoning_content 在
        _convert_delta_to_message_chunk 里被忽略。这里在标准转换后，把原始 delta 里的
        reasoning_content 增量补进 message.additional_kwargs，供 SSE 序列化带给前端
        渲染「思考过程」。逐 chunk 写入增量片段，前端按 text 流自行累积。
        """
        gen_chunk = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info
        )
        if gen_chunk is None:
            return None
        try:
            choices = chunk.get("choices") or chunk.get("chunk", {}).get(
                "choices", []
            )
            if choices:
                delta = choices[0].get("delta") or {}
                reasoning = delta.get("reasoning_content")
                if reasoning and isinstance(gen_chunk.message, AIMessageChunk):
                    gen_chunk.message.additional_kwargs["reasoning_content"] = (
                        reasoning
                    )
        except Exception:
            # reasoning 仅为展示增益，任何异常都不得影响正文流。
            pass
        return gen_chunk


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
