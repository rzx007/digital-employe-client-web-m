# 阶段 2C：librarian 复盘（profile 画像 + 记忆去重）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：[阶段2 总览](2026-06-15-stage2-learning-loop-overview.md) §2C。基底 `feat/orchestrator-centric`（2A/2B 完成）。

**Goal:** librarian 后台复盘：扫 journal + 记忆 → 生成/更新员工 `profile.md`（能力画像，喂 2D 路由）+ 安全地去重合并记忆。**v1 不做** skill 晋升、退休员工（复杂/高风险，延后）。

**Architecture:** 新建 `service/learning/librarian.py`：`generate_profile`(读 journal+memories→后台 LLM 归纳→写 profile.md) + `consolidate_memory`(LLM 去重 AGENTS.md，**安全护栏**：非空+保留分节+不显著变短才写，否则跳过) + `run_librarian`(编排两者，per-员工限流) + 阈值自动触发(journal 捕获累积 N 次→后台线程跑)。复用 2B 的 build_chat_model 一次性 LLM、journal/memories 路径。

**Tech Stack:** Python / pytest（mock LLM）。测试 `cd apps/server && uv run pytest tests/... -v`。

---

## 设计要点（实现前必读）

**大脑根**：`resolve_employee_memories_dir(employee_id).parent`（= `<skill_path>/<employee_id>`，与 journal 一致）。librarian 内抽模块级 `_brain_root_for(eid)` 便于测试 monkeypatch。
- profile：`<brain>/profile.md`
- journal：`<brain>/journal/*.jsonl`（2A 已建）
- memories：`<brain>/memories/AGENTS.md`（结构：`## 用户偏好` / `## 已知事实与约定` 两节，见 memory_file.py）

**v1 范围**：profile 生成 + 记忆去重。**不碰** skill 晋升(无编程造技能函数、易造垃圾)、退休员工(Employee 无软删、级联删日志=丢学习轨迹)——见总览 §2C 开放问题，延后。

**安全（记忆去重最关键）**：LLM 重写 AGENTS.md 有丢内容风险。护栏：仅当 LLM 输出 ① 非空 ② 仍含两个分节标题 ③ 长度 ≥ 原文 50% 时才写；否则**跳过不写**（保留原记忆）。写前留 `AGENTS.md.bak`。

**触发**：v1 = **阈值自动**（journal 每捕获一次给该员工计数，累积 N 次→后台 daemon 线程跑 run_librarian，独立 DB session）+ per-员工限流。计数用内存 dict（重启清零，可接受 v1）。**不碰 cron 编排**(TaskSchedulerService 是派 agent 任务的重路子，librarian 是纯后台函数)。

**文件结构**：
- 新建：`apps/server/src/service/learning/librarian.py`
- 改：`apps/server/src/service/learning/journal.py`（捕获后触发计数）或 `stream_registry.py`（在 _capture_journal_safe 后 _maybe_librarian_safe）——**选后者**，与 2A/2B 挂载一致、journal.py 保持纯粹
- 测：新建 `apps/server/tests/test_librarian.py`

---

## Task 1：generate_profile（journal+memories → profile.md）

**Files:** Create `service/learning/librarian.py`；Test `tests/test_librarian.py`

- [ ] **Step 1: 写失败测试**

```python
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
            assert "调研" in prompt  # journal 内容进了 prompt
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
    librarian.generate_profile(99)  # 无 journal → 不调 LLM、不写
    assert not (tmp_path / "99" / "profile.md").exists()
```

- [ ] **Step 2: 跑测试确认失败** `cd apps/server && uv run pytest tests/test_librarian.py -k generate_profile -v`

- [ ] **Step 3: 实现**（新建 librarian.py）

