from __future__ import annotations

from src.service.stream_progress_store import FileStreamProgressStore


def test_write_read_roundtrip(tmp_path):
    store = FileStreamProgressStore(tmp_path)
    store.write(
        message_id=7, conversation_id=3, state="streaming", cursor=12, content="hi"
    )
    got = store.read(7)
    assert got == {"stream_state": "streaming", "stream_cursor": 12, "content": "hi"}


def test_read_missing_returns_none(tmp_path):
    store = FileStreamProgressStore(tmp_path)
    assert store.read(999) is None


def test_delete_removes_file(tmp_path):
    store = FileStreamProgressStore(tmp_path)
    store.write(message_id=7, conversation_id=3, state="streaming", cursor=1, content="x")
    store.delete(7)
    assert store.read(7) is None


def test_delete_missing_is_noop(tmp_path):
    store = FileStreamProgressStore(tmp_path)
    store.delete(12345)  # 不抛


def test_partial_update_preserves_content(tmp_path):
    store = FileStreamProgressStore(tmp_path)
    store.write(message_id=7, conversation_id=3, state="streaming", cursor=1, content="abc")
    store.write(message_id=7, conversation_id=3, state="streaming", cursor=2, content=None)
    got = store.read(7)
    assert got["content"] == "abc"
    assert got["stream_cursor"] == 2


def test_atomic_write_no_tmp_left(tmp_path):
    store = FileStreamProgressStore(tmp_path)
    store.write(message_id=7, conversation_id=3, state="streaming", cursor=1, content="x")
    # 原子 replace 后不应残留 .tmp
    assert not list(tmp_path.glob("*.tmp"))
