"""员工「在用中自改进」工具：发现已加载技能有错/缺/过时 → 就地改并落技能库+全员同步。"""
from __future__ import annotations

import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


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
