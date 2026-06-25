"""后台命令完成后唤醒会话续跑（hermes 式 per-process watcher 的注入端）。

watcher 检测到后台命令退出后调用本模块：构造合成消息（小输出内联摘要，
超大输出只发完成信号让 agent 自行 shell_poll），并经 build_employee_agent_for_wake
在主事件循环线程触发新一轮 astream。本文件本期只实现消息构造（纯函数）。
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

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
