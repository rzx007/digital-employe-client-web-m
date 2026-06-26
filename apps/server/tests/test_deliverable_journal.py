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


def test_report_file_write_action_mapping():
    conv = 9200
    dj.begin(conv)
    dj.report_file_write(conv, "/proj/artifacts/new.md", existed_before=False, is_edit=False)   # → create
    dj.report_file_write(conv, "/proj/artifacts/old.md", existed_before=True, is_edit=False)    # → modify
    dj.report_file_write(conv, "/proj/artifacts/ed.md", existed_before=True, is_edit=True)      # → modify
    out = {o["path"]: o["action"] for o in dj.snapshot_and_clear(conv)}
    norm = lambda s: __import__("pathlib").Path(s).resolve().as_posix()
    assert out[norm("/proj/artifacts/new.md")] == "create"
    assert out[norm("/proj/artifacts/old.md")] == "modify"
    assert out[norm("/proj/artifacts/ed.md")] == "modify"


def test_scan_tree_prunes_noise_dirs(tmp_path):
    # 噪音/隐藏目录下的文件应被剪枝排除,不出现在扫描结果里。
    root = tmp_path / "artifacts"
    root.mkdir()

    noise = root / "node_modules"
    noise.mkdir()
    (noise / "x.js").write_text("module.exports = {}", encoding="utf-8")

    hidden = root / ".git"
    hidden.mkdir()
    (hidden / "config").write_text("[core]", encoding="utf-8")

    # 对照:正常产物文件 + 隐藏文件(隐藏文件应保留,仅隐藏目录剪枝)
    (root / "report.md").write_text("# hi", encoding="utf-8")
    (root / ".env").write_text("KEY=1", encoding="utf-8")

    result = dj.scan_tree(root)
    paths = set(result)
    assert (noise / "x.js").resolve().as_posix() not in paths
    assert (hidden / "config").resolve().as_posix() not in paths
    assert (root / "report.md").resolve().as_posix() in paths
    assert (root / ".env").resolve().as_posix() in paths
