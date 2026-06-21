from src.service.learning import curator


def test_lifecycle_roundtrip_and_corrupt_tolerant(tmp_path):
    brain = tmp_path
    curator._save_lifecycle(brain, {"skills": {"pptx": {"status": "active", "pinned": True,
                                                        "archived_at": None, "restored_at": None}}})
    loaded = curator._load_lifecycle(brain)
    assert loaded["skills"]["pptx"]["pinned"] is True
    # 损坏文件 → 当空，不抛
    (brain / "skill_lifecycle.json").write_text("{ broken", encoding="utf-8")
    assert curator._load_lifecycle(brain) == {"skills": {}}


def test_compute_last_used_takes_max_of_sources():
    from datetime import datetime
    assign = datetime(2026, 1, 1)
    task = datetime(2026, 3, 1)
    rating = datetime(2026, 2, 1)
    restored = None
    assert curator._effective_last_used(assign, task, rating, restored) == task
    # 从未使用：只有分配时间
    assert curator._effective_last_used(assign, None, None, None) == assign
