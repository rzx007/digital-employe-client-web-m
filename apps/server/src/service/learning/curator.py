"""技能/候选/员工 生命周期 curator：保守闲置老化，绝不删除。搭 librarian 后台 pass。"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

_LIFECYCLE_FILE = "skill_lifecycle.json"
_STALE_DAYS = 30
_ARCHIVED_DAYS = 90


def _load_lifecycle(brain: Path) -> dict:
    """读 <brain>/skill_lifecycle.json；缺失/损坏 → {"skills": {}}（容错不抛）。"""
    fp = brain / _LIFECYCLE_FILE
    try:
        if not fp.is_file():
            return {"skills": {}}
        data = json.loads(fp.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("skills"), dict):
            return {"skills": {}}
        return data
    except (OSError, json.JSONDecodeError):
        return {"skills": {}}


def _save_lifecycle(brain: Path, data: dict) -> None:
    """best-effort 写回（含 updated_at）。"""
    try:
        brain.mkdir(parents=True, exist_ok=True)
        data = dict(data)
        data["updated_at"] = datetime.now().isoformat(timespec="seconds")
        (brain / _LIFECYCLE_FILE).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        logger.warning("save lifecycle failed", exc_info=True)


def _effective_last_used(assign, task_max, rating_max, restored):
    """四源取 max：分配时间(必非空,作基线) 与 任务/评分/手动恢复 时间中的最大值。None 源忽略。"""
    candidates = [t for t in (assign, task_max, rating_max, restored) if t is not None]
    return max(candidates)
