"""后台命令完成后唤醒会话续跑（hermes 式 per-process watcher 的注入端）。

watcher 检测到后台命令退出后调用本模块：构造合成消息（小输出内联摘要，
超大输出只发完成信号让 agent 自行 shell_poll），并经 build_employee_agent_for_wake
在主事件循环线程触发新一轮 astream。本文件本期只实现消息构造（纯函数）。
"""
from __future__ import annotations

import asyncio
import logging

from src.service.shell_background_registry import get_background_shell_registry

logger = logging.getLogger(__name__)

# 运行中轮询间隔（秒）：命令仍在跑时每隔此秒数 poll 一次注册表。
_DEFAULT_POLL_INTERVAL = 2.0
# 退避上限：长任务时轮询间隔指数退避到此上限，降低空轮询开销。
_MAX_POLL_INTERVAL = 10.0
# 续跑合成消息的来源标记（前端/日志区分；priority 走默认）。
_WAKE_SOURCE = "background_wake"

# 输出阈值：对齐注册表 _MAX_POLL_BYTES（64KB）。超过则不内联，让 agent 自行 shell_poll。
_INLINE_OUTPUT_LIMIT = 64 * 1024
# 内联摘要的输出 tail 上限（按行边界切，参照 hermes #23284 防止从行中间起）。
_TAIL_CHARS = 2000


def _tail_on_line_boundary(text: str, limit: int = _TAIL_CHARS) -> str:
    if len(text) <= limit:
        return text
    tail = text[-limit:]
    nl = tail.find("\n")
    snapped = tail[nl + 1 :] if nl != -1 else tail
    return f"[… 输出已截断，仅显示末尾 {len(snapped)} 字符]\n{snapped}"


def build_wake_message(
    *, session_id: str, command: str, exit_code: int | None, output: str, output_size: int
) -> str:
    """构造续跑合成消息。小输出内联摘要；超阈值只发信号让 agent 自行 shell_poll。"""
    head = (
        f"[系统通知] 后台命令 {session_id} 已结束（exit={exit_code}）。\n"
        f"命令：{command}\n"
    )
    if output_size > _INLINE_OUTPUT_LIMIT:
        return (
            head
            + f"输出较大（{output_size} 字节），未内联。请用 shell_poll({session_id!r}) "
            "拉取完整输出后继续。"
        )
    return head + f"输出：\n{_tail_on_line_boundary(output)}"


