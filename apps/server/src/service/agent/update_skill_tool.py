"""员工「在用中自改进」工具：发现已加载技能有错/缺/过时 → 就地改并落技能库+全员同步。"""
from __future__ import annotations

import logging
from typing import Optional

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def _backup_skill_version(skill_name: str, workspace_id: int) -> Optional[str]:
    """把工作区技能的当前 SKILL.md 备份到 <workspace_dir>/.history/<YYYYmmdd-HHMMSS>.md。

    Returns:
        时间戳字符串（如 "20260620-153000"），若跳过则返回 None。

    跳过条件：
    - 工作区目录不存在（仅内置或全新技能）。
    - 工作区目录存在但没有 SKILL.md。

    防御性保护：
    - 若解析出的目录位于 builtin 根下（不应发生），则硬跳过并记 error 日志。
    """
    # 下游 import 保持在函数体内（与 _apply_skill_update 同一约定）
    from datetime import datetime
    from src.service.local_skill_service import LocalSkillService

    try:
        normalized = LocalSkillService._normalize_skill_name(skill_name)
        workspace_dir = LocalSkillService._skill_dir(normalized, workspace_id)

        if not workspace_dir.is_dir():
            # 工作区无该技能目录 → 新技能 or 仅内置，无需备份
            return None

        skill_md = workspace_dir / LocalSkillService.SKILL_MD_NAME
        if not skill_md.exists():
            return None

        # 安全防御：绝不写入 builtin 根
        if LocalSkillService._is_under_builtin(workspace_dir):
            logger.error(
                "_backup_skill_version: resolved workspace_dir is under builtin root, "
                "refusing to write backup. skill=%s workspace_id=%s dir=%s",
                skill_name, workspace_id, workspace_dir,
            )
            return None

        ts = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        history_dir = workspace_dir / ".history"
        history_dir.mkdir(parents=True, exist_ok=True)
        backup_file = history_dir / f"{ts}.md"
        backup_file.write_text(skill_md.read_text(encoding="utf-8"), encoding="utf-8")
        logger.info(
            "_backup_skill_version: backed up skill=%s workspace_id=%s ts=%s",
            skill_name, workspace_id, ts,
        )
        return ts
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "_backup_skill_version failed (best-effort, update will continue): "
            "skill=%s workspace_id=%s err=%s",
            skill_name, workspace_id, exc,
        )
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


def create_update_skill_tool(employee_id: int, available_skills: list[str]):
    """构造绑定到某员工的 update_skill 工具。available_skills 即该员工本轮已加载技能，
    作为「只能改已加载技能」的守卫白名单。"""
    loaded = set(available_skills or [])

    @tool
    def update_skill(skill_name: str, new_content: str, reason: str) -> str:
        """当你加载的某个技能在使用中发现**错误/缺步骤/已过时**，用本工具就地修正它的
        SKILL.md 全文。仅在确有把握、且是技能本身的问题（非本次任务一次性特例）时才改；
        改动会写入技能库并同步给所有使用该技能的同事，故须类级、通用、保守。

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
    # `src.db.session.get_session_local` / `LocalSkillService.update_local_skill` /
    # `EmployeeService.sync_local_skill_to_assignees`，顶层别名 import 会让 patch 失效。
    from fastapi import HTTPException
    from src.db.session import get_session_local
    from src.models.employee import Employee
    from src.service.local_skill_service import LocalSkillService
    from src.service.employee_service import EmployeeService

    db = get_session_local()()
    try:
        emp = db.get(Employee, employee_id)
        if emp is None:
            return "拒绝：未找到员工记录。"
        workspace_id = emp.workspace_id
        user_id = emp.user_id
        # Employee.user_id 可空（Mapped[str | None]）。为 None 时 sync 会 WHERE user_id==None
        # 匹配 0 行 → 静默"改了库却没同步任何人"。显式挡掉，避免难排查的假成功。
        if user_id is None:
            return f"拒绝：员工(id={employee_id}) 缺 user_id，无法定位同步范围。"

        LocalSkillService.ensure_editable_from_employee_copy(
            skill_name, workspace_id, employee_id
        )
        backup_version = _backup_skill_version(skill_name, workspace_id)
        LocalSkillService.update_local_skill(
            skill_name, workspace_id, skill_md_content=new_content, target="workspace"
        )
        EmployeeService.sync_local_skill_to_assignees(
            db, user_id=user_id, workspace_id=workspace_id, skill_name=skill_name
        )
        db.commit()
        logger.info(
            "update_skill applied: emp=%s skill=%s reason=%s",
            employee_id, skill_name, reason,
        )
        _write_skill_edit_audit(employee_id, skill_name, reason, new_content, backup_version)
        return f"已更新技能「{skill_name}」并同步所有使用该技能的同事。"
    except HTTPException as http_exc:
        db.rollback()
        logger.warning("update_skill rejected by service: %s", http_exc.detail)
        return f"更新技能「{skill_name}」失败：{http_exc.detail}"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("update_skill failed: %s", exc, exc_info=True)
        return f"更新技能「{skill_name}」失败：{exc}"
    finally:
        db.close()
