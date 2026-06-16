"""2C：librarian profile 生成 + 记忆去重。"""
import json
from pathlib import Path


def _seed_journal(brain: Path, entries):
    jd = brain / "journal"; jd.mkdir(parents=True, exist_ok=True)
    with (jd / "2026-06-15.jsonl").open("w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


def test_generate_profile_writes_md(monkeypatch, tmp_path):
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))

    class _LLM:
        def invoke(self, prompt):
            assert "调研" in prompt
            class _R: content = "## 核心能力\n- 擅长芯片调研"
            return _R()
    monkeypatch.setattr(librarian, "_build_llm", lambda: _LLM())

    brain = tmp_path / "42"
    _seed_journal(brain, [
        {"task_name": "调研A芯片", "status": "success", "tools_used": ["shell_execute"]},
        {"task_name": "调研B芯片", "status": "success", "tools_used": ["shell_execute"]},
    ])
    librarian.generate_profile(42)

    prof = brain / "profile.md"
    assert prof.exists()
    txt = prof.read_text(encoding="utf-8")
    assert "核心能力" in txt
    assert "芯片调研" in txt


def test_generate_profile_no_journal_noop(monkeypatch, tmp_path):
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: (_ for _ in ()).throw(AssertionError("无 journal 不该调 LLM")))
    librarian.generate_profile(99)
    assert not (tmp_path / "99" / "profile.md").exists()


def test_generate_profile_strips_fence_and_dedup_header(monkeypatch, tmp_path):
    """LLM 把输出裹在 ```markdown 围栏 + 自带「能力画像」标题 → 剥围栏、标题只留一个。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    fenced = "```markdown\n# 能力画像\n\n- 擅长芯片调研\n```"
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": fenced})()})())
    brain = tmp_path / "42"
    _seed_journal(brain, [{"task_name": "调研A", "status": "success", "tools_used": []}])
    librarian.generate_profile(42)

    txt = (brain / "profile.md").read_text(encoding="utf-8")
    assert "```" not in txt              # 代码围栏被剥掉
    assert txt.count("# 能力画像") == 1   # 标题只一个（不重复）
    assert "芯片调研" in txt


# ── 2C-2: consolidate_memory ────────────────────────────────────────────────

def _seed_memory(brain: Path, body: str):
    md = brain / "memories"; md.mkdir(parents=True, exist_ok=True)
    (md / "AGENTS.md").write_text(body, encoding="utf-8")


_MEM = "# 员工长期记忆\n\n## 用户偏好\n§喜欢简洁\n§喜欢简洁\n\n## 已知事实与约定\n§项目用 uv\n"


def test_consolidate_memory_writes_when_safe(monkeypatch, tmp_path):
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    cleaned = "# 员工长期记忆\n\n## 用户偏好\n§喜欢简洁\n\n## 已知事实与约定\n§项目用 uv\n"
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": cleaned})()})())
    brain = tmp_path / "42"; _seed_memory(brain, _MEM)
    librarian.consolidate_memory(42)
    out = (brain / "memories" / "AGENTS.md").read_text(encoding="utf-8")
    assert out.count("§喜欢简洁") == 1
    assert "## 用户偏好" in out and "## 已知事实与约定" in out
    assert (brain / "memories" / "AGENTS.md.bak").exists()


def test_consolidate_memory_skips_unsafe_output(monkeypatch, tmp_path):
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": "坏"})()})())
    brain = tmp_path / "42"; _seed_memory(brain, _MEM)
    librarian.consolidate_memory(42)
    out = (brain / "memories" / "AGENTS.md").read_text(encoding="utf-8")
    assert out == _MEM


def test_consolidate_memory_no_file_noop(monkeypatch, tmp_path):
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: (_ for _ in ()).throw(AssertionError("无记忆不该调 LLM")))
    librarian.consolidate_memory(77)


# ── 2C-3: run_librarian 编排 + 限流 ─────────────────────────────────────────

def test_run_librarian_calls_both_and_ratelimits(monkeypatch, tmp_path):
    from src.service.learning import librarian
    calls = {"profile": 0, "mem": 0}
    monkeypatch.setattr(librarian, "generate_profile", lambda eid: calls.__setitem__("profile", calls["profile"]+1))
    monkeypatch.setattr(librarian, "consolidate_memory", lambda eid: calls.__setitem__("mem", calls["mem"]+1))
    librarian._librarian_locks.clear()
    librarian.run_librarian(42)
    assert calls == {"profile": 1, "mem": 1}
    librarian.run_librarian(42)  # 冷却内
    assert calls == {"profile": 1, "mem": 1}


# ── 2C-4: 阈值自动触发 ────────────────────────────────────────────────────────

def test_threshold_triggers_from_disk_count(monkeypatch, tmp_path):
    """基于磁盘 journal 条数触发（重启不丢）：<阈值不触发；攒够且无 profile→触发。"""
    from src.service.learning import librarian
    ran = []
    monkeypatch.setattr(librarian, "_spawn_librarian", lambda eid: ran.append(eid))
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    librarian._LIBRARIAN_THRESHOLD = 3
    jd = tmp_path / "5" / "journal"
    jd.mkdir(parents=True)
    # 2 条 < 阈值 → 不触发
    (jd / "a.jsonl").write_text('{"x":1}\n{"x":2}\n', encoding="utf-8")
    librarian.note_journal_and_maybe_run(5)
    assert ran == []
    # 补到 3 条 ≥ 阈值、无 profile → 触发
    (jd / "a.jsonl").write_text('{"x":1}\n{"x":2}\n{"x":3}\n', encoding="utf-8")
    librarian.note_journal_and_maybe_run(5)
    assert ran == [5]


def test_threshold_skips_when_profile_fresh(monkeypatch, tmp_path):
    """已有 profile 且比 journal 新（无新活）→ 不重复触发。"""
    import time
    from src.service.learning import librarian
    ran = []
    monkeypatch.setattr(librarian, "_spawn_librarian", lambda eid: ran.append(eid))
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    librarian._LIBRARIAN_THRESHOLD = 2
    brain = tmp_path / "6"
    jd = brain / "journal"; jd.mkdir(parents=True)
    (jd / "a.jsonl").write_text('{"x":1}\n{"x":2}\n', encoding="utf-8")
    time.sleep(0.02)
    (brain / "profile.md").write_text("# 能力画像\n", encoding="utf-8")  # profile 比 journal 新
    librarian.note_journal_and_maybe_run(6)
    assert ran == []


def test_reflect_safe_hook_swallows(monkeypatch):
    from src.service.stream_registry import _maybe_librarian_safe
    import src.service.learning.librarian as lib
    monkeypatch.setattr(lib, "note_journal_and_maybe_run",
                        lambda eid: (_ for _ in ()).throw(RuntimeError("boom")))
    _maybe_librarian_safe(1)  # 不抛
