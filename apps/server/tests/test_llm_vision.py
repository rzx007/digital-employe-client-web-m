"""Vision model detection tests."""

from src.llm.registry import LlmModelEntry
from src.llm.vision import is_vision_capable_model


def test_vision_models_detected() -> None:
    assert is_vision_capable_model("qwen-vl-max", provider_id="dashscope")
    assert is_vision_capable_model("qwen3-vl-plus", provider_id="dashscope")
    assert is_vision_capable_model("qwen3.7-plus", provider_id="dashscope")
    assert is_vision_capable_model("qwen3.6-plus", provider_id="dashscope")
    assert is_vision_capable_model("qwen2.5-vl-72b-instruct")
    assert is_vision_capable_model("gpt-4o")
    assert is_vision_capable_model("gpt-4.1-mini", provider_id="openai")
    assert is_vision_capable_model("glm-4v-flash", provider_id="zhipu")
    assert is_vision_capable_model("glm-4.6v", provider_id="zhipu")
    assert is_vision_capable_model("glm-4.5v", provider_id="zhipu")
    assert is_vision_capable_model("kimi-k2.6", provider_id="dashscope")
    assert is_vision_capable_model("kimi-k2.5", provider_id="dashscope")
    assert is_vision_capable_model(
        "moonshot-v1-8k-vision-preview",
        provider_id="moonshot",
    )
    assert is_vision_capable_model(
        "Qwen/Qwen3-VL-32B-Instruct",
        provider_id="siliconflow",
    )
    assert is_vision_capable_model("Hanhai", provider_id="hanhai")


def test_text_models_not_vision() -> None:
    assert not is_vision_capable_model("qwen2.5-72b-instruct")
    assert not is_vision_capable_model("deepseek-v4-flash")
    assert not is_vision_capable_model("deepseek-chat")
    assert not is_vision_capable_model("qwen3.7-max", provider_id="dashscope")
    assert not is_vision_capable_model("glm-4.7", provider_id="zhipu")
    assert not is_vision_capable_model("some-revision-model")
    assert not is_vision_capable_model("")


def test_registry_override_takes_priority() -> None:
    entry = LlmModelEntry(id="gpt-4o", supports_vision=False)
    assert not is_vision_capable_model("gpt-4o", registry_entry=entry)

    entry_force = LlmModelEntry(id="qwen2.5-72b-instruct", supports_vision=True)
    assert is_vision_capable_model(
        "qwen2.5-72b-instruct",
        registry_entry=entry_force,
    )


def test_catalog_without_provider_falls_back_to_heuristic() -> None:
    assert is_vision_capable_model("qwen-vl-max")
    assert is_vision_capable_model("qwen3-vl-plus")
    assert not is_vision_capable_model("qwen3.7-max")
