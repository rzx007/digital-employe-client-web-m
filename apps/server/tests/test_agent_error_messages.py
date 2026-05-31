"""Agent 错误文案中文化。"""

from src.service.agent.error_messages import format_agent_error_for_user


def test_connection_error_includes_model(monkeypatch) -> None:
    from src.core.config import get_settings
    from src.service.agent.error_messages import _active_model_label

    get_settings.cache_clear()
    model_label = _active_model_label()
    msg = format_agent_error_for_user("Connection error.")
    assert model_label in msg
    assert "无法连接" in msg


def test_tool_result_too_large_chinese() -> None:
    msg = format_agent_error_for_user(
        "Tool result too large, saved at /large_tool_results/abc"
    )
    assert "工具返回内容过大" in msg
    assert "update_employee" in msg
