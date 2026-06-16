"""总管再入整合协调器：组队子任务全部完成后，唤醒总管起一轮整合 turn。"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 可 monkeypatch 的 seam（测试时替换，避免触碰真实数据库/流引擎）
# ---------------------------------------------------------------------------

def _new_session() -> Session:
    """新建一个独立 DB session（供整合流专用，避免与调用方 session 共用）。"""
    from src.db.session import get_session_local
    return get_session_local()()


def _build_orchestrator_agent(*, workspace_id: int, db: Session, conversation_id: int):
    """构建总管 agent（不绑定上下文变量，避免串扰当前线程的 contextvar）。"""
    from src.service.agent.orchestrator import get_orchestrator_agent
    return get_orchestrator_agent(
        workspace_id, db, conversation_id,
        bind_context=False,
        enable_hitl=False,
    )


def _schedule_reentry_stream(
    *,
    conversation_id: int,
    agent: Any,
    messages: list,
    stream_msg_id: int,
    workspace_id: int,
    owned_db: Session,
) -> None:
    """跨线程把 registry.request_start 投到主事件循环（回调线程无 running loop）。"""
    from src.service.stream_registry import registry
    from src.service.agent_stream_queue import StartResult

    def _do_start() -> None:
        result = registry.request_start(
            conversation_id=conversation_id,
            agent=agent,
            messages=messages,
            config={"configurable": {"thread_id": conversation_id}},
            stream_msg_id=stream_msg_id,
            skill_name="",
            debug_content_only=False,
            orchestrator_workspace_id=workspace_id,
            orchestrator_conversation_id=conversation_id,
            orchestrator_owned_db=owned_db,
            source="orchestrator_reentry",
        )
        if result == StartResult.REJECTED:
            # 被拒（会话已有活跃流）→ 回滚占位 assistant 消息，避免永久僵尸 streaming
            logger.warning(
                "reentry stream REJECTED conv=%s → 回滚占位消息", conversation_id
            )
            try:
                from src.models.conversation import ConversationMessage
                rb = _new_session()
                try:
                    msg = rb.get(ConversationMessage, stream_msg_id)
                    if msg is not None and msg.stream_state == "streaming":
                        msg.stream_state = "failed"
                        rb.commit()
                finally:
                    rb.close()
            except Exception:
                logger.warning(
                    "reentry REJECTED rollback failed conv=%s",
                    conversation_id,
                    exc_info=True,
                )

    try:
        from src.service.agent.orchestrator.runtime import get_main_loop
        get_main_loop().call_soon_threadsafe(_do_start)
    except Exception:
        _do_start()


def _start_incremental_stream(
    *,
    conversation_id: int,
    agent: Any,
    messages: list,
    stream_msg_id: int,
    workspace_id: int,
    owned_db: Session,
):
    """同步起一轮增量汇报流，并返回 StartResult。

    与 _schedule_reentry_stream 不同：本函数**同步**调用 request_start 并把结果
    返回给调用方，使 trigger_incremental_report 能据此决定是否标记 reported_at。
    调用方（去抖器 _flush）本身运行在主事件循环内，故无需跨线程投递。
    """
    from src.service.stream_registry import registry

    return registry.request_start(
        conversation_id=conversation_id,
        agent=agent,
        messages=messages,
        config={"configurable": {"thread_id": conversation_id}},
        stream_msg_id=stream_msg_id,
        skill_name="",
        debug_content_only=False,
        orchestrator_workspace_id=workspace_id,
        orchestrator_conversation_id=conversation_id,
        orchestrator_owned_db=owned_db,
        source="orchestrator_reentry",
    )


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def trigger_orchestrator_reentry(db: Session, plan, workspace_id: int) -> int | None:
    """编排计划全部完成 → 唤醒总管起一轮整合 turn。

    注：增量汇报改造后，幂等不再由 plan.status 门闩负责（已删除该早返回），
    而是由 per-task 的 TaskExecutionLog.reported_at 负责（见 trigger_incremental_report）。
    plan.status 字段保留供只读展示用，但不再 gate 任何唤醒。

    返回触发的 conversation_id，或 None（跳过）。
    """
    from src.models.conversation import Conversation
    from src.service.chat_service import ChatService

    conv = db.get(Conversation, plan.conversation_id)
    if conv is None:
        return None

    results = collect_plan_execution_results(db, plan)
    brief = build_reentry_brief(results)

    # 置计划终态值（仅供只读展示；不再 gate 任何唤醒，幂等由 reported_at 负责）
    plan.status = "summarized"

    # 在总管会话写入 assistant 流式占位（不插 user 消息，总管自发整合）
    assistant_msg = ChatService._append_message(
        db, conversation=conv, role="assistant", content=""
    )
    assistant_msg.stream_state = "streaming"
    db.commit()

    # 用独立 session 构建 agent 并起流，避免与调用方 session 并发冲突
    owned_db = _new_session()
    agent = _build_orchestrator_agent(
        workspace_id=workspace_id, db=owned_db, conversation_id=conv.id
    )
    _schedule_reentry_stream(
        conversation_id=conv.id,
        agent=agent,
        messages=[{"role": "user", "content": brief}],
        stream_msg_id=assistant_msg.id,
        workspace_id=workspace_id,
        owned_db=owned_db,
    )
    return conv.id


def _log_to_result(log: TaskExecutionLog) -> dict[str, Any]:
    """把一条 TaskExecutionLog 转成 build_reentry_brief 期望的结果 dict 形状。

    形状与 collect_plan_execution_results 产出一致（task_name/status/content/result/error）。
    """
    content = ""
    if log.output_json:
        try:
            content = json.loads(log.output_json).get("content", "") or ""
        except (ValueError, TypeError):
            content = ""
    return {
        "task_name": log.task_name_snapshot,
        "status": log.run_status,
        "content": content,
        "result": log.run_result or "",
        "error": log.error_message,
    }


def trigger_incremental_report(
    db: Session, orchestrator_conversation_id: int, workspace_id: int
) -> bool:
    """增量汇报：取本会话尚未汇报（reported_at IS NULL）的终态任务，组 brief
    （新结果 + 整盘快照），起一轮总管 turn，成功则标记 reported_at。

    返回 True 表示已消费（含「无未汇报任务」的空消费）；返回 False 表示起流被拒
    （总管占线），不标记 reported_at，留待补触发。

    幂等：reported_at 负责——已汇报过的终态任务不会再次入选。
    """
    from src.models.conversation import Conversation
    from src.models.workspace import cst_now
    from src.service.agent.orchestrator.dependency_scheduler import _SETTLED_STATES
    from src.service.agent.orchestrator.prompts import (
        build_delegation_execution_context,
    )
    from src.service.agent_stream_queue import StartResult
    from src.service.chat_service import ChatService

    # 取本会话尚未汇报且已终态的执行日志（按 id 升序，保持完成先后）
    new_logs = db.scalars(
        select(TaskExecutionLog)
        .where(
            TaskExecutionLog.orchestrator_conversation_id
            == orchestrator_conversation_id,
            TaskExecutionLog.reported_at.is_(None),
            TaskExecutionLog.run_status.in_(_SETTLED_STATES),
        )
        .order_by(TaskExecutionLog.id.asc())
    ).all()

    # 无未汇报终态任务 → 无事可做，视为已消费
    if not new_logs:
        return True

    conv = db.get(Conversation, orchestrator_conversation_id)
    if conv is None:
        # 会话已不存在：无从汇报，但也无可重试——视为已消费
        return True

    # 组 brief = 新结果摘要 + 整盘快照段（复用 B3）
    results = [_log_to_result(log) for log in new_logs]
    snapshot = build_delegation_execution_context(
        db, workspace_id, orchestrator_conversation_id
    )
    brief = f"{build_reentry_brief(results)}\n\n{snapshot}"

    # 写 assistant 流式占位（与 trigger_orchestrator_reentry 同：不插 user 消息）
    assistant_msg = ChatService._append_message(
        db, conversation=conv, role="assistant", content=""
    )
    assistant_msg.stream_state = "streaming"
    db.commit()

    # 用独立 session 构建 agent 并同步起流（拿到 StartResult 以决定是否标记）
    owned_db = _new_session()
    agent = _build_orchestrator_agent(
        workspace_id=workspace_id, db=owned_db, conversation_id=conv.id
    )
    result = _start_incremental_stream(
        conversation_id=conv.id,
        agent=agent,
        messages=[{"role": "user", "content": brief}],
        stream_msg_id=assistant_msg.id,
        workspace_id=workspace_id,
        owned_db=owned_db,
    )

    if result == StartResult.REJECTED:
        # 总管占线：回滚占位消息，不标记 reported_at，返回 False 留待补触发。
        # owned_db 不在此关闭——与 _schedule_reentry_stream REJECTED 分支保持一致。
        if assistant_msg.stream_state == "streaming":
            assistant_msg.stream_state = "failed"
            db.commit()
        return False

    # 非 REJECTED(STARTED/QUEUED)即视为成功消费:QUEUED 表示已稳妥排入队列、流终将起;
    # 队列满溢时 request_start 直接返回 REJECTED(走上面分支),故不存在"标记了却没汇报"。
    # 成功起流 → 标记这些日志为已汇报
    now = cst_now()
    for log in new_logs:
        log.reported_at = now
    db.commit()

    # 关键:增量汇报是「服务端发起」的总管流,前端已打开的会话不会主动接住。
    # 推一个事件让前端 refetch 总管会话消息 → 看到 streaming 占位 → resume/attach
    # 到这条流 → 实时显示(否则只有下次手动查看历史才出现)。
    try:
        from src.service.workspace_events import WorkspaceEventBus

        WorkspaceEventBus.push(
            workspace_id,
            {
                "type": "orchestrator_turn_started",
                "orchestrator_conversation_id": orchestrator_conversation_id,
            },
        )
    except Exception:
        logger.warning(
            "push orchestrator_turn_started failed conv=%s",
            orchestrator_conversation_id,
            exc_info=True,
        )
    return True


def collect_plan_execution_results(db: Session, plan) -> list[dict[str, Any]]:
    """收集某编排计划下所有子任务的执行结论（每任务取最新一条终态日志）。"""
    tasks = db.scalars(
        select(EmployeeTask).where(EmployeeTask.orchestration_plan_id == plan.id)
    ).all()
    results: list[dict[str, Any]] = []
    for t in tasks:
        log = db.scalars(
            select(TaskExecutionLog)
            .where(TaskExecutionLog.task_id == t.id)
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if log is None:
            results.append({
                "task_name": t.task_name,
                "status": "unknown",
                "content": "",
                "result": "",
                "error": None,
            })
            continue
        content = ""
        if log.output_json:
            try:
                content = json.loads(log.output_json).get("content", "") or ""
            except (ValueError, TypeError):
                content = ""
        results.append({
            "task_name": t.task_name,
            "status": log.run_status,
            "content": content,
            "result": log.run_result or "",
            "error": log.error_message,
        })
    return results


def build_reentry_brief(results: list[dict[str, Any]]) -> str:
    """把各子任务结论拼成给总管的整合指令（系统消息）。"""
    lines: list[str] = []
    for r in results:
        head = f"### 子任务：{r['task_name']}（{r['status']}）"
        lines.append(head)
        if r.get("content"):
            lines.append(r["content"])
        elif r.get("error"):
            lines.append(f"（失败）{r['error']}")
        elif r.get("result"):
            lines.append(r["result"])
        lines.append("")
    body = "\n".join(lines).strip()
    return (
        "（系统）你派出的团队子任务已全部完成。以下是各子任务的结论，"
        "团队的产物文件都在共享工作桌（$WORKSPACE_DIR，可直接 ls/read 查看）。\n\n"
        f"{body}\n\n"
        "请你**整合**这些成果，必要时读取共享桌上的产物文件核对，"
        "然后向用户给出一份完整、连贯的交付与说明。"
        "若有子任务失败，请如实说明并给出后续建议。不要重新派活，除非确有必要。"
    )
