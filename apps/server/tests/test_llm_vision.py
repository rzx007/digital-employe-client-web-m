"""Vision model detection tests."""

from src.llm.vision import is_vision_capable_model


def test_vision_models_detected() -> None:
    assert is_vision_capable_model("qwen-vl-max")
    assert is_vision_capable_model("qwen2.5-vl-72b-instruct")
    assert is_vision_capable_model("gpt-4o")
    assert is_vision_capable_model("gpt-4o-mini")
    assert is_vision_capable_model("glm-4v-flash")


def test_text_models_not_vision() -> None:
    assert not is_vision_capable_model("qwen2.5-72b-instruct")
    assert not is_vision_capable_model("deepseek-v4-flash")
    assert not is_vision_capable_model("deepseek-chat")
    assert not is_vision_capable_model("")
