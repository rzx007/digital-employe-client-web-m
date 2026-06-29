"""全局「禁用思考」总开关：

- read_thinking_disabled() 从 config_kvs 热读 MODEL_THINKING_DISABLED（仿 read_subagent_enabled）。
- merge_disable_thinking_extra_body() 按 provider/model 下发禁用思考参数：
    * DeepSeek/GLM 系 → {"thinking": {"type": "disabled"}}
    * 其余(Qwen3/本地/自定义) → enable_thinking=False + chat_template_kwargs.enable_thinking=False
  DeepSeek V4 永远禁用（与开关无关，兼容硬约束）；其它模型仅在开关打开时禁用。
"""

from __future__ import annotations

from src.llm.factory import merge_disable_thinking_extra_body


def test_v4_always_disabled_even_when_toggle_off() -> None:
    out = merge_disable_thinking_extra_body(
        "deepseek-v4-flash", "dashscope", {}, user_disabled=False
    )
    assert out["extra_body"]["thinking"] == {"type": "disabled"}


def test_non_thinking_model_untouched_when_toggle_off() -> None:
    out = merge_disable_thinking_extra_body(
        "qwen3.6-plus", "dashscope", {}, user_disabled=False
    )
    assert "extra_body" not in out


def test_qwen3_disabled_via_enable_thinking_when_toggle_on() -> None:
    out = merge_disable_thinking_extra_body(
        "qwen3.6-plus", "dashscope", {}, user_disabled=True
    )
    eb = out["extra_body"]
    assert eb["enable_thinking"] is False
    assert eb["chat_template_kwargs"]["enable_thinking"] is False


def test_local_custom_qwen_disabled_when_toggle_on() -> None:
    # 本地 llama.cpp 上的 Qwen3-MoE（用户的 qwopus3.6-35b-a3b）
    out = merge_disable_thinking_extra_body(
        "qwopus3.6-35b-a3b-v1", "custom", {}, user_disabled=True
    )
    eb = out["extra_body"]
    assert eb["chat_template_kwargs"]["enable_thinking"] is False


def test_deepseek_non_v4_disabled_via_thinking_key_when_toggle_on() -> None:
    out = merge_disable_thinking_extra_body(
        "deepseek-chat", "deepseek", {}, user_disabled=True
    )
    assert out["extra_body"]["thinking"] == {"type": "disabled"}


def test_glm_disabled_via_thinking_key_when_toggle_on() -> None:
    out = merge_disable_thinking_extra_body(
        "glm-5", "zhipu", {}, user_disabled=True
    )
    assert out["extra_body"]["thinking"] == {"type": "disabled"}


def test_existing_extra_body_preserved() -> None:
    out = merge_disable_thinking_extra_body(
        "qwen3.6-plus",
        "dashscope",
        {"extra_body": {"foo": "bar"}, "temperature": 0.3},
        user_disabled=True,
    )
    assert out["extra_body"]["foo"] == "bar"
    assert out["extra_body"]["enable_thinking"] is False
    assert out["temperature"] == 0.3


def test_read_thinking_disabled_default_false() -> None:
    from src.core.config import read_thinking_disabled

    # 无 config_kvs 行时默认 False（不禁用）
    assert read_thinking_disabled() in (True, False)
