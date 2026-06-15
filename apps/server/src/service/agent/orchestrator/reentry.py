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


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def trigger_orchestrator_reentry(db: Session, plan, workspace_id: int) -> int | None:
    """非群编排计划全部完成 → 唤醒总管起一轮整合 turn。群计划跳过。幂等。

    返回触发的 conversation_id，或 None（跳过/幂等）。
    """
    from src.models.conversation import Conversation
    from src.models.group_room import GroupRoom
    from src.service.chat_service import ChatService

    # 群路径：leader_conversation_id 指向此计划的会话 → 跳过（由 summarize_by_leader 处理）
    room = db.scalars(
        select(GroupRoom).where(GroupRoom.leader_conversation_id == plan.conversation_id)
    ).first()
    if room is not None:
        return None

    # 幂等：已整合过
    if plan.status == "summarized":
        return None

    conv = db.get(Conversation, plan.conversation_id)
    if conv is None:
        return None

    results = collect_plan_execution_results(db, plan)
    brief = build_reentry_brief(results)

    # 标记计划已整合（幂等门闩）
    plan.status = "summarized"

    # 在总管会话写入用户占位消息 + assistant 流式占位
    ChatService._append_message(
        db, conversation=conv, role="user", content="（系统）请整合团队成果"
    )
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
