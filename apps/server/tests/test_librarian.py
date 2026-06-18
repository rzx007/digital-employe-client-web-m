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


def test_generate_profile_includes_memory_lessons(monkeypatch, tmp_path):
    """生成画像时把 memories/AGENTS.md 里提炼的教训也读进 prompt——
    教训才会浓缩进画像、在路由/回喂时被总管看到（闭合学习闭环消费端）。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))

    seen = {}

    class _LLM:
        def invoke(self, prompt):
            seen["prompt"] = prompt
            class _R: content = "## 核心能力\n- 擅长芯片调研"
            return _R()
    monkeypatch.setattr(librarian, "_build_llm", lambda: _LLM())

    brain = tmp_path / "42"
    _seed_journal(brain, [
        {"task_name": "调研A芯片", "status": "success", "tools_used": ["shell_execute"]},
    ])
    _seed_memory(brain, "# 员工长期记忆\n\n## 经验教训\n§交付 Word 前先确认是 docx 而非 md\n")

    librarian.generate_profile(42)

    # 教训进入了 critic 的 prompt，且画像照常落盘
    assert "docx 而非 md" in seen["prompt"]
    assert (brain / "profile.md").exists()


def test_generate_profile_no_memory_still_writes(monkeypatch, tmp_path):
    """无 memories/AGENTS.md（新员工）时不报错，仍据 journal 生成画像。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": "## 能力\n- x"})()})())
    brain = tmp_path / "43"
    _seed_journal(brain, [{"task_name": "调研A", "status": "success", "tools_used": []}])
    librarian.generate_profile(43)
    assert (brain / "profile.md").exists()


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


def test_generate_profile_strips_title_then_fence(monkeypatch, tmp_path):
    """回归：LLM「标题在前、围栏在后」(# 能力画像 / ```markdown … ```)，
    旧 cleaner 剥标题后露出的围栏未二次剥 → 面板渲成代码块。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    fenced = "# 能力画像\n```markdown\n# 数字员工能力画像\n\n- 擅长芯片调研\n```"
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": fenced})()})())
    brain = tmp_path / "42"
    _seed_journal(brain, [{"task_name": "调研A", "status": "success", "tools_used": []}])
    librarian.generate_profile(42)

    txt = (brain / "profile.md").read_text(encoding="utf-8")
    assert "```" not in txt                # 围栏剥净
    assert txt.count("# 能力画像") == 1     # 仅一个标题
    assert "数字员工能力画像" not in txt    # LLM 自带变体标题去掉
    assert "芯片调研" in txt


def test_strip_outer_code_fence_keeps_inner_blocks():
    """整体未被围栏包裹时（正文中间含代码块）不应误删。"""
    from src.service.learning import librarian
    s = "正文\n\n```py\ncode\n```\n\n结尾"
    assert librarian._strip_outer_code_fence(s) == s
    # 整体被包裹则剥
    assert librarian._strip_outer_code_fence("```markdown\nhello\n```") == "hello"


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


def test_consolidate_memory_strips_outer_fence(monkeypatch, tmp_path):
    """回归：LLM 把整份记忆裹进 ```markdown 围栏 → 必须剥掉再写，否则面板渲成代码块。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    fenced = "```markdown\n# 员工长期记忆\n\n## 用户偏好\n§喜欢简洁\n\n## 已知事实与约定\n§项目用 uv\n```"
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": fenced})()})())
    brain = tmp_path / "42"; _seed_memory(brain, _MEM)
    librarian.consolidate_memory(42)
    out = (brain / "memories" / "AGENTS.md").read_text(encoding="utf-8")
    assert "```" not in out                                  # 围栏剥净
    assert "## 用户偏好" in out and "## 已知事实与约定" in out  # 分节保留


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

def test_run_librarian_calls_all_and_ratelimits(monkeypatch, tmp_path):
    from src.service.learning import librarian
    calls = {"profile": 0, "mem": 0, "promote": 0}
    monkeypatch.setattr(librarian, "generate_profile", lambda eid: calls.__setitem__("profile", calls["profile"]+1))
    monkeypatch.setattr(librarian, "consolidate_memory", lambda eid: calls.__setitem__("mem", calls["mem"]+1))
    monkeypatch.setattr(librarian, "promote_skills", lambda eid: calls.__setitem__("promote", calls["promote"]+1))
    librarian._librarian_locks.clear()
    librarian.run_librarian(42)
    assert calls == {"profile": 1, "mem": 1, "promote": 1}
    librarian.run_librarian(42)  # 冷却内
    assert calls == {"profile": 1, "mem": 1, "promote": 1}


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


