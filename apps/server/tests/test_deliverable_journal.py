from pathlib import Path

from src.service.agent import deliverable_journal as dj


def _norm(p: str) -> str:
    # Mirror the implementation's normalization so assertions are correct on
    # every platform (on Windows the literal "/proj/..." resolves to a
    # drive-prefixed path).
    return Path(p).resolve().as_posix()


def test_record_dedup_and_action_merge():
    conv = 9001
    dj.begin(conv)
    dj.record(conv, "/proj/artifacts/a.md", "create")
    dj.record(conv, "/proj/artifacts/a.md", "modify")  # 同文件再改 → 仍算 create
    dj.record(conv, "/proj/artifacts/b.csv", "modify")
    out = dj.snapshot_and_clear(conv)
    by_path = {o["path"]: o["action"] for o in out}
    assert by_path == {
        _norm("/proj/artifacts/a.md"): "create",
        _norm("/proj/artifacts/b.csv"): "modify",
    }
    # 取走后清空
    assert dj.snapshot_and_clear(conv) == []


def test_begin_resets_stale():
    conv = 9002
    dj.record(conv, "/proj/artifacts/old.md", "create")  # 无 begin 的残留
    dj.begin(conv)  # 重置
    dj.record(conv, "/proj/artifacts/new.md", "create")
    out = dj.snapshot_and_clear(conv)
    assert [o["path"] for o in out] == [_norm("/proj/artifacts/new.md")]


def test_none_conversation_is_noop():
    dj.begin(None)
    dj.record(None, "/x/y.md", "create")  # 不崩
    assert dj.snapshot_and_clear(None) == []
