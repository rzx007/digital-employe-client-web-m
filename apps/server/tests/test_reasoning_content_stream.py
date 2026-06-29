"""reasoning_content 链路（Gap B 生产端）：

base ChatOpenAI 默认丢弃 provider 专有的 reasoning_content（DeepSeek/Qwen3 思考增量），
PromptCacheChatOpenAI 覆写 _convert_chunk_to_generation_chunk 把它补进 additional_kwargs，
再由 convert_to_serializable（langchain dumps）带上 SSE 线供前端解析。
"""

from __future__ import annotations

from langchain_core.messages import AIMessageChunk

from src.llm.cache_chat_model import PromptCacheChatOpenAI
from src.service.chat_service import ChatService


def _model() -> PromptCacheChatOpenAI:
    return PromptCacheChatOpenAI(
        model="deepseek-v4-flash",
        api_key="test-key",
        base_url="http://localhost:9999/v1",
    )


def test_reasoning_content_captured_into_additional_kwargs() -> None:
    chunk = {
        "choices": [
            {
                "delta": {"content": "", "reasoning_content": "先想一想"},
                "finish_reason": None,
            }
        ]
    }
    gen = _model()._convert_chunk_to_generation_chunk(chunk, AIMessageChunk, None)
    assert gen is not None
    assert gen.message.additional_kwargs.get("reasoning_content") == "先想一想"


def test_plain_content_chunk_has_no_reasoning() -> None:
    chunk = {"choices": [{"delta": {"content": "正文"}, "finish_reason": None}]}
    gen = _model()._convert_chunk_to_generation_chunk(chunk, AIMessageChunk, None)
    assert gen is not None
    assert "reasoning_content" not in gen.message.additional_kwargs


def test_no_choices_chunk_does_not_crash() -> None:
    # usage-only / 空 choices 的收尾 chunk 不应因覆写而炸
    chunk = {"choices": [], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
    gen = _model()._convert_chunk_to_generation_chunk(chunk, AIMessageChunk, None)
    # 返回 None 或一个不带 reasoning 的 chunk 都可接受，关键是不抛异常
    if gen is not None:
        assert "reasoning_content" not in gen.message.additional_kwargs


def test_convert_to_serializable_preserves_reasoning_content() -> None:
    chunk = AIMessageChunk(
        content="", additional_kwargs={"reasoning_content": "想"}
    )
    out = ChatService.convert_to_serializable(chunk)
    kwargs = out["kwargs"]
    assert kwargs["additional_kwargs"]["reasoning_content"] == "想"
