"""员工「在用中自改进」工具：发现已加载技能有错/缺/过时 → 就地改自己的私有副本（按员工隔离，不写库、不广播）。"""
from __future__ import annotations

import logging
from typing import Optional

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def _backup_skill_version_private(skill_dir) -> Optional[str]:
    """把员工私有副本的当前 SKILL.md 备份到 <skill_dir>/.history/<YYYYmmdd-HHMMSS-ffffff>.md。

    Returns:
        时间戳字符串（如 "20260620-153000-123456"），若跳过/失败则返回 None。

    best-effort：任何失败都吞掉返回 None，绝不向上抛，更新主流程继续。
    """
    # 下游 import 保持在函数体内（与 _apply_skill_update 同一约定）
    from datetime import datetime

    try:
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            return None
        ts = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        history_dir = skill_dir / ".history"
        history_dir.mkdir(parents=True, exist_ok=True)
        (history_dir / f"{ts}.md").write_text(
            skill_md.read_text(encoding="utf-8"), encoding="utf-8"
        )
        return ts
    except Exception as exc:  # noqa: BLE001
        logger.warning("_backup_skill_version_private failed (best-effort): %s", exc)
        return None


def _write_skill_edit_audit(
    employee_id: int,
    skill_name: str,
    reason: str,
    new_content: str,
    backup_version: Optional[str],
) -> None:
    """成功修订后追加一条审计到 <brain>/skill_edits.jsonl。best-effort，绝不阻断主流程。"""
    # in-function imports（与文件约定一致）
    import hashlib
    import json
    from datetime import datetime
    from src.service.employee_service import _growth_brain_root_for
    try:
        brain = _growth_brain_root_for(employee_id)
        brain.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "employee_id": employee_id,
            "skill_name": skill_name,
            "reason": reason,
            "new_sha256": hashlib.sha256(new_content.encode("utf-8")).hexdigest()[:16],
            "backup_version": backup_version,  # 可回滚到的 .history 版本号；None 表示首次（无前版）
        }
        audit_file = brain / "skill_edits.jsonl"
        with audit_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001
        logger.warning("skill edit audit write failed", exc_info=True)


def _clear_skill_hint(employee_id: int, skill_name: str) -> None:
    """技能成功更新后，删除成长大脑中对应的改进提示文件（best-effort）。"""
    try:
        from src.service.employee_service import _growth_brain_root_for
        hint = _growth_brain_root_for(employee_id) / "skill_hints" / f"{skill_name}.md"
        if hint.is_file():
            hint.unlink()
    except Exception:  # noqa: BLE001
        logger.warning("clear skill hint failed", exc_info=True)


def create_update_skill_tool(employee_id: int, available_skills: list[str]):
    """构造绑定到某员工的 update_skill 工具。available_skills 即该员工本轮已加载技能，
    作为「只能改已加载技能」的守卫白名单。"""
    loaded = set(available_skills or [])

    @tool
    def update_skill(skill_name: str, new_content: str, reason: str) -> str:
        """当你加载的某个技能在使用中发现**错误/缺步骤/已过时**，用本工具就地修正它的
        SKILL.md 全文。仅在确有把握、且是技能本身的问题（非本次任务一次性特例）时才改；
        改动**只作用于你自己的私有副本**（不影响同事），故应类级、通用、保守。

        Args:
            skill_name: 要修订的技能名（必须是你已加载的技能之一）。
            new_content: 修订后的完整 SKILL.md 文本（全量替换）。
            reason: 为何修订（错在哪/缺什么），将记入审计。
        """
        if skill_name not in loaded:
            return (
                f"拒绝：技能「{skill_name}」不在你已加载的技能列表中，"
                f"只能修订已加载的技能。已加载：{sorted(loaded)}"
            )
        if not new_content or not new_content.strip():
            return "拒绝：new_content 为空，不允许清空技能内容。"
        return _apply_skill_update(employee_id, skill_name, new_content, reason)

    return update_skill


def _apply_skill_update(
    employee_id: int, skill_name: str, new_content: str, reason: str
) -> str:
    # ⚠️ 下游 import 必须留在函数体内（而非模块顶层别名）：测试靠 monkeypatch
    # `src.db.session.get_session_local` / `EmployeeService._resolve_skill_root` 等，
    # 顶层别名 import 会让 patch 失效。
    from src.db.session import get_session_local
    from src.models.employee import Employee
    from src.service.employee_service import EmployeeService
    from src.service import skill_provenance

    db = get_session_local()()
    try:
        emp = db.get(Employee, employee_id)
        if emp is None:
            return "拒绝：未找到员工记录。"
        # 单一真相：只改调用者自己的私有副本，不写库、不广播给同事。
        skill_dir = (
            EmployeeService._resolve_skill_root() / str(employee_id) / "skills" / skill_name
        )
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            return f"拒绝：技能「{skill_name}」的私有副本不存在。"
        backup_version = _backup_skill_version_private(skill_dir)
        skill_md.write_text(new_content, encoding="utf-8")
        info = skill_provenance.read_origin(skill_dir)
        if info.origin == "assigned":
            skill_provenance.set_locally_modified(skill_dir, True)
        EmployeeService.reconcile_employee_skills(db, emp)
        db.commit()
        logger.info(
            "update_skill applied (private): emp=%s skill=%s reason=%s",
            employee_id, skill_name, reason,
        )
        _write_skill_edit_audit(employee_id, skill_name, reason, new_content, backup_version)
        _clear_skill_hint(employee_id, skill_name)
        return f"已更新你的技能「{skill_name}」（仅你自己的副本）。"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("update_skill failed: %s", exc, exc_info=True)
        return f"更新技能「{skill_name}」失败：{exc}"
    finally:
        db.close()
