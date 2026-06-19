"""LLM httpx timeout 解耦测试。

read 超时设为 180s（有限，与 agent_chunk_timeout 对齐）：命令耗时由 shell 超时转后台
承接，read 回归 chunk 间隙语义。connect/write/pool 也有限，不放大。
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


def test_read_timeout_is_finite_180_others_finite() -> None:
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
