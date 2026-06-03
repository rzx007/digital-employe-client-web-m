"""历史"保头+保尾、压中间"截断 + 前缀稳定性自检。

守住：历史超限时不再"减半重载"丢最早几条（那会平移 [system][早段 history] 前缀、
砸 KV-cache）。改为保留最早 keep_head 条 + 最近若干条，使前缀字节稳定。
对应《提示词与上下文排序》§4 第2层「开发期前缀稳定性自检」。
"""

from __future__ import annotations

from src.service.chat_service import ChatService

_sel = ChatService._select_head_tail


def _msgs(n: int) -> list[dict]:
    return [{"role": "user", "content": f"m{i}"} for i in range(n)]


def test_head_tail_basic_selection() -> None:
    out = _sel(_msgs(30), limit=15, keep_head=4)
    assert len(out) == 15
    # 最早 4 条（头）
    assert [m["content"] for m in out[:4]] == ["m0", "m1", "m2", "m3"]
    # 最近 11 条（尾）
    assert [m["content"] for m in out[4:]] == [f"m{i}" for i in range(19, 30)]


def test_prefix_stable_across_shrinking_limits() -> None:
    """核心性质：无论窗口收缩到多大，最早 keep_head 条（前缀）恒定不变。"""
    msgs = _msgs(40)
    heads = [
        tuple(m["content"] for m in _sel(msgs, limit=lim, keep_head=4)[:4])
        for lim in (30, 20, 15, 8)
    ]
    # 所有收缩档位的"头"完全一致 → 前缀字节稳定
    assert len(set(heads)) == 1
    assert heads[0] == ("m0", "m1", "m2", "m3")


def test_no_truncation_when_within_limit() -> None:
    msgs = _msgs(10)
    assert _sel(msgs, limit=15, keep_head=4) is msgs  # 原样返回，不复制


def test_keep_head_capped_by_limit() -> None:
    out = _sel(_msgs(30), limit=3, keep_head=4)
    assert [m["content"] for m in out] == ["m0", "m1", "m2"]  # keep_head 被 limit 截住


def test_zero_and_negative_limit() -> None:
    assert _sel(_msgs(30), limit=0, keep_head=4) == []
    assert _sel(_msgs(30), limit=-1, keep_head=4) == []


def test_keep_head_zero_is_pure_tail() -> None:
    out = _sel(_msgs(30), limit=5, keep_head=0)
    assert [m["content"] for m in out] == [f"m{i}" for i in range(25, 30)]