```python
"""学习闭环：librarian 复盘（profile 画像 + 记忆去重）。"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_PROFILE_MAX_JOURNAL = 60
_librarian_locks: dict[int, float] = {}
_LIBRARIAN_COOLDOWN = 300  # 秒


def _brain_root_for(employee_id: int) -> Path:
    from src.service.agent.paths import resolve_employee_memories_dir
    return resolve_employee_memories_dir(employee_id=employee_id).parent


def _build_llm():
    from src.llm.factory import build_chat_model
    return build_chat_model(apply_profile=False)


def _read_recent_journal(brain: Path, max_entries: int = _PROFILE_MAX_JOURNAL) -> list[dict]:
    jdir = brain / "journal"
    if not jdir.is_dir():
        return []
    entries: list[dict] = []
    for fp in sorted(jdir.glob("*.jsonl")):
        try:
            for line in fp.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue
        except OSError:
            continue
    return entries[-max_entries:]


def generate_profile(employee_id: int) -> None:
    """读 journal 归纳能力画像 → 写 <brain>/profile.md。无 journal 则 noop。容错。"""
    try:
        brain = _brain_root_for(employee_id)
        entries = _read_recent_journal(brain)
        if not entries:
            return
        # 摘要喂 LLM（任务名+成败+工具）
        lines = [
            f"- {e.get('task_name','')}（{e.get('status','')}）工具:{','.join(e.get('tools_used') or [])}"
            for e in entries
        ]
        digest = "\n".join(lines)
        llm = _build_llm()
        prompt = (
            "基于以下某数字员工的历史任务流水，归纳一份简短**能力画像**(markdown)：\n"
            "包含：擅长的活类型、常用打法/工具、值得注意的成败模式。3-6 条，简洁。\n\n"
            f"任务流水：\n{digest}\n"
        )
        content = llm.invoke(prompt).content.strip()
        if not content:
            return
        header = f"# 能力画像\n\n"
        brain.mkdir(parents=True, exist_ok=True)
        (brain / "profile.md").write_text(header + content + "\n", encoding="utf-8")
    except Exception:
        logger.warning("generate_profile failed eid=%s", employee_id, exc_info=True)
```

- [ ] **Step 4: 跑测试** `cd apps/server && uv run pytest tests/test_librarian.py -k generate_profile -v`（绿）
- [ ] **Step 5: 提交** `git commit -m "feat(learning): librarian generate_profile 生成能力画像"`

---

## Task 2：consolidate_memory（安全去重 AGENTS.md）

**Files:** Modify `librarian.py`；Test `tests/test_librarian.py`

- [ ] **Step 1: 写失败测试**

```python
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
    assert out.count("§喜欢简洁") == 1   # 去重生效
    assert "## 用户偏好" in out and "## 已知事实与约定" in out
    assert (brain / "memories" / "AGENTS.md.bak").exists()  # 留备份


def test_consolidate_memory_skips_unsafe_output(monkeypatch, tmp_path):
    """LLM 输出丢了分节/太短 → 不写，保留原文。"""
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: type("L", (), {"invoke": lambda self, p: type("R", (), {"content": "坏"})()})())
    brain = tmp_path / "42"; _seed_memory(brain, _MEM)
    librarian.consolidate_memory(42)
    out = (brain / "memories" / "AGENTS.md").read_text(encoding="utf-8")
    assert out == _MEM   # 原文保留


def test_consolidate_memory_no_file_noop(monkeypatch, tmp_path):
    from src.service.learning import librarian
    monkeypatch.setattr(librarian, "_brain_root_for", lambda eid: tmp_path / str(eid))
    monkeypatch.setattr(librarian, "_build_llm",
                        lambda: (_ for _ in ()).throw(AssertionError("无记忆不该调 LLM")))
    librarian.consolidate_memory(77)  # 无 AGENTS.md → noop
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**（加到 librarian.py）

```python
_REQUIRED_SECTIONS = ("## 用户偏好", "## 已知事实与约定")


