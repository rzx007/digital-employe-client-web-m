from __future__ import annotations

from src.service.agent.shell_execute_tool import (
    ShellExecuteInput,
    normalize_shell_intent,
)


def test_normalize_shell_intent_strips_quotes() -> None:
    intent = normalize_shell_intent('"安装python-pptx和Pillow"')
    assert intent == "安装python-pptx和Pillow"
    assert len(intent or "") == 20


def test_normalize_shell_intent_truncates_when_too_long() -> None:
    assert normalize_shell_intent("a" * 25) == "a" * 20


def test_shell_execute_input_accepts_quoted_intent() -> None:
    parsed = ShellExecuteInput(
        command="pip install python-pptx Pillow",
        intent='"安装python-pptx和Pillow"',
    )
    assert parsed.intent == "安装python-pptx和Pillow"
