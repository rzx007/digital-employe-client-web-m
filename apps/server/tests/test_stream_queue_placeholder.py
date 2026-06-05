from types import SimpleNamespace

from src.service.stream_registry import (
    _clear_queue_placeholder_content,
    _is_queue_placeholder_content,
)


def test_is_queue_placeholder() -> None:
    assert _is_queue_placeholder_content("已加入执行队列，等待其他对话完成")
    assert _is_queue_placeholder_content("等待总管会话结束，即将开始执行…")
    assert not _is_queue_placeholder_content("正在撰写调研报告…")


def test_clear_queue_placeholder() -> None:
    msg = SimpleNamespace(content="已加入执行队列，等待其他对话完成")
    _clear_queue_placeholder_content(msg)
    assert msg.content == ""
