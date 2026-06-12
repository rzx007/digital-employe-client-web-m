from __future__ import annotations

from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.memory import InMemorySaver

from src.service.agent.file_checkpointer import FileCheckpointSaver


def _cfg(thread_id: str, ns: str = ""):
    return {"configurable": {"thread_id": thread_id, "checkpoint_ns": ns}}


def test_put_then_get_tuple_roundtrip(tmp_path):
    saver = FileCheckpointSaver(tmp_path)
    chkpt = empty_checkpoint()
    cfg = saver.put(_cfg("t1"), chkpt, {"source": "input", "step": 0}, {})
    got = saver.get_tuple(cfg)
    assert got is not None
    assert got.checkpoint["id"] == chkpt["id"]
    assert got.metadata["step"] == 0


def test_put_writes_then_pending_writes(tmp_path):
    saver = FileCheckpointSaver(tmp_path)
    chkpt = empty_checkpoint()
    cfg = saver.put(_cfg("t1"), chkpt, {"source": "loop", "step": 1}, {})
    saver.put_writes(cfg, [("messages", "hello")], task_id="task-1")
    got = saver.get_tuple(cfg)
    assert ("task-1", "messages", "hello") in [
        (w[0], w[1], w[2]) for w in got.pending_writes
    ]


def test_replay_after_restart(tmp_path):
    s1 = FileCheckpointSaver(tmp_path)
    chkpt = empty_checkpoint()
    cfg = s1.put(_cfg("t1"), chkpt, {"source": "input", "step": 0}, {})
    s1.put_writes(cfg, [("messages", "hi")], task_id="task-1")
    # 全新实例同目录：只能靠 journal 重放
    s2 = FileCheckpointSaver(tmp_path)
    got = s2.get_tuple(cfg)
    assert got is not None
    assert got.checkpoint["id"] == chkpt["id"]
    assert any(w[1] == "messages" for w in got.pending_writes)


def test_delete_thread_removes_file(tmp_path):
    saver = FileCheckpointSaver(tmp_path)
    cfg = saver.put(_cfg("t1"), empty_checkpoint(), {"source": "input", "step": 0}, {})
    assert saver.get_tuple(cfg) is not None
    saver.delete_thread("t1")
    assert saver.get_tuple(_cfg("t1")) is None
    assert not (tmp_path / "t1.jsonl").exists()


def test_namespace_isolation(tmp_path):
    saver = FileCheckpointSaver(tmp_path)
    c_root = saver.put(
        _cfg("t1", ""), empty_checkpoint(), {"source": "input", "step": 0}, {}
    )
    c_sub = saver.put(
        _cfg("t1", "sub"), empty_checkpoint(), {"source": "input", "step": 0}, {}
    )
    assert saver.get_tuple(c_root).config["configurable"]["checkpoint_ns"] == ""
    assert saver.get_tuple(c_sub).config["configurable"]["checkpoint_ns"] == "sub"


def test_contract_matches_inmemory(tmp_path):
    """与 InMemorySaver 行为对齐：同序列操作，get_tuple 结果一致。"""
    ref = InMemorySaver()
    fil = FileCheckpointSaver(tmp_path)
    c0 = empty_checkpoint()
    cfg_ref = ref.put(_cfg("t1"), c0, {"source": "input", "step": 0}, {})
    cfg_fil = fil.put(_cfg("t1"), c0, {"source": "input", "step": 0}, {})
    ref.put_writes(cfg_ref, [("messages", "x")], task_id="a")
    fil.put_writes(cfg_fil, [("messages", "x")], task_id="a")
    gr, gf = ref.get_tuple(cfg_ref), fil.get_tuple(cfg_fil)
    assert gr.checkpoint["id"] == gf.checkpoint["id"]
    assert sorted(w[1] for w in gr.pending_writes) == sorted(
        w[1] for w in gf.pending_writes
    )


def test_multi_thread_files_isolated(tmp_path):
    saver = FileCheckpointSaver(tmp_path)
    saver.put(_cfg("ta"), empty_checkpoint(), {"source": "input", "step": 0}, {})
    saver.put(_cfg("tb"), empty_checkpoint(), {"source": "input", "step": 0}, {})
    assert (tmp_path / "ta.jsonl").exists()
    assert (tmp_path / "tb.jsonl").exists()
    # 删一个不影响另一个
    saver.delete_thread("ta")
    assert saver.get_tuple(_cfg("ta")) is None
    assert saver.get_tuple(_cfg("tb")) is not None