def _inject_wake(*, conversation_id: int, message: str) -> None:
    """主事件循环线程内：以一条合成 user 消息触发该员工会话续跑一轮 astream。

    必须在主事件循环线程上调用（watcher 协程跑在主循环上，直接同步调用即可）。
    职责：
      1. 会话有进行中 turn → 跳过（不打断；本期不重试）。
      2. build_employee_agent_for_wake 构造续跑 agent（失败 log + return）。
      3. 建 user(合成通知)/assistant(空) 消息，registry.start 起一轮员工流并落库。

    参照 curator_injection.inject_curator_instruction 的「建双消息 + 快照 + start」流程，
    但走员工 agent（非总管）、不绑 orchestrator_owned_db。
    """
    import json

    from src.models.conversation import ConversationMessage
    from src.service.agent.orchestrator.execution import (
        build_employee_agent_for_wake,
    )
    from src.service.agent_stream_queue import StartResult
    from src.service.stream_registry import registry

    # 1. 进行中 turn → 不打断（registry.is_active 是会话级判活，见 stream_registry）。
    if registry.is_active(conversation_id):
        logger.info(
            "[bg-wake] conv=%s 有进行中 turn，跳过续跑注入（本期不重试）",
            conversation_id,
        )
        return

    # 2. 构造续跑 agent（必须在主循环线程；本函数即在主循环上调用）。
    try:
        agent = build_employee_agent_for_wake(conversation_id)
    except Exception:
        logger.warning(
            "[bg-wake] conv=%s 构造续跑 agent 失败，放弃注入",
            conversation_id,
            exc_info=True,
        )
        return

    # 3. 建双消息 + 起员工流。用独立 Session 落库后立即提交，避免跨线程复用。
    from src.db.session import get_session_local

    db = get_session_local()()
    try:
        user_msg = ConversationMessage(
            conversation_id=conversation_id,
            role="user",
            content=message,
            stream_state="completed",
            extra_meta=json.dumps({"backgroundWake": True}, ensure_ascii=False),
        )
        db.add(user_msg)
        assistant_msg = ConversationMessage(
            conversation_id=conversation_id,
            role="assistant",
            content="",
            stream_state="streaming",
        )
        db.add(assistant_msg)
        db.flush()
        assistant_msg_id = assistant_msg.id
        db.commit()
    except Exception:
        logger.warning(
            "[bg-wake] conv=%s 续跑消息落库失败，放弃注入",
            conversation_id,
            exc_info=True,
        )
        try:
            db.rollback()
        except Exception:
            pass
        return
    finally:
        db.close()

    result = registry.start(
        conversation_id=conversation_id,
        agent=agent,
        messages=[{"role": "user", "content": message}],
        config={"configurable": {"thread_id": conversation_id}},
        stream_msg_id=assistant_msg_id,
        skill_name="",
        debug_content_only=False,
        source=_WAKE_SOURCE,
    )
    if result == StartResult.REJECTED:
        logger.warning(
            "[bg-wake] conv=%s 续跑被拒（会话已有活跃/排队流），放弃本次唤醒",
            conversation_id,
        )
    else:
        logger.info(
            "[bg-wake] conv=%s 已注入续跑 msg=%s result=%s",
            conversation_id,
            assistant_msg_id,
            result,
        )


async def watch_background_command(
    *,
    session_id: str,
    conversation_id: int | None,
    command: str,
    poll_interval: float = _DEFAULT_POLL_INTERVAL,
) -> None:
    """per-process watcher：轮询注册表至后台命令退出，退出后注入续跑。

    - 运行中：每 poll_interval 秒 poll 一次，间隔指数退避到 _MAX_POLL_INTERVAL。
    - 命令从注册表消失（found=False）→ 静默退出（已被回收，无可注入）。
    - 无 conversation_id（裸 shell）→ 等退出后不注入。
    - agent 已主动 poll/wait 过结果（is_consumed_by_agent）→ 去重，不注入。

    watcher 调 poll **不传 agent_initiated**（保持默认 False），不污染去重标志。
    """
    reg = get_background_shell_registry()
    interval = poll_interval
    while True:
        await asyncio.sleep(interval)
        r = reg.poll(session_id)  # 不传 agent_initiated（默认 False）
        if not r.get("found"):
            return
        if not r.get("running"):
            break
        interval = min(interval * 1.5, _MAX_POLL_INTERVAL)

    if conversation_id is None:
        return
    if reg.is_consumed_by_agent(session_id):
        logger.info("[bg-wake] sid=%s 已被 agent 消费，跳过注入", session_id)
        return

    tail = reg.read_output_tail(session_id)
    output = tail.get("output", "") if isinstance(tail, dict) else ""
    # read_output_tail 真实返回 total_size（见 shell_background_registry）；
    # 兼容 size 别名与缺失（回退 len(output)）。
    if isinstance(tail, dict):
        output_size = tail.get("total_size") or tail.get("size") or len(output)
    else:
        output_size = len(output)
    message = build_wake_message(
        session_id=session_id,
        command=command,
        exit_code=r.get("exit_code"),
        output=output,
        output_size=output_size,
    )
    try:
        _inject_wake(conversation_id=conversation_id, message=message)
    except Exception:
        logger.warning(
            "[bg-wake] sid=%s conv=%s 注入续跑异常",
            session_id,
            conversation_id,
            exc_info=True,
        )
