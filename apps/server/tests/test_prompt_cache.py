"""Tests for OpenAI-compatible prompt cache injection."""

from __future__ import annotations

import pytest

from src.llm.prompt_cache import (
    apply_explicit_cache_markers,
    apply_prompt_cache_to_payload,
    compute_prompt_cache_key,
    is_local_llm_base_url,
    mark_system_message_cache_control,
    resolve_prompt_cache_strategy,
)


def test_is_local_llm_base_url() -> None:
    assert is_local_llm_base_url("http://127.0.0.1:12345/v1")
    assert is_local_llm_base_url("http://localhost:8080/v1")
    assert not is_local_llm_base_url("https://dashscope.aliyuncs.com/compatible-mode/v1")


def test_resolve_strategy_dashscope_explicit() -> None:
    assert (
        resolve_prompt_cache_strategy(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            provider_id="dashscope",
        )
        == "explicit"
    )


def test_resolve_strategy_local_off() -> None:
    assert (
        resolve_prompt_cache_strategy(
            base_url="http://127.0.0.1:12345/v1",
            provider_id="custom",
        )
        == "off"
    )


def test_resolve_strategy_deepseek_auto() -> None:
    assert (
        resolve_prompt_cache_strategy(
            base_url="https://api.deepseek.com/v1",
            provider_id="deepseek",
        )
        == "auto"
    )


def test_resolve_strategy_custom_cloud_auto() -> None:
    assert (
        resolve_prompt_cache_strategy(
            base_url="https://api.example.com/v1",
            provider_id="custom",
        )
        == "auto"
    )


def test_resolve_strategy_config_mode_explicit() -> None:
    assert (
        resolve_prompt_cache_strategy(
            base_url="https://api.example.com/v1",
            provider_id="custom",
            config_mode="explicit",
        )
        == "explicit"
    )


def test_resolve_strategy_config_mode_off_overrides_dashscope() -> None:
    assert (
        resolve_prompt_cache_strategy(
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            provider_id="dashscope",
            config_mode="off",
        )
        == "off"
    )


def test_resolve_strategy_siliconflow_auto() -> None:
    assert (
        resolve_prompt_cache_strategy(
            base_url="https://api.siliconflow.cn/v1",
            provider_id="siliconflow",
        )
        == "auto"
    )


def test_custom_cloud_auto_adds_key_only() -> None:
    system_text = "y" * 128
    payload = {
        "model": "some-model",
        "messages": [
            {"role": "system", "content": system_text},
            {"role": "user", "content": "hi"},
        ],
    }
    apply_prompt_cache_to_payload(payload, "auto")
    assert "prompt_cache_key" in payload
    assert isinstance(payload["messages"][0]["content"], str)


def test_resolve_strategy_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROMPT_CACHE_MODE", "explicit")
    assert (
        resolve_prompt_cache_strategy(
            base_url="http://127.0.0.1:12345/v1",
            provider_id="custom",
        )
        == "explicit"
    )
    monkeypatch.delenv("PROMPT_CACHE_MODE", raising=False)


def test_mark_system_message_string_content() -> None:
    marked = mark_system_message_cache_control(
        {"role": "system", "content": "你是助手。"}
    )
    assert isinstance(marked["content"], list)
    block = marked["content"][0]
    assert block["type"] == "text"
    assert block["text"] == "你是助手。"
    assert block["cache_control"] == {"type": "ephemeral"}


def _has_marker(msg: dict) -> bool:
    content = msg.get("content")
    if isinstance(content, list):
        return any(
            isinstance(b, dict) and b.get("cache_control") == {"type": "ephemeral"}
            for b in content
        )
    return msg.get("cache_control") == {"type": "ephemeral"}


