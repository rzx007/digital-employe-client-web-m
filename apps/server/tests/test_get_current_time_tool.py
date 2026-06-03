"""Tests for get_current_time tool."""

from src.service.agent.get_current_time_tool import (
    format_current_time,
    get_current_time,
    resolve_timezone_name,
)


def test_resolve_timezone_name_defaults_to_shanghai() -> None:
    assert resolve_timezone_name(None) == "Asia/Shanghai"
    assert resolve_timezone_name("") == "Asia/Shanghai"


def test_format_current_time_includes_datetime() -> None:
    text = format_current_time(timezone="Asia/Shanghai")
    assert "当前时间:" in text
    assert "Asia/Shanghai" in text
    assert len(text.split(":")) >= 3


def test_get_current_time_rejects_unknown_timezone() -> None:
    text = get_current_time("Not/A/Timezone")
    assert "未知时区" in text
