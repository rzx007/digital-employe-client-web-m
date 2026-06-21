"""技能/候选/员工 生命周期 curator：保守闲置老化，绝不删除。搭 librarian 后台 pass。"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select

# CST 在首次 run_curator 调用时才可用，模块级 _to_aware 用延迟引用
def _to_aware(dt: datetime | None) -> datetime | None:
    """naive datetime → CST-aware；None 原样透传。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        from src.models.workspace import CST
        return dt.replace(tzinfo=CST)
    return dt

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
        from src.models.workspace import cst_now
        brain.mkdir(parents=True, exist_ok=True)
        data = dict(data)
        data["updated_at"] = cst_now().isoformat(timespec="seconds")
        (brain / _LIFECYCLE_FILE).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        logger.warning("save lifecycle failed", exc_info=True)


def _effective_last_used(assign, task_max, rating_max, restored):
    """四源取 max：分配时间(必非空,作基线) 与 任务/评分/手动恢复 时间中的最大值。None 源忽略。"""
    candidates = [t for t in (assign, task_max, rating_max, restored) if t is not None]
    return max(candidates)


def _age_status(last_used: datetime, now: datetime, *, pinned: bool) -> tuple[str, str | None]:
    """根据闲置天数返回 (status, archived_at_iso_or_None)。

    - pinned → 永远 active，不老化
    - 闲置 >= _ARCHIVED_DAYS (90天) → archived，返回 now 的 ISO 字符串
    - 闲置 >= _STALE_DAYS  (30天) → stale
    - 其余                         → active
    """
    if pinned:
        return ("active", None)
    idle_days = (now - last_used).days
    if idle_days >= _ARCHIVED_DAYS:
        return ("archived", now.isoformat(timespec="seconds"))
    if idle_days >= _STALE_DAYS:
        return ("stale", None)
    return ("active", None)


def archived_skill_names(brain) -> set[str]:
    """读 lifecycle.json，返回 status=="archived" 的技能名集合。容错→空集。"""
    try:
        skills = _load_lifecycle(brain).get("skills", {})
        return {name for name, meta in skills.items()
                if isinstance(meta, dict) and meta.get("status") == "archived"}
    except Exception:  # noqa: BLE001
        return set()


def run_curator(employee_id: int) -> None:
    """扫该员工所有已分配技能，按闲置时长更新 skill_lifecycle.json。

    - 开/关自己的 DB session（best-effort，异常只 warn，不阻断 librarian）。
    - pinned / restored_at 不被覆盖。
    """
    try:
        from src.db.session import get_session_local
        from src.models.employee_skill import EmployeeSkill
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.skill_rating import SkillRating
        from src.models.workspace import cst_now, CST
        from src.service.learning.librarian import _brain_root_for

        now = cst_now()
        brain = _brain_root_for(employee_id)
        lifecycle = _load_lifecycle(brain)
        skills_data: dict = lifecycle.setdefault("skills", {})

        db = get_session_local()()
        try:
            rows = db.execute(
                select(EmployeeSkill).where(EmployeeSkill.employee_id == employee_id)
            ).scalars().all()

            for row in rows:
                skill_name = row.skill_name
                skill_id = row.skill_id

                # assign 基线（tz-aware，由 _to_aware 统一规整）
                assign = row.created_at

                # task max
                task_max = db.execute(
                    select(func.max(TaskExecutionLog.created_at)).where(
                        TaskExecutionLog.employee_id == employee_id,
                        TaskExecutionLog.skill_id == skill_id,
                    )
                ).scalar_one_or_none()

                # rating max
                rating_max = db.execute(
                    select(func.max(SkillRating.created_at)).where(
                        SkillRating.employee_id == employee_id,
                        SkillRating.skill_id == skill_id,
                    )
                ).scalar_one_or_none()

                # 从已有 lifecycle 读 pinned / restored_at
                prior = skills_data.get(skill_name, {})
                pinned: bool = prior.get("pinned", False)
                restored_at_iso: str | None = prior.get("restored_at")
                restored_dt: datetime | None = None
                if restored_at_iso:
                    try:
                        restored_dt = datetime.fromisoformat(restored_at_iso)
                        if restored_dt.tzinfo is None:
                            restored_dt = restored_dt.replace(tzinfo=CST)
                    except ValueError:
                        restored_dt = None

                # SQLite 返回 naive datetime；统一转成 CST-aware 以便与 now 比较
                assign = _to_aware(assign)
                task_max = _to_aware(task_max)
                rating_max = _to_aware(rating_max)

                last_used = _effective_last_used(assign, task_max, rating_max, restored_dt)
                status, archived_at = _age_status(last_used, now, pinned=pinned)

                skills_data[skill_name] = {
                    "status": status,
                    "pinned": pinned,
                    "archived_at": archived_at if status == "archived" else prior.get("archived_at"),
                    "restored_at": restored_at_iso,
                }

        finally:
            db.close()

        _save_lifecycle(brain, lifecycle)
        logger.info("run_curator eid=%s processed %d skills", employee_id, len(rows))

    except Exception:
        logger.warning("run_curator failed eid=%s", employee_id, exc_info=True)
