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


_PROFILE_TITLES = ("能力画像", "能力画像（历史复盘）", "数字员工能力画像", "数字员工能力画像（历史复盘）")


def _strip_outer_code_fence(raw: str) -> str:
    """若内容整体被一对 ```…``` 围栏包裹（语言标记任意），剥掉最外层围栏；否则原样返回。
    判定：首行以 ``` 起、且最后一非空行恰为 ```（避免误删正文中间的代码块）。"""
    text = (raw or "").strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    # 去尾部空行后，末行须是单独的 ```
    end = len(lines) - 1
    while end > 0 and not lines[end].strip():
        end -= 1
    if end >= 1 and lines[end].strip() == "```":
        return "\n".join(lines[1:end]).strip()
    return text


def _clean_profile_content(raw: str) -> str:
    """规整 LLM 画像输出：剥掉整体代码围栏(```markdown … ```)、去掉它自带的「能力画像」H1
    与前导空行——避免与我们统一加的标题重复、避免在面板里被渲成代码块。
    LLM 可能「标题在前、围栏在后」或反过来嵌套，故循环剥到稳定。"""
    text = (raw or "").strip()
    for _ in range(4):  # 标题↔围栏任意顺序/嵌套，迭代到稳定
        before = text
        text = _strip_outer_code_fence(text).strip()
        lines = text.split("\n")
        while lines and not lines[0].strip():  # 前导空行
            lines.pop(0)
        # LLM 自带的顶级标题去掉（含「数字员工能力画像」等变体）
        if lines and lines[0].strip().lstrip("#").strip() in _PROFILE_TITLES:
            lines.pop(0)
            while lines and not lines[0].strip():
                lines.pop(0)
        text = "\n".join(lines).strip()
        if text == before:
            break
    return text


def _read_memory_lessons(brain: Path, max_chars: int = 2000) -> str:
    """读该员工已沉淀的长期记忆/教训（memories/AGENTS.md），供归纳画像时参考。

    这些教训由 reflection_engine 在「失败后成功 / 返工后达标」等信号上提炼写入；
    把它们喂进画像 critic，成败模式/避坑经验才会浓缩进画像、在路由时被总管看到——
    闭合「①捕获→②提炼→③复盘→④回喂」里复盘消费教训的一环。无文件则空串。
    """
    try:
        mem_file = brain / "memories" / "AGENTS.md"
        if not mem_file.is_file():
            return ""
        from src.service.basic_file_reader import read_text_with_encoding_fallback
        text = read_text_with_encoding_fallback(mem_file).strip()
        return text[-max_chars:] if len(text) > max_chars else text
    except Exception:
        return ""


def generate_profile(employee_id: int) -> None:
    """读 journal + 教训记忆归纳能力画像 → 写 <brain>/profile.md。无 journal 则 noop。容错。"""
    try:
        brain = _brain_root_for(employee_id)
        entries = _read_recent_journal(brain)
        if not entries:
            return
        lines = [
            f"- {e.get('task_name','')}（{e.get('status','')}）工具:{','.join(e.get('tools_used') or [])}"
            for e in entries
        ]
        digest = "\n".join(lines)
        lessons = _read_memory_lessons(brain)
        llm = _build_llm()
        lessons_block = (
            f"\n该员工已沉淀的长期记忆/教训（归纳「成败模式、避坑经验」时务必参考、"
            f"提炼进画像）：\n{lessons}\n" if lessons else ""
        )
        prompt = (
            "基于以下某数字员工的历史任务流水"
            + ("与已沉淀教训" if lessons else "")
            + "，归纳一份简短**能力画像**(markdown)：\n"
            "包含：擅长的活类型、常用打法/工具、值得注意的成败模式（含已踩过/被纠正过的坑）。3-6 条，简洁。\n"
            "直接输出 markdown 正文，**不要用 ``` 代码块包裹**，**不要写「能力画像」标题**。\n\n"
            f"任务流水：\n{digest}\n"
            f"{lessons_block}"
        )
        content = _clean_profile_content(llm.invoke(prompt).content)
        if not content:
            return
        brain.mkdir(parents=True, exist_ok=True)
        (brain / "profile.md").write_text("# 能力画像\n\n" + content + "\n", encoding="utf-8")
    except Exception:
        logger.warning("generate_profile failed eid=%s", employee_id, exc_info=True)


_REQUIRED_SECTIONS = ("## 用户偏好", "## 已知事实与约定")


def consolidate_memory(employee_id: int) -> None:
    """LLM 去重合并 AGENTS.md，安全护栏：非空+保留分节+不显著变短才写，否则跳过。容错。"""
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
        # LLM 常把整份文件裹进 ```markdown 围栏 → 剥掉，否则面板里渲成代码块
        cleaned = _strip_outer_code_fence(llm.invoke(prompt).content).strip()
        if not cleaned:
            return
        if not all(sec in cleaned for sec in _REQUIRED_SECTIONS):
            logger.info("consolidate_memory skip eid=%s: missing sections", employee_id)
            return
        if len(cleaned) < len(original) * 0.5:
            logger.info("consolidate_memory skip eid=%s: too short", employee_id)
            return
        (brain / "memories" / "AGENTS.md.bak").write_text(original, encoding="utf-8")
        mem_file.write_text(cleaned + ("\n" if not cleaned.endswith("\n") else ""), encoding="utf-8")
    except Exception:
        logger.warning("consolidate_memory failed eid=%s", employee_id, exc_info=True)


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


# ── 阈值自动触发 ──────────────────────────────────────────────────────────────

_LIBRARIAN_THRESHOLD = 5  # journal 累计达 N 条才跑复盘


def _spawn_librarian(employee_id: int) -> None:
    """后台 daemon 线程跑 run_librarian（不阻塞调用方/finalize）。"""
    import threading
    threading.Thread(target=run_librarian, args=(employee_id,), daemon=True).start()


def _count_journal_entries(brain: Path) -> int:
    """磁盘上该员工 journal 总条数（重启不丢，替代内存计数器）。"""
    jdir = brain / "journal"
    if not jdir.is_dir():
        return 0
    n = 0
    for fp in jdir.glob("*.jsonl"):
        try:
            n += sum(1 for line in fp.read_text(encoding="utf-8").splitlines() if line.strip())
        except OSError:
            continue
    return n


def note_journal_and_maybe_run(employee_id: int) -> None:
    """journal 每捕获一次调一次。基于**磁盘** journal 条数判定（重启不丢）：
    攒够阈值且画像缺失/过期 → 后台跑复盘。run_librarian 自带 5min 限流防频繁。"""
    if employee_id is None:
        return
    try:
        brain = _brain_root_for(employee_id)
        if _count_journal_entries(brain) < _LIBRARIAN_THRESHOLD:
            return
        profile = brain / "profile.md"
        if not profile.exists():
            _spawn_librarian(employee_id)
            return
        # 已有画像：journal 比画像新（有新活）才刷新；限流兜底防频繁
        jdir = brain / "journal"
        newest = max((f.stat().st_mtime for f in jdir.glob("*.jsonl")), default=0.0)
        if newest > profile.stat().st_mtime:
            _spawn_librarian(employee_id)
    except Exception:
        logger.warning("note_journal_and_maybe_run failed eid=%s", employee_id, exc_info=True)
