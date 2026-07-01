"""技能/候选/员工 生命周期 curator：保守闲置老化，绝不删除。搭 librarian 后台 pass。"""
from __future__ import annotations

import difflib
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


def _now_iso() -> str:
    """当前 CST 时间 ISO 字符串（秒精度），与 _save_lifecycle 的 updated_at 保持一致。"""
    from src.models.workspace import cst_now
    return cst_now().isoformat(timespec="seconds")


def get_lifecycle_snapshot(brain: Path) -> dict:
    """只读快照：返回 {skill_name: {status, pinned}}（best-effort，缺失/坏 → {}）。"""
    try:
        skills = _load_lifecycle(brain).get("skills", {})
        return {
            name: {"status": meta.get("status", "active"), "pinned": bool(meta.get("pinned", False))}
            for name, meta in skills.items() if isinstance(meta, dict)
        }
    except Exception:  # noqa: BLE001
        return {}


def restore_skill(brain: Path, skill_name: str) -> None:
    """手动恢复 archived 技能 → status=active、restored_at=now（作 last_used 新基线防再archive）、archived_at=None。"""
    data = _load_lifecycle(brain)
    entry = data["skills"].setdefault(skill_name, {})
    entry["status"] = "active"
    entry["restored_at"] = _now_iso()
    entry["archived_at"] = None
    entry.setdefault("pinned", False)
    _save_lifecycle(brain, data)


def set_pinned(brain: Path, skill_name: str, pinned: bool) -> None:
    """置顶/取消置顶：pinned 技能永不 stale/archived（curator 豁免）。技能不在表里则创建条目。"""
    data = _load_lifecycle(brain)
    entry = data["skills"].setdefault(skill_name, {})
    entry["pinned"] = bool(pinned)
    entry.setdefault("status", "active")
    _save_lifecycle(brain, data)


def archived_skill_names(brain: Path) -> set[str]:
    """读 lifecycle.json，返回 status=="archived" 的技能名集合。容错→空集。"""
    try:
        skills = _load_lifecycle(brain).get("skills", {})
        return {name for name, meta in skills.items()
                if isinstance(meta, dict) and meta.get("status") == "archived"}
    except Exception:  # noqa: BLE001
        return set()


def _merge_near_dup_candidates(brain: Path) -> None:
    """将 <brain>/skill_candidates/ 中的近重复候选合并为单一文件。

    近重复判定（保守，宁漏勿错）：
      - slug token 集相等（如 excel-export ↔ export-excel），OR
      - difflib ratio >= 0.85

    合并策略：
      - 保留内容最长的文件；内容等长则取字典序更小的 slug。
      - 在保留文件末尾追加 "\\n\\n亦见: <其余slug逗号分隔>"。
      - 删除其余文件。

    只操作 skill_candidates/，绝不触碰 skills/。best-effort：任何异常只 warn 不 raise。
    """
    try:
        cand_dir = brain / "skill_candidates"
        if not cand_dir.is_dir():
            return
        files = sorted(cand_dir.glob("*.md"))
        if len(files) < 2:
            return

        # 收集 (slug, content, path) 三元组
        entries: list[tuple[str, str, Path]] = []
        for fp in files:
            try:
                content = fp.read_text(encoding="utf-8")
            except OSError:
                logger.warning("_merge_near_dup_candidates: cannot read %s", fp, exc_info=True)
                continue
            entries.append((fp.stem, content, fp))

        def _is_near_dup(slug_a: str, slug_b: str) -> bool:
            tokens_a = frozenset(slug_a.split("-"))
            tokens_b = frozenset(slug_b.split("-"))
            if tokens_a == tokens_b:
                return True
            ratio = difflib.SequenceMatcher(None, slug_a, slug_b).ratio()
            return ratio >= 0.85

        # 贪心聚类：visited 标记已归入某簇
        visited = [False] * len(entries)
        clusters: list[list[int]] = []
        for i in range(len(entries)):
            if visited[i]:
                continue
            cluster = [i]
            visited[i] = True
            for j in range(i + 1, len(entries)):
                if not visited[j] and _is_near_dup(entries[i][0], entries[j][0]):
                    cluster.append(j)
                    visited[j] = True
            clusters.append(cluster)

        # 对每个大小 > 1 的簇执行合并
        for cluster in clusters:
            if len(cluster) == 1:
                continue
            # 选代表：最长内容；同长则字典序最小的 slug
            def _sort_key(idx: int) -> tuple[int, str]:
                slug, content, _ = entries[idx]
                return (-len(content), slug)  # 内容越长越优先；同长取 slug 字典序小的

            cluster_sorted = sorted(cluster, key=_sort_key)
            keep_idx = cluster_sorted[0]
            drop_indices = cluster_sorted[1:]

            keep_slug, keep_content, keep_path = entries[keep_idx]
            drop_slugs = [entries[i][0] for i in drop_indices]

            # 追加亦见注记
            new_content = keep_content.rstrip() + "\n\n亦见: " + ", ".join(sorted(drop_slugs))
            try:
                keep_path.write_text(new_content, encoding="utf-8")
            except OSError:
                logger.warning("_merge_near_dup_candidates: cannot write %s", keep_path, exc_info=True)
                continue

            # 删除其余文件
            for i in drop_indices:
                try:
                    entries[i][2].unlink()
                except OSError:
                    logger.warning("_merge_near_dup_candidates: cannot delete %s", entries[i][2], exc_info=True)

            logger.info("_merge_near_dup_candidates: merged %s into %s", drop_slugs, keep_slug)

    except Exception:  # noqa: BLE001
        logger.warning("_merge_near_dup_candidates failed", exc_info=True)


_EMPLOYEE_IDLE_ARCHIVE_DAYS = 90


def employee_archive_suggestion(db, employee_id: int) -> dict | None:
    """闲置建议（只读，不归档）：该员工最近一次 TaskExecutionLog 距今 > 90 天
    （或从无记录且员工创建 > 90 天前）→ 返回 {employee_id, last_active(iso|None),
    idle_days}；否则 None。容错→None。绝对不写入任何数据。
    """
    try:
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.employee import Employee
        from src.models.workspace import cst_now

        now = cst_now()

        last_active_raw = db.execute(
            select(func.max(TaskExecutionLog.created_at)).where(
                TaskExecutionLog.employee_id == employee_id
            )
        ).scalar_one_or_none()

        if last_active_raw is not None:
            last_active_aware = _to_aware(last_active_raw)
            idle_days = (now - last_active_aware).days
            if idle_days > _EMPLOYEE_IDLE_ARCHIVE_DAYS:
                return {
                    "employee_id": employee_id,
                    "last_active": last_active_aware.isoformat(timespec="seconds"),
                    "idle_days": idle_days,
                }
            return None

        # 从未派发任务 → 回退到员工创建时间作为基线
        emp = db.execute(
            select(Employee).where(Employee.id == employee_id)
        ).scalar_one_or_none()
        if emp is None or emp.created_at is None:
            return None
        created_aware = _to_aware(emp.created_at)
        idle_days = (now - created_aware).days
        if idle_days > _EMPLOYEE_IDLE_ARCHIVE_DAYS:
            return {
                "employee_id": employee_id,
                "last_active": None,
                "idle_days": idle_days,
            }
        return None

    except Exception:  # noqa: BLE001
        logger.warning("employee_archive_suggestion failed eid=%s", employee_id, exc_info=True)
        return None


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

        # B-3: 近重复候选合并（best-effort，异常已在函数内 warn，不阻断 curator）
        _merge_near_dup_candidates(brain)

    except Exception:
        logger.warning("run_curator failed eid=%s", employee_id, exc_info=True)
