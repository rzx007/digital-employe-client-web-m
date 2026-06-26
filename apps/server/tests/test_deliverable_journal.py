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


def test_shell_delta_detects_new_and_modified(tmp_path):
    conv = 9100
    root = tmp_path / "artifacts"
    root.mkdir()
    existing = root / "keep.txt"
    existing.write_text("v1", encoding="utf-8")

    dj.begin(conv)
    before = dj.scan_tree(root)

    # 模拟 shell 写:新文件 + 改已有
    (root / "made_by_bash.csv").write_text("x,y\n1,2", encoding="utf-8")
    existing.write_text("v2-longer", encoding="utf-8")  # size 变化

    after = dj.scan_tree(root)
    dj.record_shell_delta(conv, before, after)

    out = {o["path"]: o["action"] for o in dj.snapshot_and_clear(conv)}
    assert out[(root / "made_by_bash.csv").resolve().as_posix()] == "create"
    assert out[existing.resolve().as_posix()] == "modify"


def test_shell_delta_skips_internal_scratch(tmp_path):
    conv = 9101
    root = tmp_path / "artifacts"
    root.mkdir()
    dj.begin(conv)
    before = dj.scan_tree(root)
    (root / "_agent_exec_123.py").write_text("print(1)", encoding="utf-8")
    after = dj.scan_tree(root)
    dj.record_shell_delta(conv, before, after)
    assert dj.snapshot_and_clear(conv) == []