def consolidate_memory(employee_id: int) -> None:
    """LLM 去重合并 AGENTS.md，带安全护栏：非空+保留分节+不显著变短才写，否则跳过。容错。"""
    try:
        brain = _brain_root_for(employee_id)
        mem_file = brain / "memories" / "AGENTS.md"
        if not mem_file.is_file():
            return
        from src.service.basic_file_reader import read_text_with_encoding_fallback
        original = read_text_with_encoding_fallback(mem_file)
        if not original.strip():
            return
        llm = _build_llm()
        prompt = (
            "下面是某员工的长期记忆文件。请**去除重复/冗余条目、合并近似条目**，"
            "但**保持原有 markdown 结构与所有分节标题不变**，不要新增内容、不要删整节。\n\n"
            f"{original}\n\n"
            "直接输出整理后的完整文件内容。"
        )
        cleaned = llm.invoke(prompt).content.strip()
        # 安全护栏
        if not cleaned:
            return
        if not all(sec in cleaned for sec in _REQUIRED_SECTIONS):
            logger.info("consolidate_memory skip eid=%s: missing sections", employee_id)
            return
        if len(cleaned) < len(original) * 0.5:
            logger.info("consolidate_memory skip eid=%s: too short", employee_id)
            return
        # 备份后写
        (brain / "memories" / "AGENTS.md.bak").write_text(original, encoding="utf-8")
        mem_file.write_text(cleaned + ("\n" if not cleaned.endswith("\n") else ""), encoding="utf-8")
    except Exception:
        logger.warning("consolidate_memory failed eid=%s", employee_id, exc_info=True)
```

> `_REQUIRED_SECTIONS` 以 memory_file.py 真实分节标题为准——实现前读 memory_file.py 确认是「## 用户偏好」「## 已知事实与约定」，不符按实际改（测试同步）。

- [ ] **Step 4: 跑测试**（绿）
- [ ] **Step 5: 提交** `git commit -m "feat(learning): librarian consolidate_memory 安全去重记忆"`

---

## Task 3：run_librarian 编排 + 限流

**Files:** Modify `librarian.py`；Test `tests/test_librarian.py`

- [ ] **Step 1: 写失败测试**

```python
def test_run_librarian_calls_both_and_ratelimits(monkeypatch, tmp_path):
    from src.service.learning import librarian
    calls = {"profile": 0, "mem": 0}
    monkeypatch.setattr(librarian, "generate_profile", lambda eid: calls.__setitem__("profile", calls["profile"]+1))
    monkeypatch.setattr(librarian, "consolidate_memory", lambda eid: calls.__setitem__("mem", calls["mem"]+1))
    librarian._librarian_locks.clear()
    librarian.run_librarian(42)
    assert calls == {"profile": 1, "mem": 1}
    librarian.run_librarian(42)  # 冷却内
    assert calls == {"profile": 1, "mem": 1}  # 未再调
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**

```python
def _acquire_librarian_lock(employee_id: int) -> bool:
    now = time.time()
    if now - _librarian_locks.get(employee_id, 0) < _LIBRARIAN_COOLDOWN:
        return False
    _librarian_locks[employee_id] = now
    return True


def run_librarian(employee_id: int) -> None:
    """对单个员工跑复盘：生成画像 + 去重记忆。per-员工 5min 限流。容错。"""
    if employee_id is None:
        return
    if not _acquire_librarian_lock(employee_id):
        return
    try:
        generate_profile(employee_id)
        consolidate_memory(employee_id)
    except Exception:
        logger.warning("run_librarian failed eid=%s", employee_id, exc_info=True)
```

- [ ] **Step 4: 跑测试**（绿，含 Task1/2）
- [ ] **Step 5: 提交** `git commit -m "feat(learning): run_librarian 编排画像+去重，per-员工限流"`

---

## Task 4：阈值自动触发（journal 累积 N 次 → 后台跑）

