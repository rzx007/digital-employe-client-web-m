from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from src.service.conversation_title_service import (
    build_title_prompt,
    fallback_conversation_title,
    match_rule_title,
    normalize_title,
    suggest_conversation_title,
)


@pytest.mark.parametrize(
    "message,expected",
    [
        ("hi", "问候语"),
        ("Hello!", "问候语"),
        ("你好", "问候语"),
        ("在吗？", "问候语"),
        ("谢谢", "致谢"),
        ("thanks", "致谢"),
        ("再见", "告别"),
        ("test", "简单对话"),
        ("测试", "简单对话"),
    ],
)
def test_match_rule_title(message: str, expected: str) -> None:
    assert match_rule_title(message) == expected


def test_match_rule_title_returns_none_for_task_message() -> None:
    assert match_rule_title("帮我写一份周报") is None


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('  "周报撰写"  ', "周报撰写"),
        ("标题。\n", "标题"),
        ("", "新对话"),
        ("a" * 30, "a" * 20),
    ],
)
def test_normalize_title(raw: str, expected: str) -> None:
    assert normalize_title(raw) == expected


def test_build_title_prompt_contains_message() -> None:
    messages = build_title_prompt("帮我查销售数据")
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert "帮我查销售数据" in messages[1]["content"]


def test_fallback_conversation_title_truncates() -> None:
    long_text = "x" * 80
    assert len(fallback_conversation_title(long_text)) == 50


@patch("src.service.conversation_title_service._invoke_llm_title", return_value=None)
@patch("src.service.conversation_title_service._llm_configured", return_value=False)
def test_suggest_conversation_title_rule(_mock_cfg, _mock_llm) -> None:
    title, source = suggest_conversation_title("hi")
    assert title == "问候语"
    assert source == "rule"


@patch("src.service.conversation_title_service._invoke_llm_title", return_value="销售数据查询")
@patch("src.service.conversation_title_service._llm_configured", return_value=True)
def test_suggest_conversation_title_llm(_mock_cfg, _mock_llm) -> None:
    title, source = suggest_conversation_title("帮我查一下上季度销售数据")
    assert title == "销售数据查询"
    assert source == "llm"


@patch("src.service.conversation_title_service._invoke_llm_title", return_value=None)
@patch("src.service.conversation_title_service._llm_configured", return_value=True)
def test_suggest_conversation_title_fallback(_mock_cfg, _mock_llm) -> None:
    message = "这是一条没有命中规则且 LLM 失败的消息"
    title, source = suggest_conversation_title(message)
    assert source == "fallback"
    assert title == normalize_title(fallback_conversation_title(message))


@patch("src.llm.factory.build_chat_model")
@patch("src.service.conversation_title_service._llm_configured", return_value=True)
def test_invoke_llm_title_normalizes_quotes(mock_cfg, mock_build) -> None:
    mock_model = MagicMock()
    mock_model.invoke.return_value = MagicMock(content='"会议纪要整理"')
    mock_build.return_value = mock_model

    from src.service.conversation_title_service import _invoke_llm_title

    assert _invoke_llm_title("帮我整理会议纪要") == "会议纪要整理"


@patch(
    "src.llm.factory.build_chat_model",
    side_effect=RuntimeError("boom"),
)
@patch("src.service.conversation_title_service._llm_configured", return_value=True)
def test_invoke_llm_title_returns_none_on_error(mock_cfg, mock_build) -> None:
    from src.service.conversation_title_service import _invoke_llm_title

    assert _invoke_llm_title("帮我整理会议纪要") is None
