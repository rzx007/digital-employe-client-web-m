"""共享：在 curator 会话注入一条指令并起 orchestrator 流。

调度器（task_scheduler_service）与飞书 channel 复用同一段逻辑：
建 user/assistant 消息 -> 快照 -> 投递主事件循环起流。
"""

import json
import logging

from src.service.agent.orchestrator import _get_main_loop

logger = logging.getLogger(__name__)

# channel 来源（飞书/未来钉钉、企微）。这些来源的 user 消息打 channel 标，
# 前端据此显示渠道徽标。"scheduled"/"web" 等非 channel 来源不打标。
_CHANNEL_SOURCES = {"feishu"}


def inject_curator_instruction(
    db,
    conversation,
    text,
    *,
    source: str,
    employee_id: int | None = None,
    priority: int | None = None,
    initial_msg_state: str = "streaming",
) -> tuple[int, int]:
    """在 curator 会话注入一条 user 指令并起 orchestrator 流。

    返回 (user_msg_id, assistant_msg_id)。source/priority 透传给 registry.start。

    注：喂给 agent 的 human 文本与存库 user 消息均用同一 ``text``。相比抽取前的
    ``_start_curator_task``（存库用 ``user_prompt or task_name``、喂 agent 用
    ``user_prompt or ""``），当 ``user_prompt`` 为空时本函数统一喂 ``text``（调用方传
    ``user_prompt or task_name``），即喂 agent 的文本由 ``''`` 收敛为 ``task_name``
    ——这是有意的良性统一。
    """
    from src.models.conversation import ConversationMessage

    # 用户消息（channel 来源打标，前端据此显示渠道徽标）
    channel_extra_meta = (
        json.dumps({"channel": source}, ensure_ascii=False)
        if source in _CHANNEL_SOURCES
        else None
    )
    user_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=text,
        stream_state="completed",
        extra_meta=channel_extra_meta,
    )
    db.add(user_msg)

    # 助手空消息
    assistant_msg = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content="",
        stream_state=initial_msg_state,
    )
    db.add(assistant_msg)
    db.flush()

    if initial_msg_state == "queued":
        assistant_msg.content = (
            assistant_msg.content or "已加入执行队列，等待其他对话完成"
        )

    conv_id = conversation.id
    user_msg_id = user_msg.id
    asst_msg_id = assistant_msg.id
    workspace_id_snap = conversation.workspace_id
    employee_id_snap = employee_id
    messages = [
        {"role": "user", "content": text},
    ]

    db.commit()

    # 在主事件循环上创建 agent 并启动流，确保总管 Tool 的 ContextVar 与 astream 同线程
    def _start_on_main() -> None:
        from src.db.session import get_session_local
        from src.service.agent.orchestrator import get_orchestrator_agent
        from src.service.agent.orchestrator.runtime import reset_context
        from src.service.agent_stream_queue import StartResult
        from src.service.stream_registry import registry

        orch_db = get_session_local()()
        try:
            # user_id 由 runtime 兜底从激活 workspace 所有者解析（见 resolve_user_id），
            # 此处 bind_context=False 不绑定。
            agent = get_orchestrator_agent(
                workspace_id_snap,
                orch_db,
                conv_id,
                employee_id=employee_id_snap,
                bind_context=False,
            )

            result = registry.start(
                conversation_id=conv_id,
                agent=agent,
                messages=messages,
                config={"configurable": {"thread_id": conv_id}},
                stream_msg_id=asst_msg_id,
                skill_name="",
                debug_content_only=False,
                orchestrator_owned_db=orch_db,
                orchestrator_workspace_id=workspace_id_snap,
                orchestrator_conversation_id=conv_id,
                priority=priority,
                source=source,
            )
            if result == StartResult.REJECTED:
                reset_context(conv_id)
                orch_db.close()
        except Exception:
            reset_context(conv_id)
            orch_db.close()
            logger.error(
                "curator 指令启动流失败 conv_id=%s source=%s",
                conv_id,
                source,
                exc_info=True,
            )

    main_loop = _get_main_loop()
    main_loop.call_soon_threadsafe(_start_on_main)

    return user_msg_id, asst_msg_id
