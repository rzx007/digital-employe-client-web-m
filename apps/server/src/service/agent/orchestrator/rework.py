"""总管一线质检的返工编排：在同一员工对话续聊重做（非新建会话）。"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.conversation import Conversation
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)

MAX_REWORK = 2  # 每个子任务最多自主返工次数；超限升级给领导


def _new_session() -> Session:
    from src.db.session import get_session_local
    return get_session_local()()


def _schedule_employee_rework_stream(
    *, conversation_id: int, agent: Any, messages: list, assistant_msg_id: int,
    orchestrator_conversation_id: int | None,
) -> None:
    """把"等总管 idle → 起员工流"投到主事件循环（回调线程无 running loop）。

    复用 execution.py 的 _start_employee_stream_when_orchestrator_idle：
    返工由总管在其汇报 turn 内调用 → 总管流仍 active → 须等其 idle（skip=False）。
    """
    import asyncio
    from src.service.agent.orchestrator.execution import (
        _start_employee_stream_when_orchestrator_idle,
    )
    from src.service.agent.orchestrator.runtime import get_main_loop

    def _do() -> None:
        asyncio.create_task(
            _start_employee_stream_when_orchestrator_idle(
                orchestrator_conversation_id=orchestrator_conversation_id,
                conversation_id=conversation_id,
                agent=agent,
                messages=messages,
                assistant_msg_id=assistant_msg_id,
                source="orchestration_rework",
                skip_orchestrator_wait=False,
            )
        )
    try:
        get_main_loop().call_soon_threadsafe(_do)
    except Exception:
        logger.warning("schedule rework stream failed conv=%s", conversation_id, exc_info=True)


def redispatch_task_in_session(
    workspace_id: int, task_id: int, rework_note: str
) -> str:
    """在独立 session 里编排一次返工：上限校验 → 打回旧 log → 续聊建新 log → 起流。

    返回给总管的自然语言结果（成功告知 / 上限升级提示 / 错误）。
    """
    db = _new_session()
    try:
        task = db.get(EmployeeTask, task_id)
        if task is None or task.workspace_id != workspace_id:
            return f"错误：未找到子任务 #{task_id}。"

        if (task.rework_count or 0) >= MAX_REWORK:
            return (
                f"任务「{task.task_name}」已返工 {task.rework_count} 次仍不达标，"
                f"已达上限。请领导定夺（换人 / 改需求 / 接受现状），我不再自动打回。"
            )

        # 取最新一条已终态 log（=触发本轮评审、已盖 reported_at 的那条；
        # 总管只能经评审 turn 看到它，故"最新 = 刚评审的那条"成立）
        old = db.scalars(
            select(TaskExecutionLog)
            .where(TaskExecutionLog.task_id == task_id)
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if old is None or old.conversation_id is None:
            return f"错误：任务「{task.task_name}」无可续聊的员工对话，无法返工。"
        # 守卫：新 log 继承此值，缺它则增量引擎选不中 → 返工会静默失败。
        if old.orchestrator_conversation_id is None:
            return f"错误：任务「{task.task_name}」的执行日志未关联总管会话，无法返工。"

        conv = db.get(Conversation, old.conversation_id)
        if conv is None:
            return f"错误：任务「{task.task_name}」的员工对话已不存在，无法返工。"

        employee = db.get(Employee, task.employee_id)
        if employee is None:
            return f"错误：任务「{task.task_name}」的执行员工已不存在。"

        # 守卫：最新执行仍在进行中时不可打回（否则会破坏在跑的员工流）。
        if old.run_status in ("running", "queued", "pending"):
            return (
                f"错误：任务「{task.task_name}」最新执行仍在进行中"
                f"（{old.run_status}），完成后才能打回返工。"
            )

        # gate：前置未通过质检/正在返工 → 拒绝(不消耗 rework_count、不打回)
        from src.service.agent.orchestrator.dependency_scheduler import task_prereqs_accepted
        if not task_prereqs_accepted(db, task):
            return (
                f"错误：任务「{task.task_name}」的前置尚未通过质检（或正在返工），"
                f"无法返工它；请先处理前置——其下游会在前置重新达标后自动重跑。"
            )

        # 1) 打回旧 log（仅展示语义；reported_at 已盖，不会被增量引擎重选）
        old.run_status = "superseded"

        # 2) 现有对话续聊：追加 user(返工说明) + assistant 占位
        from src.service.chat_service import ChatService
        rework_directive = (
            "【系统·返工】总管判定上轮交付不达标，请在你上一稿基础上修改。"
            "不达标的点与改进要求如下，直接产出修订后的最终结果：\n"
            f"{rework_note}"
        )
        ChatService._append_message(
            db, conversation=conv, role="user", content=rework_directive
        )
        assistant_msg = ChatService._append_message(
            db, conversation=conv, role="assistant", content=""
        )
        assistant_msg.stream_state = "queued"

        # 3) 新 TaskExecutionLog：同 task、同 conversation、同 orch 会话
        new_log = TaskExecutionLog(
            task_id=task.id,
            workspace_id=workspace_id,
            employee_id=employee.id,
            skill_id=task.skill_id,
            task_name_snapshot=task.task_name,
            run_status="queued",
            run_result="返工中，等待执行",
            input_json=task.task_input_json or "{}",
            output_json="{}",
            conversation_id=conv.id,
            orchestrator_conversation_id=old.orchestrator_conversation_id,
            started_at=cst_now(),
        )
        db.add(new_log)

        # 4) 计数
        task.rework_count = (task.rework_count or 0) + 1
        db.commit()

        # 5) 构建员工 agent（同会话、同共享桌）并起流
        agent = _build_employee_agent_for_rework(db, task, employee, conv.id)
        _schedule_employee_rework_stream(
            conversation_id=conv.id,
            agent=agent,
            messages=[{"role": "user", "content": rework_directive}],
            assistant_msg_id=assistant_msg.id,
            orchestrator_conversation_id=old.orchestrator_conversation_id,
        )

        try:
            from src.service.workspace_events import WorkspaceEventBus
            WorkspaceEventBus.push(workspace_id, {
                "type": "task_started",
                "task_id": task.id,
                "conversation_id": conv.id,
                "employee_id": employee.id,
                "employee_name": employee.name,
                "task_name": task.task_name,
            })
        except Exception:
            logger.warning("push task_started event failed task=%s", task.id, exc_info=True)

        # 作废 X 的下游子树(它们基于旧产物的结果已失效)→ 待 X 重新达标后由放行闸自动重跑
        try:
            from src.service.agent.orchestrator.dependency_scheduler import invalidate_downstream
            invalidate_downstream(task.id)
        except Exception:
            logger.warning("invalidate_downstream task=%s failed", task.id, exc_info=True)

        return (
            f"已判定「{task.task_name}」不达标，打回重做（第 {task.rework_count} 次返工）。"
        )
    finally:
        db.close()


def _build_employee_agent_for_rework(db, task, employee, conversation_id: int):
    """复用 execution.py 的共享桌/技能/档位解析，构建续聊用员工 agent。"""
    from src.llm.factory import resolve_output_tokens
    from src.service.agent.employee import get_agent
    from src.service.chat_service import ChatService
    from src.service.orchestrator_conversation_links import (
        resolve_orchestrator_conversation_id,
    )

    try:
        skills_path = ChatService.resolve_employee_skills_dir(
            skills_payload=employee.skills_json, employee_id=employee.id,
            employee_name=employee.name, employee_code=employee.employee_code,
        )
    except Exception:
        skills_path = ""

    # SP2: 续聊产物根改为该续聊会话所属项目的 per-project 根，而非全局产物目录。
    from src.models.conversation import Conversation
    from src.service.product_paths import resolve_conversation_product_root

    _conv = db.get(Conversation, conversation_id)
    if _conv is not None:
        root_path = str(resolve_conversation_product_root(db, _conv))
    else:
        # 会话缺失（极端）→ 回落孤儿目录，绝不回退 legacy 全局。
        from src.service.product_paths import _ORPHANED_BASE

        root_path = str(_ORPHANED_BASE / f"conv-{conversation_id}")

    shared_artifacts_dir = None
    shared_workspace_root = None
    orch_conv_id = resolve_orchestrator_conversation_id(db, task)
    if orch_conv_id is not None:
        from src.service.agent.workspace_paths import (
            resolve_orchestrator_desk_dir, orchestrator_task_subdir,
        )
        _desk = resolve_orchestrator_desk_dir(root_path, orch_conv_id)
        shared_artifacts_dir = str(orchestrator_task_subdir(_desk, task.id))
        shared_workspace_root = str(_desk)

    _tier = "standard"
    try:
        _ti = json.loads(task.task_input_json or "{}")
        if isinstance(_ti, dict) and _ti.get("output_tier"):
            _tier = str(_ti["output_tier"])
    except (json.JSONDecodeError, TypeError):
        pass

    return get_agent(
        skills_path, root_path, employee_id=employee.id,
        conversation_id=conversation_id, enable_hitl=False,
        shared_artifacts_dir=shared_artifacts_dir,
        shared_workspace_root=shared_workspace_root,
        max_output_tokens=resolve_output_tokens(_tier),
    )