def test_apply_explicit_cache_markers_first_system_and_tail() -> None:
    # system_and_3: system prefix + the last non-system message(s) both cached.
    messages = [
        {"role": "system", "content": "静态前缀"},
        {"role": "user", "content": "你好"},
    ]
    out = apply_explicit_cache_markers(messages)
    assert out[0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    # tail message now also carries a breakpoint so growing history is cacheable
    assert _has_marker(out[1])


def test_apply_explicit_cache_markers_tail_last_three() -> None:
    # 1 system + 5 turns; breakpoints = system + last 3 non-system (cap 4 total).
    messages = [
        {"role": "system", "content": "静态前缀"},
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
        {"role": "user", "content": "q3"},
    ]
    out = apply_explicit_cache_markers(messages)
    marked = [i for i, m in enumerate(out) if _has_marker(m)]
    # system(0) + last 3 non-system (indices 3,4,5)
    assert 0 in marked
    assert marked == [0, 3, 4, 5]
    # at most 4 breakpoints (provider hard limit)
    assert len(marked) <= 4


def test_apply_explicit_cache_markers_caps_at_four() -> None:
    # 1 system + 10 user turns → at most 4 breakpoints total.
    messages = [{"role": "system", "content": "前缀"}]
    messages += [{"role": "user", "content": f"q{i}"} for i in range(10)]
    out = apply_explicit_cache_markers(messages)
    marked = [i for i, m in enumerate(out) if _has_marker(m)]
    assert len(marked) == 4
    assert marked[0] == 0  # system always cached
    assert marked[-1] == len(out) - 1  # newest message cached


def test_apply_prompt_cache_openai_auto_adds_key() -> None:
    system_text = "x" * 128
    payload = {
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": system_text},
            {"role": "user", "content": "hi"},
        ],
    }
    apply_prompt_cache_to_payload(payload, "auto")
    assert "prompt_cache_key" in payload
    assert payload["prompt_cache_key"].startswith("boban-")


def test_apply_prompt_cache_deepseek_auto_no_key() -> None:
    system_text = "x" * 128
    payload = {
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": system_text}],
    }
    apply_prompt_cache_to_payload(payload, "auto")
    assert "prompt_cache_key" not in payload


def test_compute_prompt_cache_key_too_short() -> None:
    assert compute_prompt_cache_key("short") is None


def test_compute_prompt_cache_key_includes_summary_fingerprint() -> None:
    system_text = "x" * 128
    key_plain = compute_prompt_cache_key(system_text)
    key_with_summary = compute_prompt_cache_key(
        system_text,
        compression_fingerprint="abc123",
    )
    assert key_plain is not None
    assert key_with_summary is not None
    assert key_plain != key_with_summary


def test_apply_explicit_cache_markers_summary_boundary() -> None:
    messages = [
        {"role": "system", "content": "静态前缀"},
        {
            "role": "user",
            "content": "这是对话摘要内容" * 50,
            "additional_kwargs": {"lc_source": "summarization"},
        },
        {"role": "user", "content": "最新问题"},
    ]
    out = apply_explicit_cache_markers(messages)
    # system prefix cached
    assert out[0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    # summary block cached (stable rolled-up prefix)
    assert out[1]["content"][0]["cache_control"] == {"type": "ephemeral"}
    # newest message now also cached as the tail breakpoint
    assert _has_marker(out[2])


def test_apply_prompt_cache_auto_summary_fingerprint_changes_key() -> None:
    system_text = "x" * 128
    base = {
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": system_text},
            {"role": "user", "content": "hi"},
        ],
    }
    payload_plain = dict(base)
    apply_prompt_cache_to_payload(payload_plain, "auto")
    payload_summary = {
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": system_text},
            {
                "role": "user",
                "content": "rolled up summary" * 20,
                "additional_kwargs": {"lc_source": "summarization"},
            },
            {"role": "user", "content": "hi"},
        ],
    }
    apply_prompt_cache_to_payload(payload_summary, "auto")
    assert payload_plain["prompt_cache_key"] != payload_summary["prompt_cache_key"]


def test_prompt_cache_chat_model_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROMPT_CACHE_MODE", "explicit")
    from langchain_core.messages import HumanMessage, SystemMessage

    from src.llm.factory import build_chat_model

    model = build_chat_model(
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        apply_profile=False,
    )
    payload = model._get_request_payload(
        [
            SystemMessage(content="静态 system 提示词" * 200),
            HumanMessage(content="你好"),
        ]
    )
    system = payload["messages"][0]
    assert system["role"] == "system"
    assert system["content"][0]["cache_control"] == {"type": "ephemeral"}
    monkeypatch.delenv("PROMPT_CACHE_MODE", raising=False)


def test_prompt_cache_off_for_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROMPT_CACHE_MODE", raising=False)
    monkeypatch.delenv("PROMPT_CACHE_ENABLED", raising=False)
    from langchain_core.messages import HumanMessage, SystemMessage

    from src.llm.factory import build_chat_model

    model = build_chat_model(
        base_url="http://127.0.0.1:12345/v1",
        apply_profile=False,
    )
    assert model.prompt_cache_strategy == "off"
    payload = model._get_request_payload(
        [SystemMessage(content="静态"), HumanMessage(content="你好")]
    )
    assert payload["messages"][0]["content"] == "静态"
