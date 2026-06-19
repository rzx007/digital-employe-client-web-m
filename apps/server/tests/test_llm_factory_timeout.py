"""LLM httpx timeout 解耦测试。

read 超时设为 None（无限）：长命令/长任务期间「两个 chunk 之间」的空闲不再被
底层 HTTP 误杀，判「模型挂死」交给应用层活动看门狗 + 900s no_content watchdog。
connect/write/pool 仍有限，不放大。
"""

from __future__ import annotations

import httpx

from src.llm.factory import build_chat_model


def _resolve_timeout(chat: object) -> httpx.Timeout:
    """从构建好的 ChatOpenAI 上取回传入的 httpx.Timeout。

    langchain 在 ChatOpenAI 上把 timeout 存到 request_timeout 字段。
    """
    t = getattr(chat, "timeout", None)
    if isinstance(t, httpx.Timeout):
        return t
    rt = getattr(chat, "request_timeout", None)
    assert isinstance(rt, httpx.Timeout), (
        f"无法定位 httpx.Timeout：timeout={t!r} request_timeout={rt!r}"
    )
    return rt


def test_read_timeout_is_none_others_finite() -> None:
    chat = build_chat_model(
        model="deepseek-chat",
        api_key="test-key",
        base_url="http://localhost:12345/v1",
        apply_profile=False,
    )
    t = _resolve_timeout(chat)
    assert t.read == 180.0
    assert t.connect is not None and t.connect <= 12.0
    assert t.write is not None
    assert t.pool is not None