**Files:** Modify `librarian.py`（计数+触发）、`stream_registry.py`（挂载）；Test `tests/test_librarian.py`

- [ ] **Step 1: 写失败测试**

```python
def test_threshold_triggers_after_n(monkeypatch):
    from src.service.learning import librarian
    ran = []
    monkeypatch.setattr(librarian, "_spawn_librarian", lambda eid: ran.append(eid))
    librarian._journal_counters.clear()
    librarian._LIBRARIAN_THRESHOLD = 3
    for _ in range(2):
        librarian.note_journal_and_maybe_run(5)
    assert ran == []          # 未达阈值
    librarian.note_journal_and_maybe_run(5)
    assert ran == [5]         # 第 3 次触发
    # 计数重置
    librarian.note_journal_and_maybe_run(5)
    assert ran == [5]


def test_reflect_safe_hook_swallows(monkeypatch):
    from src.service.stream_registry import _maybe_librarian_safe
    import src.service.learning.librarian as lib
    monkeypatch.setattr(lib, "note_journal_and_maybe_run",
                        lambda eid: (_ for _ in ()).throw(RuntimeError("boom")))
    _maybe_librarian_safe(1)  # 不抛
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**

librarian.py 加：
```python
_journal_counters: dict[int, int] = {}
_LIBRARIAN_THRESHOLD = 5  # journal 每累积 N 次跑一次复盘


def _spawn_librarian(employee_id: int) -> None:
    """后台 daemon 线程跑 run_librarian（不阻塞调用方/finalize）。"""
    import threading
    threading.Thread(target=run_librarian, args=(employee_id,), daemon=True).start()


def note_journal_and_maybe_run(employee_id: int) -> None:
    """journal 每捕获一次调一次；累积达阈值→后台跑复盘并重置计数。"""
    if employee_id is None:
        return
    n = _journal_counters.get(employee_id, 0) + 1
    if n >= _LIBRARIAN_THRESHOLD:
        _journal_counters[employee_id] = 0
        _spawn_librarian(employee_id)
    else:
        _journal_counters[employee_id] = n
```

stream_registry.py 加封装 + 在 `_capture_journal_safe(db, log)` 之后挂（注意：log.employee_id 可能 None）：
```python
def _maybe_librarian_safe(employee_id) -> None:
    try:
        if employee_id is None:
            return
        from src.service.learning.librarian import note_journal_and_maybe_run
        note_journal_and_maybe_run(employee_id)
    except Exception:
        logger.warning("librarian trigger hook failed", exc_info=True)
```
在 `_finalize_task_stream` 的 `_reflect_on_signal_safe(db, log)` 之后加：
```python
        _reflect_on_signal_safe(db, log)
        _maybe_librarian_safe(log.employee_id if log else None)
```

- [ ] **Step 4: 跑测试 + 回归** `cd apps/server && uv run pytest tests/test_librarian.py tests/test_journal_capture.py tests/test_signal_critic.py -v`；再 `-k "stream_registry or finaliz or librarian"`（无新增回归）
- [ ] **Step 5: 提交** `git commit -m "feat(learning): journal 阈值触发 librarian 后台复盘"`

---

## 收尾验证
- [ ] 全量后端：`cd apps/server && uv run pytest tests/ -q`，仅预存基线、零新增回归（worktree 基线比对）。
- [ ] 手测桩：某员工跑够 N 个子任务 → `<skill_path>/<eid>/profile.md` 出现能力画像；AGENTS.md 重复条目被合并(留 .bak)。

## 开放问题
- O1 阈值计数内存态(重启清零)：v1 可接受；要持久可后续存 profile.md mtime/计数文件。
- O2 后台线程 vs 任务队列：v1 daemon 线程够用；高频可换队列。
- O3 skill 晋升 / 退休员工：延后（总览 §2C 开放问题）。
- O4 _REQUIRED_SECTIONS 以 memory_file.py 实际分节为准。
</content>