# ── 硬技能晋升（重复且验证过的打法 → 技能候选）────────────────────────────────

_PROMOTE_OUT = (
    "SKILL: chip-research-report\n"
    "NAME: 芯片调研报告\n"
    "DESC: 标准化的芯片选型调研与报告产出流程\n"
    "---\n"
    "## 何时使用\n需要对某类芯片做选型调研时\n## 步骤\n1. 查规格\n2. 对比\n3. 出报告\n"
)


def test_parse_skill_candidate_ok():
    from src.service.learning import librarian
    got = librarian._parse_skill_candidate(_PROMOTE_OUT)
    assert got is not None
    assert got["slug"] == "chip-research-report"
    assert got["zh"] == "芯片调研报告"
    assert "选型调研" in got["desc"]
    assert "步骤" in got["body"]


def test_parse_skill_candidate_none_when_no_pattern():
    from src.service.learning import librarian
    assert librarian._parse_skill_candidate("无") is None
    assert librarian._parse_skill_candidate("") is None


def test_parse_skill_candidate_tolerates_leading_frontmatter_fence():
    """本地模型常把头部裹成 YAML frontmatter（前导 ---）；不应被误判为分隔符而丢弃。"""
    from src.service.learning import librarian
    wrapped = (
        "---\n"
        "SKILL: chip-research-report\nNAME: 芯片调研报告\nDESC: 标准化调研流程\n"
        "---\n## 步骤\n1. 查规格\n"
    )
    got = librarian._parse_skill_candidate(wrapped)
    assert got is not None
    assert got["slug"] == "chip-research-report"
    assert got["zh"] == "芯片调研报告"
    assert "步骤" in got["body"]


def test_promote_skills_below_threshold_noop(monkeypatch, tmp_path):
    """成功流水 < 阈值 → 不调 LLM、不造候选（单次不晋升，防 fluke）。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: (_ for _ in ()).throw(AssertionError("不足阈值不该调 LLM")))
    brain = tmp_path / "42"
    _seed_journal(brain, [
        {"task_name": "调研A芯片", "status": "success", "tools_used": ["shell_execute"]},
        {"task_name": "调研B芯片", "status": "success", "tools_used": ["shell_execute"]},
    ])  # 仅 2 条成功 < 3
    librarian.promote_skills(42)
    assert not (brain / "skill_candidates").exists()


def test_promote_skills_writes_candidate(monkeypatch, tmp_path):
    """≥3 条成功且 critic 识别出可复用打法 → 写技能候选（不进 active skills）。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": _PROMOTE_OUT})()})())
    brain = tmp_path / "42"
    _seed_journal(brain, [
        {"task_name": "调研A芯片", "status": "success", "tools_used": ["shell_execute"]},
        {"task_name": "调研B芯片", "status": "success", "tools_used": ["shell_execute"]},
        {"task_name": "调研C芯片", "status": "success", "tools_used": ["shell_execute"]},
    ])
    librarian.promote_skills(42)
    cand = brain / "skill_candidates" / "chip-research-report.md"
    assert cand.exists()
    txt = cand.read_text(encoding="utf-8")
    assert "name: chip-research-report" in txt
    assert "芯片调研报告" in txt
    assert "步骤" in txt
    # 不得写进 active skills 目录（候选须人确认才晋升）
    assert not (brain / "skills" / "chip-research-report").exists()


def test_promote_skills_none_pattern_no_candidate(monkeypatch, tmp_path):
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": "无"})()})())
    brain = tmp_path / "42"
    _seed_journal(brain, [
        {"task_name": f"杂活{i}", "status": "success", "tools_used": []} for i in range(4)
    ])
    librarian.promote_skills(42)
    assert not (brain / "skill_candidates").exists()


def test_promote_skills_no_clobber_existing(monkeypatch, tmp_path):
    """同 slug 候选已存在 → 不覆盖（避免后台每轮反复造）。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": _PROMOTE_OUT})()})())
    brain = tmp_path / "42"
    cand_dir = brain / "skill_candidates"; cand_dir.mkdir(parents=True)
    (cand_dir / "chip-research-report.md").write_text("旧候选-勿覆盖", encoding="utf-8")
    _seed_journal(brain, [
        {"task_name": "调研芯片", "status": "success", "tools_used": []} for _ in range(3)
    ])
    librarian.promote_skills(42)
    assert (cand_dir / "chip-research-report.md").read_text(encoding="utf-8") == "旧候选-勿覆盖"
