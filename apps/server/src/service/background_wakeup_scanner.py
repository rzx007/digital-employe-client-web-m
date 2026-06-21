"""后台命令完成唤醒扫描器：apscheduler 周期调 scan_and_wake，发现 watch 的进程已结束且会话空闲时
触发续跑。依赖（shell_registry/watch_registry/stream_registry/wake_fn）可注入，便于单测。"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def scan_and_wake(*, shell_registry=None, watch_registry=None,
                  stream_registry=None, wake_fn=None) -> dict:
    if shell_registry is None:
        from src.service.shell_background_registry import get_background_shell_registry
        shell_registry = get_background_shell_registry()
    if watch_registry is None:
        from src.service.background_watch_registry import get_background_watch_registry
        watch_registry = get_background_watch_registry()
    if stream_registry is None:
        from src.service.stream_registry import registry as stream_registry  # 实现时确认导出名
    if wake_fn is None:
        wake_fn = _default_wake_fn

    scanned = woke = skipped_busy = dropped = 0
    for w in watch_registry.list_watching():
        scanned += 1
        r = shell_registry.poll(w.session_id)
        if not r.get("found"):
            watch_registry.drop(w.session_id)
            dropped += 1
            continue
        if r.get("running"):
            continue
        # finished
        if stream_registry.is_busy(w.conversation_id):
            skipped_busy += 1
            continue
        try:
            wake_fn(w, r)
        except Exception:
            logger.warning("[bg-wake] wake_fn failed sid=%s", w.session_id, exc_info=True)
            watch_registry.drop(w.session_id)
            dropped += 1
            continue
        watch_registry.mark_fired(w.session_id)
        woke += 1

    watch_registry.sweep_stale()
    return {"scanned": scanned, "woke": woke,
            "skipped_busy": skipped_busy, "dropped": dropped}


def _build_wake_user_message(*, session_id: str, exit_code, new_output: str,
                             tail_lines: int = 30) -> str:
    if new_output and new_output.strip():
        lines = new_output.rstrip("\n").split("\n")
        tail = "\n".join(lines[-tail_lines:])
    else:
        tail = "(输出已被回收)"
    return (
        f"[后台任务完成] session_id={session_id} exit_code={exit_code}\n"
        f"末尾输出:\n{tail}\n"
        f"请基于此结果继续之前的任务。"
    )


def _new_db_session():
    from src.db.session import get_session_local
    return get_session_local()()


def _default_wake_fn(watch, poll_result) -> None:
    """后台命令结束、会话空闲时触发续跑：组装唤醒消息→落库 user+assistant 两条消息→
    在主事件循环线程上构造 agent 并 registry.start 恢复对话。curator/employee 二分。
    """
    from src.models.conversation import Conversation, ConversationMessage
    from src.core.agent_runtime_policy import get_agent_runtime_policy
    from src.service.agent.orchestrator.runtime import get_main_loop
    from src.service.stream_registry import registry as stream_registry

    conv_id = watch.conversation_id
    wake_msg = _build_wake_user_message(
        session_id=watch.session_id,
        exit_code=poll_result.get("exit_code"),
        new_output=poll_result.get("new_output", ""),
    )
    db = _new_db_session()
    try:
        conv = db.get(Conversation, conv_id)
        if conv is None:
            logger.warning("[bg-wake] conversation %s gone, skip", conv_id)
            return
        db.add(ConversationMessage(conversation_id=conv_id, role="user",
                                   content=wake_msg, stream_state="completed"))
        policy = get_agent_runtime_policy()
        cap = policy.effective_max_inflight()
        slot_busy = cap > 0 and stream_registry.count_active_streams() >= cap
        asst_state = "queued" if slot_busy else "streaming"
        assistant = ConversationMessage(conversation_id=conv_id, role="assistant",
                                        content="", stream_state=asst_state)
        db.add(assistant)
        db.flush()
        asst_id = assistant.id
        workspace_id = conv.workspace_id
        target_type = watch.target_type
        db.commit()
    finally:
        db.close()

    main_loop = get_main_loop()
    main_loop.call_soon_threadsafe(
        _start_wake_stream_on_main,
        conv_id, asst_id, workspace_id, target_type, wake_msg,
    )


def _start_wake_stream_on_main(conv_id, asst_id, workspace_id, target_type,
                               wake_msg) -> None:
    """在主事件循环线程上构造 agent 并启动流，确保 Tool 的 ContextVar 与 astream 同线程。"""
    from src.service.stream_registry import registry as stream_registry

    messages = [{"role": "user", "content": wake_msg}]
    config = {"configurable": {"thread_id": conv_id}}
    if target_type == "curator":
        from src.service.agent.orchestrator import get_orchestrator_agent
        from src.service.agent.orchestrator.runtime import reset_context

        orch_db = _new_db_session()
        try:
            agent = get_orchestrator_agent(workspace_id, orch_db, conv_id,
                                           employee_id=None, bind_context=False)
            stream_registry.start(
                conversation_id=conv_id, agent=agent, messages=messages,
                config=config, stream_msg_id=asst_id, skill_name="",
                debug_content_only=False,
                orchestrator_owned_db=orch_db,
                orchestrator_workspace_id=workspace_id,
                orchestrator_conversation_id=conv_id,
                source="background_wakeup",
            )
        except Exception:
            logger.warning("[bg-wake] curator start failed conv=%s", conv_id,
                           exc_info=True)
            reset_context(conv_id)
            orch_db.close()
    else:
        try:
            from src.service.agent.orchestrator.execution import (
                build_employee_agent_for_wake,
            )

            agent = build_employee_agent_for_wake(conv_id)
            stream_registry.start(
                conversation_id=conv_id, agent=agent, messages=messages,
                config=config, stream_msg_id=asst_id, skill_name="",
                debug_content_only=False,
                orchestrator_conversation_id=None, source="background_wakeup",
            )
        except Exception:
            logger.warning("[bg-wake] employee start failed conv=%s", conv_id,
                           exc_info=True)
