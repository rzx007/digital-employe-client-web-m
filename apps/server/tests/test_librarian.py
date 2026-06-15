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
