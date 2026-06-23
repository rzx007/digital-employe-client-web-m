"""计划级调度解析：把自然语言/cron 归类成 once（一次性）或 recurring（重复）。"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_RE_CRON = re.compile(r"^[\d\s\*\,\/\-]+$")

# 相对一次性时间：『N分钟后 / N小时后 / N天后 / N秒后』——确定性判为 once
_RE_RELATIVE = re.compile(r"(\d+)\s*(秒|分钟|分|小时|个小时|时|天)后")
_UNIT_SECONDS = {"秒": 1, "分钟": 60, "分": 60, "小时": 3600, "个小时": 3600, "时": 3600, "天": 86400}


def _relative_once_run_at(text: str, now: datetime):
    """识别『N分钟后』类相对一次性表达，返回绝对 run_at（CST）；无则 None。"""
    m = _RE_RELATIVE.search(text)
    if not m:
        return None
    n = int(m.group(1))
    secs = n * _UNIT_SECONDS.get(m.group(2), 0)
    if secs <= 0:
        return None
    return now + timedelta(seconds=secs)


@dataclass
class ScheduleSpec:
    kind: str           # "once" | "recurring"
    cron: str | None = None
    run_at: datetime | None = None


def _classify_with_llm(text: str, now: datetime) -> tuple[str | None, str | None]:
    """LLM 归类：返回 (kind, value)。kind in {"once","recurring",None}。
    once → value 是绝对时间 "YYYY-MM-DD HH:MM:SS"；recurring → value 是 5 段 cron。
    失败返回 (None, None)。"""
    try:
        from src.llm.factory import build_chat_model
        model = build_chat_model()
        prompt = (
            "你是定时任务解析器。判断下面的中文时间表达是【一次性(once)】还是【重复(recurring)】，"
            "并给出对应值。\n"
            "- 一次性(如『5分钟后』『今晚8点』『明天上午9点』『6月23日21:34』)：输出两行，"
            f"第一行 once，第二行该绝对时间 YYYY-MM-DD HH:MM:SS（当前时间是 {now:%Y-%m-%d %H:%M:%S}，按此推算）。\n"
            "- 重复(如『每天10点』『每周一』『每5分钟』)：输出两行，第一行 recurring，第二行标准 5 段 cron（分 时 日 月 周）。\n"
            "- 无法解析：只输出一行 none。\n"
            f"表达：{text}"
        )
        resp = model.invoke(prompt)
        content = (resp.content if hasattr(resp, "content") else str(resp)).strip()
        lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
        if not lines:
            return None, None
        kind = lines[0].lower()
        if kind == "none":
            return None, None
        if kind in ("once", "recurring") and len(lines) >= 2:
            return kind, lines[1]
        return None, None
    except Exception:
        logger.warning("parse_schedule LLM 归类失败 text=%r", text, exc_info=True)
        return None, None


def parse_schedule(text: str, *, now: datetime) -> ScheduleSpec | None:
    """把 text 归类成 once / recurring。无法解析返回 None。"""
    stripped = (text or "").strip()
    if not stripped:
        return None

    # 0) 确定性相对一次性快路（『N分钟后』），不依赖 LLM、不会被误判 recurring
    rel = _relative_once_run_at(stripped, now)
    if rel is not None:
        return ScheduleSpec(kind="once", run_at=rel)

    # 1) 先 LLM 归类（顺序坑：必须先于裸 cron 数字快路）
    kind, value = _classify_with_llm(stripped, now)
    if kind == "recurring" and value and _RE_CRON.match(value) and len(value.split()) == 5:
        return ScheduleSpec(kind="recurring", cron=value)
    if kind == "once" and value:
        try:
            run_at = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
            from src.models.workspace import CST
            run_at = run_at.replace(tzinfo=CST)
            return ScheduleSpec(kind="once", run_at=run_at)
        except (ValueError, TypeError):
            pass

    # 2) 回落：纯 5 段 cron 数字串 → recurring
    if _RE_CRON.match(stripped) and len(stripped.split()) == 5:
        return ScheduleSpec(kind="recurring", cron=stripped)

    return None
