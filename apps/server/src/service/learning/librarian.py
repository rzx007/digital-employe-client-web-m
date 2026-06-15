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
        brain.mkdir(parents=True, exist_ok=True)
        (brain / "profile.md").write_text("# 能力画像\n\n" + content + "\n", encoding="utf-8")
    except Exception:
        logger.warning("generate_profile failed eid=%s", employee_id, exc_info=True)
