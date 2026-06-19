from __future__ import annotations

import asyncio
import atexit
import json
import logging
import sys
import threading
import time
import traceback
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

# 递归上限异常：用于捕获 agent 失控的工具调用循环。容错 import，
# 版本差异/缺失时退化为一个永不匹配的占位类，不影响其它逻辑。
try:
    from langgraph.errors import GraphRecursionError as _GraphRecursionError
except Exception:  # pragma: no cover
    class _GraphRecursionError(Exception):  # type: ignore
        pass

from src.core.agent_runtime_policy import (
    HITL_RESUME_PRIORITY,
    ORCHESTRATION_PRIORITY,
    USER_CHAT_PRIORITY,
    get_agent_runtime_policy,
    resolve_stream_class,
)
from src.models.conversation import Conversation, ConversationMessage
from src.service.agent_stream_queue import AgentStreamQueue, PendingStart, StartResult

logger = logging.getLogger(__name__)

Subscriber = Callable[[dict], None]

HEARTBEAT_INTERVAL_SECONDS = 30.0
TASK_TTL_SECONDS = 20
BUFFER_CHECKPOINT_LEN = 500
RUNTIME_SNAPSHOT_PREVIEW_LIMIT = 5
# chunk 间超时：两个 chunk（token 或工具事件）之间最长等待。
# 过短会在「工具执行 + 模型思考」间隙误判流已结束（曾观测到 ~2.5min 任务被截断）。
# 默认 180s，可通过 config_kvs AGENT_CHUNK_TIMEOUT 调整。
AGENT_CHUNK_TIMEOUT = 180.0
FIRST_AGENT_CHUNK_TIMEOUT = 120.0
# 首包停滞看门狗：流启动后若 event_count==0 持续超过此秒数仍无任何 chunk，
# 自动 dump「卡住协程的 await 链 + 全线程栈」，钉死究竟卡在 aget_tuple（checkpointer
# 单连接/锁）、模型连接、还是别处。仅诊断用，不改变流本身的超时行为。
FIRST_CHUNK_STALL_DUMP_SECONDS = 15.0
# 最多 dump 几次（避免长时间无首包时把日志刷爆）
FIRST_CHUNK_STALL_DUMP_MAX = 3
# 自动判死阈值：某流连续无进展（无任何 chunk）超过此秒数 → 看门狗强制取消该流、
# 立即释放槽位。根因——模型端偶发卡死/无响应时，上层 chunk-timeout 的 pending 重试
# 循环会把僵死流续命到 ~20min、占着槽位拖垮全局（observed conv 卡 445s 仍不死）。
# 这是「成熟系统该有的故障隔离」：单条流卡死不拖累其它对话。150s 给正常长工具
# （如几十秒的脚本）留足余量，又能较快回收真卡死。可后续按需调小/做工具感知。
AUTO_KILL_NO_PROGRESS_SECONDS = 150.0
# 「内容级」无进展判死（核心隔离）：只在「真正出正文 token / 工具产出 tool_output」时
# 刷新内容计时；filler 事件（重复 messages/updates、空 chunk）不再续命。覆盖两类卡死：
#   - 首包卡：从未出过正文/工具产出 → elapsed 达阈值即判死（曾 ttft=- / tok=0 干等）；
#   - filler 空转：出过字后卡住、但 filler 事件仍在流 → 内容计时照样到点判死
#     （曾观测 ttft=6.86s 后空转 736s/12min、tok/s=0.0 才 error）。
# 工具执行期一有 tool_output 即刷新，不误杀正常长工具调用；嫌误杀可调大本值。
# 内容级判死阈值（兜底用，非主回收路径）。DB 锁(SQLITE_ACCESS_LOCK)那个真死锁已根治后，
# 本判死只为兜住「真卡死」，不需要激进。60s 太短会误杀正常重活——模型生成长代码/文档
# (如「创建 generate_docx.js」)、跑脚本时长时间不吐正文，却在干活。放宽默认到 240s，
# 并经 _auto_kill_no_content_seconds() 取「不低于 chunk/首包超时 + 60s」，可经 env 覆盖。
AUTO_KILL_NO_CONTENT_SECONDS = 900.0
# 活跃流硬墙：单流存在超过此秒数仍 active → 僵死清理。运行时 ≥ AGENT_STALL_TIMEOUT + 120s。
STALE_ACTIVE_HARD_TIMEOUT = 720.0
# 无进展超时（config_kvs AGENT_STALL_TIMEOUT）：默认 30min，仅约束「多久无 chunk 事件」清槽。
AGENT_STALL_TIMEOUT = 1800.0
# Agent 图 recursion_limit（LangGraph superstep 上限：每轮 think→调工具→看结果 ~2 步）。
# 历史曾硬编码 60，但正常的多步任务（浏览器自动化 + 技能执行 + 调试，单轮 30+ 工具调用）
# 会在第 60 步被 GraphRecursionError 腰斩、且伪装成 completed → 前端收到 [DONE] 误以为
# 已完成（2026-06-10 根因：observed conv 反复触限被腰斩、用户连发 3 次重试）。改为
# 「默认不限制」：注入这个大到正常任务永远触不到的哨兵；真失控（无限工具循环）交由
# 720s 单流硬墙(STALE_ACTIVE_HARD_TIMEOUT) + 900s 内容看门狗回收。经 settings /
# config_kvs AGENT_RECURSION_LIMIT 设正整数可重新设限（0/负 = 不限制）。
_UNLIMITED_RECURSION = 1_000_000
DB_LOCK_RETRY_COUNT = 2
DB_LOCK_RETRY_SLEEP_SECONDS = 0.05

# 专用「DB 写」单线程执行器：所有流的 checkpoint / 心跳 / 终态落库都走这一个
# 线程，串行排队执行。根因——多流并发时，每条流的心跳(30s一次)+checkpoint+终态
# flush 都用默认 asyncio 线程池且都写同一个 SQLite，既抢 SQLite 单写锁、又抢有限
# 的默认线程，导致某些 flush 卡死几分钟（栈停在 _flush_terminal 的 to_thread）。
# SQLite 本来就只能单写，串行化不损失吞吐，反而消除锁竞争与线程池耗尽。
_DB_WRITE_EXECUTOR = ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="db-write"
)


async def _run_db_write(fn, *args):
    """把一次 DB 写提交到专用单线程执行器（替代 asyncio.to_thread，避免锁/线程竞争）。"""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_DB_WRITE_EXECUTOR, fn, *args)


@atexit.register
def _shutdown_db_write_executor() -> None:
    try:
        _DB_WRITE_EXECUTOR.shutdown(wait=False, cancel_futures=True)
    except Exception:
        pass


def _agent_stream_timeouts() -> tuple[float, float, float]:
    """从 settings 读取 chunk / 首包 / 硬墙超时（带合理下限）。"""
    try:
        from src.core.config import get_settings

        s = get_settings()
        chunk = max(60.0, float(s.agent_chunk_timeout))
        first = max(30.0, float(s.agent_first_chunk_timeout))
        stale = max(
            chunk + first + 120.0,
            float(s.agent_stale_hard_timeout),
            float(s.execute_timeout) + 120.0,
            float(s.agent_stall_timeout) + 120.0,
        )
        return chunk, first, stale
    except Exception:
        return AGENT_CHUNK_TIMEOUT, FIRST_AGENT_CHUNK_TIMEOUT, STALE_ACTIVE_HARD_TIMEOUT


def _auto_kill_no_content_seconds() -> float:
    """内容级无进展判死阈值（兜底，非主回收）。默认 900s，避免误杀正常重活
    （生成长代码/文档、跑脚本时模型长时间不吐正文）。生效值不低于
    max(chunk_timeout, first_chunk_timeout) + 60s。
    取值优先级：config_kvs AGENT_NO_CONTENT_KILL_SECONDS > env 同名 > 默认 900s。"""
    import os

    configured = AUTO_KILL_NO_CONTENT_SECONDS
    try:
        from src.core.config import get_settings

        configured = float(get_settings().agent_no_content_kill_seconds)
    except Exception:
        try:
            configured = float(
                os.getenv(
                    "AGENT_NO_CONTENT_KILL_SECONDS", AUTO_KILL_NO_CONTENT_SECONDS
                )
            )
        except Exception:
            configured = AUTO_KILL_NO_CONTENT_SECONDS
    try:
        chunk, first, _ = _agent_stream_timeouts()
        floor = max(chunk, first) + 60.0
    except Exception:
        floor = 120.0
    return max(configured, floor)


def _agent_stall_timeout() -> float:
    """无进展判定阈值：超过此秒数无任何 stream 事件则释放槽位。

    生效值 ≥ max(chunk_timeout, first_chunk_timeout) + 60s，避免比 chunk 间
    等待上限更短而误杀重任务（长 prompt 预处理 / 模型长思考）。
    """
    try:
        from src.core.config import get_settings

        configured = max(30.0, float(get_settings().agent_stall_timeout))
        chunk, first, _ = _agent_stream_timeouts()
        floor = max(chunk, first) + 60.0
        return max(configured, floor)
    except Exception:
        return max(AGENT_STALL_TIMEOUT, AGENT_CHUNK_TIMEOUT + 60.0)


def _agent_recursion_limit() -> int:
    """Agent 图 recursion_limit。默认 0=不限制 → 返回大哨兵(_UNLIMITED_RECURSION)，
    正常多步任务永不触发 GraphRecursionError；真失控由 720s 硬墙 + 900s 内容看门狗回收。
    settings / config_kvs AGENT_RECURSION_LIMIT 设正整数可重新设限（0/负 = 不限制）。"""
    try:
        from src.core.config import get_settings

        configured = int(get_settings().agent_recursion_limit)
    except Exception:
        configured = 0
    if configured <= 0:
        return _UNLIMITED_RECURSION
    return configured


async def _graph_has_pending_non_interrupt_work(agent: Any, config: dict) -> bool:
    """LangGraph 是否仍有待执行节点（非 HITL interrupt）。

    chunk 超时(180s 无任何 chunk)时据此区分「健康长流」与「真结束」：
    - next 非空且无 interrupt → 图里还有节点要跑（静默长工具/模型长思考），续等；
    - next 为空 / 仅 HITL interrupt / 读状态失败 → 不续等，按收尾处理。
    读状态失败保守返回 False（宁可收尾也不无限续等；真挂死另有 900s 内容看门狗兜）。
    """
    try:
        state = await agent.aget_state(config)
    except Exception:
        return False
    if not getattr(state, "next", None):
        return False
    for task_item in getattr(state, "tasks", ()) or ():
        if getattr(task_item, "interrupts", None):
            return False
    return True


def _usage_from_serialized_message(msg: Any) -> dict | None:
    """从一个序列化后的 message 取 usage_metadata。

    LC constructor 格式把它放在 kwargs 下；自定义兜底序列化放在顶层。两处都查。
    """
    if not isinstance(msg, dict):
        return None
    direct = msg.get("usage_metadata")
    if direct:
        return direct
    kwargs = msg.get("kwargs")
    if isinstance(kwargs, dict) and kwargs.get("usage_metadata"):
        return kwargs["usage_metadata"]
    return None


def _raw_has_subagent_ns(raw: dict) -> bool:
    """该 buffer 事件是否来自子任务（task 子图，ns 非空）。

    子代理在自己独立的小上下文上跑，其 input_tokens 不代表父轮的上下文大小，
    统计父轮用量时须排除（见 _event_subagent_ns）。
    """
    ns = raw.get("ns")
    return isinstance(ns, (list, tuple)) and len(ns) > 0


def _extract_peak_usage_from_buffer(events: list[dict]) -> dict | None:
    """从 buffer 取本轮 input_tokens 峰值的 usage_metadata（排除子任务）。

    一轮带工具调用的回复会发起多次 LLM 调用：上下文随工具结果累积而增长，
    最后一次调用可能跑在被裁剪过的较小上下文上。驱动摘要/压缩、也是用户该看到
    的「上下文用量」是本轮的**峰值**输入，而非最后一次调用。故取 input_tokens
    最大的那次（并列时取较晚一次，输出更接近本轮真实尾状态）。

    v2 stream_mode=["messages",...] 落库后的真实结构为：
      {"type":"messages","ns":[...],"data":[[<序列化 message>, <metadata>]]}
    message 双层嵌套在 data[0][0]，usage 又在该 message 的 kwargs 下
    （LangChain LC constructor 格式）。ns 非空 = 子任务，跳过。
    """
    best: dict | None = None
    best_input = -1
    for event in events:
        if not isinstance(event, dict):
            continue
        raw = event.get("data")
        if not isinstance(raw, dict):
            continue
        if _raw_has_subagent_ns(raw):
            continue
        # 兜底序列化路径：usage 可能直接挂在 raw 顶层。
        candidates: list[dict] = []
        if raw.get("usage_metadata"):
            candidates.append(raw["usage_metadata"])
        elif raw.get("type") == "messages":
            inner = raw.get("data")
            if isinstance(inner, list):
                # inner = [[<msg>, <metadata>], ...]；逐个 [msg, meta] 对取 message。
                for pair in inner:
                    msg = pair[0] if isinstance(pair, list) and pair else pair
                    usage = _usage_from_serialized_message(msg)
                    if usage:
                        candidates.append(usage)
        for usage in candidates:
            try:
                cur = int(usage.get("input_tokens") or 0)
            except (TypeError, ValueError):
                cur = 0
            # >= 让并列时较晚（buffer 顺序靠后）的胜出。
            if cur >= best_input:
                best_input = cur
                best = usage
    return best


def _flush_to_db_sync(
    stream_msg_id: int,
    buffer_cursor: int,
    state: str | None = None,
    content: str | None = None,
    error_message: str | None = None,
    message_parts: str | None = None,
    usage_metadata: dict | None = None,
    elapsed_ms: int | None = None,
) -> bool:
    """同步写入会话消息流状态；在 asyncio.to_thread 中调用，勿跨线程复用 Session。"""
    from src.db.session import sqlite_db_session

    with sqlite_db_session() as db:
        for attempt in range(DB_LOCK_RETRY_COUNT):
            try:
                msg = db.get(ConversationMessage, stream_msg_id)
                if not msg:
                    logger.warning(
                        "[flush] msg_id=%s not found in DB, skip", stream_msg_id
                    )
                    return False
                if state is not None:
                    msg.stream_state = state
                if content is not None:
                    msg.content = content
                if error_message is not None:
                    try:
                        meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                    meta["error_message"] = error_message
                    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
                msg.stream_cursor = buffer_cursor
                if message_parts is not None:
                    msg.message_parts = message_parts
                if usage_metadata is not None:
                    try:
                        meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                    meta["usage"] = usage_metadata
                    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
                if elapsed_ms is not None:
                    try:
                        meta = json.loads(msg.extra_meta) if msg.extra_meta else {}
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                    meta["elapsed_ms"] = elapsed_ms
                    msg.extra_meta = json.dumps(meta, ensure_ascii=False)
                db.commit()
                logger.info(
                    "[flush] msg_id=%s committed: state=%s, content_len=%s, parts_len=%s",
                    stream_msg_id,
                    state,
                    len(content) if content else None,
                    len(message_parts) if message_parts else None,
                )
                return True
            except OperationalError as e:
                db.rollback()
                is_locked = "database is locked" in str(e).lower()
                if not is_locked:
                    logger.warning(
                        "[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True
                    )
                    return False
                if attempt >= DB_LOCK_RETRY_COUNT - 1:
                    logger.warning(
                        "[flush] msg_id=%s FAILED after lock retries=%d",
                        stream_msg_id,
                        DB_LOCK_RETRY_COUNT,
                        exc_info=True,
                    )
                    return False
                time.sleep(DB_LOCK_RETRY_SLEEP_SECONDS * (attempt + 1))
            except Exception:
                logger.warning(
                    "[flush] msg_id=%s FAILED", stream_msg_id, exc_info=True
                )
                db.rollback()
                return False
        return False


_ORCHESTRATION_QUEUE_PLACEHOLDERS = (
    "已加入执行队列，等待其他对话完成",
    "等待总管会话结束，即将开始执行…",
    "等待组长会话结束，即将开始执行…",
    "排队中，等待执行",
)


def _is_queue_placeholder_content(content: str | None) -> bool:
    if not content:
        return False
    text = content.strip()
    if text in _ORCHESTRATION_QUEUE_PLACEHOLDERS:
        return True
    return any(
        marker in text
        for marker in ("已加入执行队列", "等待总管会话结束", "排队中，等待")
    )


def _clear_queue_placeholder_content(msg: ConversationMessage) -> None:
    """出队/开流时清掉排队占位文案，避免前端仍显示「等待其他对话完成」。"""
    if _is_queue_placeholder_content(msg.content):
        msg.content = ""


def _mark_stream_state_sync(
    stream_msg_id: int,
    conversation_id: int,
    state: str,
    *,
    error_message: str | None = None,
) -> None:
    """更新消息与执行日志的启动状态，供排队/出队路径使用。"""
    from src.db.session import sqlite_db_session
    from src.models.task_execution_log import TaskExecutionLog

    with sqlite_db_session() as db:
        try:
            msg = db.get(ConversationMessage, stream_msg_id)
            if msg:
                msg.stream_state = state
                if state == "queued":
                    msg.content = msg.content or "已加入执行队列，等待其他对话完成"
                elif state == "error":
                    msg.content = error_message or msg.content or "启动失败"
                elif state == "streaming":
                    _clear_queue_placeholder_content(msg)

            logs = list(
                db.scalars(
                    select(TaskExecutionLog).where(
                        TaskExecutionLog.conversation_id == conversation_id,
                        TaskExecutionLog.run_status.in_(("running", "queued")),
                    )
                ).all()
            )
            for log in logs:
                if state == "queued":
                    log.run_status = "queued"
                    log.run_result = "排队中，等待执行"
                elif state == "cancelled":
                    log.run_status = "cancelled"
                    log.run_result = "排队任务已取消"
                elif state == "error":
                    log.run_status = "failed"
                    log.run_result = "任务执行失败"
                    log.error_message = (error_message or "启动失败")[:2000]
                else:
                    log.run_status = "running"
                    log.run_result = "执行中"
            db.commit()
        except Exception:
            db.rollback()
            logger.warning(
                "[state] failed to mark stream msg_id=%s conv=%s state=%s",
                stream_msg_id,
                conversation_id,
                state,
                exc_info=True,
            )


def _fire_and_forget_mark_state(
    stream_msg_id: int,
    conversation_id: int,
    state: str,
    *,
    error_message: str | None = None,
) -> None:
    """将 _mark_stream_state_sync 提交到 DB 写线程，不阻塞事件循环。

    历史问题：_mark_stream_state_sync 直接在事件循环上做同步 SQLite 写，
    当 app.db 写锁被其他流持有时可阻塞 30s，期间事件循环无法调度任何协程，
    导致 agent.astream() 无法发 httpx 请求、run_coro_on_main_loop 超时。
    """
    _DB_WRITE_EXECUTOR.submit(
        _mark_stream_state_sync,
        stream_msg_id,
        conversation_id,
        state,
        error_message=error_message,
    )


def _flush_heartbeat_sync(conversation_id: int) -> None:
    from src.db.session import sqlite_db_session
    from src.models.task_execution_log import TaskExecutionLog
    from src.models.workspace import cst_now

    with sqlite_db_session() as db:
        try:
            log = db.scalars(
                select(TaskExecutionLog).where(
                    TaskExecutionLog.conversation_id == conversation_id,
                    TaskExecutionLog.run_status == "running",
                )
            ).first()
            if not log:
                return
            log.last_heartbeat_at = cst_now()
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass


def _event_subagent_ns(chunk: Any) -> str | None:
    """从原始 chunk 取「子任务命名空间」：subgraphs=True 后 task 工具派生的子图事件
    带非空 ns=('tools:<uuid>', ...)。顶层事件 ns=()/None ⇒ 返回 None（非子任务）。

    返回首段字符串（如 'tools:e0abbded-...'）作为该子任务的稳定标识；前端据此把
    逐字 token 分流到对应子任务 lane。结构：{"type":..., "ns": (...), "data":...}。
    """
    try:
        if not isinstance(chunk, dict):
            return None
        ns = chunk.get("ns")
        if not ns:
            return None
        if isinstance(ns, (list, tuple)) and len(ns) > 0:
            first = ns[0]
            return str(first) if first else None
        return None
    except Exception:
        return None


def _chunk_is_tool_message(serializable: Any) -> bool:
    """判断一个 v2 messages 事件是否来自 ToolMessage（工具返回，非模型自然语言）。

    群协作 relay 只该把「模型说的话（AIMessage）」推到群时间线；工具的输入/输出
    （read 读到的文件原文、create_orchestration_plan 返回的 JSON、shell 输出等）
    都是 ToolMessage，绝不能糊到群里。结构：
      {"type":"messages","data":[[<序列化 message>, <metadata>]]}
    序列化 message 形如 {"id":[...,"ToolMessage"], "kwargs":{"type":"tool",...}}。
    """
    try:
        if not isinstance(serializable, dict):
            return False
        if serializable.get("type") != "messages":
            return False
        data = serializable.get("data")
        if not isinstance(data, list) or not data:
            return False
        inner = data[0]
        msg = inner[0] if isinstance(inner, list) and inner else inner
        if not isinstance(msg, dict):
            return False
        # id 数组里带 "ToolMessage"
        id_field = msg.get("id")
        if isinstance(id_field, list) and any(
            isinstance(x, str) and "ToolMessage" in x for x in id_field
        ):
            return True
        # kwargs.type == "tool"
        kwargs = msg.get("kwargs")
        if isinstance(kwargs, dict) and kwargs.get("type") == "tool":
            return True
        return False
    except Exception:
        return False


def _dump_all_thread_stacks(top_frames: int = 6) -> list[dict[str, Any]]:
    """dump 所有线程当前栈顶若干帧，定位卡在线程内同步阻塞的元凶。

    asyncio task 的 get_stack() 只能看到协程 await 点，看不到 run_in_executor /
    to_thread 线程内部的同步阻塞（subprocess 读、文件写、锁等待）。用
    sys._current_frames() + threading.enumerate() 把每个线程的真实栈顶 dump 出来。
    """
    out: list[dict[str, Any]] = []
    try:
        name_by_id = {t.ident: t.name for t in threading.enumerate()}
        frames = sys._current_frames()
        for tid, frame in frames.items():
            stack = traceback.extract_stack(frame)[-top_frames:]
            out.append({
                "thread_id": tid,
                "name": name_by_id.get(tid, "?"),
                "stack": [
                    f"{f.filename.rsplit('/', 1)[-1].rsplit(chr(92), 1)[-1]}"
                    f":{f.lineno} {f.name}"
                    for f in stack
                ],
            })
    except Exception:
        pass
    return out


def _checkpoint_flush_sync(
    stream_msg_id: int,
    buffer_cursor: int,
    buffer_events_snapshot: list[dict],
    content: str | None,
    conversation_id: int | None = None,
) -> bool:
    """流式中途 checkpoint：只落 content + cursor，不解析 message_parts。

    历史缺陷：每次 checkpoint 都 extract_message_parts_from_buffer(全量 buffer)，
    它从头重放所有事件。checkpoint 每 BUFFER_CHECKPOINT_LEN(500) 事件触发一次，
    于是重放量 500+1000+...+N → O(n²)。产出大文档的任务（Word/PPT 生成几千事件）
    会因此越跑越慢、最终卡死在 checkpoint。content（纯文本）足够支撑“崩溃恢复时
    显示已生成文本”；完整 message_parts 在终态 _flush_terminal 时解析一次即可。
    buffer_events_snapshot 不再使用，仅保留签名兼容调用方。

    存储后端按 settings.stream_progress_backend：file（默认）写 per-message 进度
    sidecar 文件，高频写彻底离开 SQLite，消除并发流对 app.db 单写锁的争用；
    sqlite（回滚）仍写 conversation_messages 行。
    """
    _ = buffer_events_snapshot  # noqa: F841 — 不再全量重放，消除 O(n²)
    from src.core.config import get_settings

    if get_settings().stream_progress_backend != "sqlite":
        from src.service.stream_progress_store import get_progress_store

        get_progress_store().write(
            message_id=stream_msg_id,
            conversation_id=conversation_id or 0,
            state="streaming",
            cursor=buffer_cursor,
            content=content,
        )
        return True
    return _flush_to_db_sync(
        stream_msg_id,
        buffer_cursor,
        state="streaming",
        content=content,
    )


def _extract_interrupt_payload(interrupts: list) -> dict:
    """从 LangGraph state.tasks[].interrupts 提取 HITL 载荷。"""
    action_requests = []
    review_configs = []
    for interrupt_item in interrupts:
        value = getattr(interrupt_item, "value", None)
        if isinstance(value, dict):
            if "action_requests" in value:
                action_requests.extend(value["action_requests"])
            if "review_configs" in value:
                review_configs.extend(value["review_configs"])
    return {
        "action_requests": action_requests,
        "review_configs": review_configs,
    }


def _flush_terminal_sync(
    stream_msg_id: int,
    buffer_cursor: int,
    buffer_events_snapshot: list[dict],
    state: str,
    content: str | None,
    error_message: str | None = None,
    elapsed_ms: int | None = None,
    interrupt_payload: dict | None = None,
    conversation_id: int | None = None,
) -> bool:
    from src.service.hitl_pending_parts import extract_message_parts_for_interrupt
    from src.service.message_parts_extractor import extract_message_parts_from_buffer

    message_parts_json: str | None = None
    try:
        if interrupt_payload:
            parts = extract_message_parts_for_interrupt(
                buffer_events_snapshot,
                interrupt_payload,
                stream_msg_id,
            )
        else:
            terminal = state if state in ("cancelled", "error", "interrupted") else None
            parts = extract_message_parts_from_buffer(
                buffer_events_snapshot,
                terminal_state=terminal,
            )
        if parts:
            message_parts_json = json.dumps(parts, ensure_ascii=False)
    except Exception:
        logger.warning(
            "[flush] msg_id=%s message_parts extraction failed",
            stream_msg_id,
            exc_info=True,
        )

    usage_meta = _extract_peak_usage_from_buffer(buffer_events_snapshot)
    if usage_meta is None and conversation_id is not None:
        from src.service.usage_estimation import (
            estimate_usage_for_conversation_turn_sync,
        )

        usage_meta = estimate_usage_for_conversation_turn_sync(
            conversation_id,
            stream_msg_id,
            content,
            message_parts_json,
        )
        if usage_meta:
            logger.info(
                "[flush] msg_id=%s usage estimated: input=%s output=%s",
                stream_msg_id,
                usage_meta.get("input_tokens"),
                usage_meta.get("output_tokens"),
            )

    ok = _flush_to_db_sync(
        stream_msg_id,
        buffer_cursor,
        state=state,
        content=content,
        error_message=error_message,
        message_parts=message_parts_json,
        usage_metadata=usage_meta,
        elapsed_ms=elapsed_ms,
    )

    # 终态结果已落 app.db（历史永久记录），清理瞬时进度 sidecar——此后 DB 为唯一
    # 真相，列表/resume 的 overlay 自动失效。仅 file 后端需要清理。
    from src.core.config import get_settings

    if get_settings().stream_progress_backend != "sqlite":
        try:
            from src.service.stream_progress_store import get_progress_store

            get_progress_store().delete(stream_msg_id)
        except Exception:
            logger.warning(
                "[flush] delete progress sidecar failed msg=%s",
                stream_msg_id,
                exc_info=True,
            )
    return ok


class StreamEventBuffer:
    def __init__(self, conversation_id: int):
        self.conversation_id = conversation_id
        self._events: deque[dict] = deque()
        self._seq = 0

    def add(self, data: Any) -> dict:
        self._seq += 1
        event = {"seq": self._seq, "data": data}
        self._events.append(event)
        return event

    def get_events_after(self, cursor: int) -> list[dict]:
        return [e for e in self._events if e["seq"] > cursor]

    @property
    def cursor(self) -> int:
        return self._seq

    @property
    def events(self) -> list[dict]:
        return list(self._events)


def _resolve_conversation_titles(conversation_ids: set[int]) -> dict[int, str]:
    if not conversation_ids:
        return {}
    from src.db.session import get_session_local

    db = get_session_local()()
    try:
        result: dict[int, str] = {}
        for row in db.execute(
            select(Conversation.id, Conversation.title).where(
                Conversation.id.in_(conversation_ids)
            )
        ).all():
            cid, title = row[0], row[1]
            result[int(cid)] = (title or "").strip() or f"会话 #{cid}"
        return result
    except Exception:
        logger.warning("resolve conversation titles failed", exc_info=True)
        return {cid: f"会话 #{cid}" for cid in conversation_ids}
    finally:
        db.close()


class ActiveStreamTask:
    def __init__(
        self,
        conversation_id: int,
        *,
        stream_msg_id: int | None = None,
        source: str = "user_chat",
        stream_class: str = "light",
    ):
        self.conversation_id = conversation_id
        self.stream_msg_id = stream_msg_id
        self.source = source
        self.stream_class = stream_class
        self.status: str = "streaming"
        self.buffer = StreamEventBuffer(conversation_id)
        self.subscribers: set[Subscriber] = set()
        self._asyncio_task: asyncio.Task | None = None
        self._cleanup_task: asyncio.Task | None = None
        self.error_message: str | None = None
        self._created_at: float = time.monotonic()
        self._last_progress_at: float = time.monotonic()
        # 「内容级进展」时间：仅由真实正文 token / 工具产出刷新（见 touch_content）。
        # 与 _last_progress_at（任意事件）区分，用于内容级判死，防 filler 续命僵尸流。
        self._last_content_at: float = time.monotonic()

    @property
    def is_active(self) -> bool:
        return self.status == "streaming"

    def touch_progress(self) -> None:
        """记录最近一次 stream chunk/工具事件时间（任意事件，无进展超时检测用）。"""
        self._last_progress_at = time.monotonic()

    def touch_content(self) -> None:
        """记录最近一次「真实内容进展」（模型正文 token / 工具产出 tool_output）。
        filler 事件（重复 messages/updates、空 chunk）不调用本方法，故「事件在流、
        正文不涨」的僵尸流不会被续命，会在 AUTO_KILL_NO_CONTENT_SECONDS 被判死释放槽位。"""
        self._last_content_at = time.monotonic()

    def subscribe(self, fn: Subscriber) -> None:
        self.subscribers.add(fn)

    def unsubscribe(self, fn: Subscriber) -> None:
        self.subscribers.discard(fn)


class StreamRegistry:
    def __init__(self) -> None:
        self._tasks: dict[int, ActiveStreamTask] = {}
        self._queue = AgentStreamQueue()
        self.on_task_finalized: Callable[..., None] | None = None

    def is_active(self, conversation_id: int) -> bool:
        task = self._tasks.get(conversation_id)
        return task is not None and task.is_active

    def is_busy(self, conversation_id: int) -> bool:
        """会话是否占用流槽（正在执行或已在全局队列中等待）。"""
        task = self._tasks.get(conversation_id)
        if not task:
            return False
        return task.is_active or task.status == "queued"

    def count_active_streams(self) -> int:
        active = 0
        for conversation_id, task in list(self._tasks.items()):
            if not task.is_active:
                continue
            if self._stream_task_is_stale_active(task):
                self._clear_stale_active_task(conversation_id, task)
                continue
            active += 1
        return active

    def count_active_heavy(self) -> int:
        """统计当前在跑的"重活"数量（资源阀门 heavy/light 分级用）。"""
        heavy = 0
        for conversation_id, task in list(self._tasks.items()):
            if not task.is_active:
                continue
            if self._stream_task_is_stale_active(task):
                self._clear_stale_active_task(conversation_id, task)
                continue
            if getattr(task, "stream_class", "light") == "heavy":
                heavy += 1
        return heavy

    def queue_depth(self) -> int:
        return self._queue.depth()

    def snapshot_agent_runtime_status(
        self,
        *,
        preview_limit: int = RUNTIME_SNAPSHOT_PREVIEW_LIMIT,
    ) -> dict[str, list[dict[str, Any]]]:
        """供 /system/runtime 展示执行中与排队会话摘要。"""
        # 顺带清理僵死流，避免占槽不释放（监控轮询即触发回收）
        self.count_active_streams()
        active_rows: list[tuple[int, str]] = []
        for conv_id, task in self._tasks.items():
            if task.is_active and not self._stream_task_is_stale_active(task):
                active_rows.append((conv_id, task.source or "user_chat"))

        queued_rows: list[tuple[int, str, int]] = []
        for item in self._queue._items[:preview_limit]:
            queued_rows.append(
                (item.conversation_id, item.source, item.priority)
            )

        conv_ids = {cid for cid, _ in active_rows} | {cid for cid, _, _ in queued_rows}
        titles = _resolve_conversation_titles(conv_ids)

        active_items = [
            {
                "conversation_id": cid,
                "source": src,
                "title": titles.get(cid, f"会话 #{cid}"),
            }
            for cid, src in active_rows[:preview_limit]
        ]
        queued_items = [
            {
                "conversation_id": cid,
                "source": src,
                "priority": priority,
                "title": titles.get(cid, f"会话 #{cid}"),
            }
            for cid, src, priority in queued_rows
        ]
        return {"active_items": active_items, "queued_items": queued_items}

    def debug_dump_streams(self) -> dict[str, Any]:
        """运行时自省：dump 所有流（含僵尸）的完整状态，供不重启定位卡死。

        每条流给出：存在时长、asyncio task 是否 done、是否被判僵死、占的槽
        类别、缓冲事件数等。配合 GET /system/streams/debug 使用。
        """
        now = time.monotonic()
        policy = get_agent_runtime_policy()
        tasks_info: list[dict[str, Any]] = []
        for cid, task in list(self._tasks.items()):
            at = task._asyncio_task
            age = now - getattr(task, "_created_at", now)
            # 卡死诊断：dump 协程当前调用栈最后几帧，直接看出它卡在哪一行 await。
            # 活跃且 asyncio task 未完成时才采集（这正是“卡住不动”的流）。
            stack_frames: list[str] = []
            if at is not None and not at.done():
                try:
                    for frame in at.get_stack(limit=8):
                        co = frame.f_code
                        stack_frames.append(
                            f"{co.co_filename.rsplit('/', 1)[-1].rsplit(chr(92), 1)[-1]}"
                            f":{frame.f_lineno} {co.co_name}"
                        )
                except Exception:
                    pass
            tasks_info.append({
                "conversation_id": cid,
                "source": task.source,
                "stream_class": task.stream_class,
                "status": task.status,
                "is_active": task.is_active,
                "age_seconds": round(age, 1),
                "asyncio_task_done": (at.done() if at is not None else None),
                "asyncio_task_present": at is not None,
                "is_stale": self._stream_task_is_stale_active(task)
                if task.is_active else False,
                "stale_hard_timeout": _agent_stream_timeouts()[2],
                "buffer_events": len(task.buffer._events),
                "buffer_cursor": task.buffer.cursor,
                "subscribers": len(task.subscribers),
                "error_message": task.error_message,
                "stream_msg_id": task.stream_msg_id,
                # 卡死时这里直接显示卡在哪几行代码（栈顶=当前 await 点）
                "stack": stack_frames,
            })
        queued_info = [
            {
                "conversation_id": it.conversation_id,
                "source": it.source,
                "stream_class": it.stream_class,
                "priority": it.priority,
            }
            for it in self._queue._items
        ]
        return {
            "gates": {
                "serial_mode": policy.serial_mode,
                "max_inflight": policy.max_inflight,
                "effective_max_inflight": policy.effective_max_inflight(),
                "max_heavy": policy.max_heavy,
                "effective_max_heavy": policy.effective_max_heavy(),
                "light_slot_reserve": policy.light_slot_reserve(),
                "heavy_inflight_ceiling": policy.effective_max_inflight_for("heavy"),
                "active_streams": self.count_active_streams(),
                "active_heavy": self.count_active_heavy(),
                "queue_depth": self._queue.depth(),
                "slot_gating_enabled": policy.slot_gating_enabled(),
                "can_admit_heavy": self.can_admit("heavy"),
                "can_admit_light": self.can_admit("light"),
            },
            "tasks": tasks_info,
            "queued": queued_info,
            # 全线程栈：定位「卡在线程内同步阻塞」的元凶（shell 读输出 / 文件写 /
            # 子进程），asyncio task 栈看不到线程内部，这里 dump 所有线程当前栈顶。
            "threads": _dump_all_thread_stacks(),
        }

    def force_clear_stream(self, conversation_id: int) -> dict[str, Any]:
        """运行时手动解封：强制清掉一个卡死的流并释放槽位（不重启）。

        配合 POST /system/streams/{conversation_id}/force-clear 使用。
        会取消其 asyncio task、标记 error、并尝试 drain 队列让后续流入场。
        """
        task = self._tasks.get(conversation_id)
        if task is None:
            return {"cleared": False, "reason": "no task in registry"}
        prev_status = task.status
        self._clear_stale_active_task(conversation_id, task)
        # 标记 DB 消息为 failed，避免前端永久 streaming 转圈
        if task.stream_msg_id is not None:
            try:
                _fire_and_forget_mark_state(
                    task.stream_msg_id, conversation_id, "failed"
                )
            except Exception:
                logger.warning(
                    "force_clear: mark DB failed conv=%s", conversation_id,
                    exc_info=True,
                )
        # 群协作流：注销可能泄漏的 relay
        try:
            from src.service.group_room_service import (
                unregister_group_stream_relay,
            )

            unregister_group_stream_relay(conversation_id)
        except Exception:
            pass
        logger.warning(
            "force_clear_stream conv=%s prev_status=%s → cleared",
            conversation_id, prev_status,
        )
        return {
            "cleared": True,
            "conversation_id": conversation_id,
            "prev_status": prev_status,
        }

    def force_clear_all(
        self,
        *,
        include_queued: bool = True,
        stall_threshold_s: float = 30.0,
        force: bool = False,
    ) -> dict[str, Any]:
        """清掉**卡住的**在飞流并腾空槽位（不重启进程）。

        配合「清理僵尸流」按钮 POST /system/streams/force-clear-all 使用。
        默认**只清真卡住的**（asyncio task 已结束 / 无进展超过 stall_threshold_s 秒），
        **正在正常产出的健康流一律放过**——避免误杀用户当前正在跑的请求
        （历史教训：旧版无脑清所有在飞流，点一下就把正在「查询微博热搜」的活流也清了，
        显示“流超时仍未结束，已清理”）。force=True 时才连健康流一起清（核弹模式）。
        """
        cleared: list[int] = []
        spared: list[int] = []
        now = time.monotonic()
        # 复制一份再迭代：force_clear 会改 self._tasks
        for cid, task in list(self._tasks.items()):
            if not (task.is_active or task.status == "queued"):
                continue
            at = task._asyncio_task
            stalled = now - getattr(task, "_last_progress_at", now)
            is_stuck = (
                force
                or at is None
                or at.done()
                or stalled >= stall_threshold_s
            )
            if not is_stuck:
                spared.append(cid)  # 健康、正在产出 → 放过
                continue
            try:
                res = self.force_clear_stream(cid)
                if res.get("cleared"):
                    cleared.append(cid)
            except Exception:
                logger.warning("force_clear_all: failed conv=%s", cid, exc_info=True)
        # 清空全局排队项（未启动的）
        drained_queue = 0
        if include_queued:
            try:
                while self._queue.depth() > 0:
                    item = self._queue._items[0]
                    self._queue.remove(item.conversation_id)
                    drained_queue += 1
            except Exception:
                logger.warning("force_clear_all: drain queue failed", exc_info=True)
        logger.warning(
            "force_clear_all: cleared %d stuck stream(s)=%s, spared %d healthy=%s, drained %d queued (force=%s)",
            len(cleared), cleared, len(spared), spared, drained_queue, force,
        )
        return {
            "cleared_count": len(cleared),
            "cleared_conversation_ids": cleared,
            "spared_count": len(spared),
            "spared_conversation_ids": spared,
            "drained_queue": drained_queue,
        }

    def get_task(self, conversation_id: int) -> ActiveStreamTask | None:
        return self._tasks.get(conversation_id)

    def get_buffer(self, conversation_id: int) -> StreamEventBuffer | None:
        task = self._tasks.get(conversation_id)
        return task.buffer if task else None

    def get_stream_status(self, conversation_id: int, db: Any) -> dict | None:
        task = self._tasks.get(conversation_id)
        if task:
            if task.status == "queued":
                return None
            if not task.is_active:
                return {
                    "status": task.status,
                    "error": task.error_message,
                    "cursor": task.buffer.cursor,
                }
            return None

        stmt = (
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role == "assistant",
                ConversationMessage.stream_state.isnot(None),
            )
            .order_by(ConversationMessage.id.desc())
            .limit(1)
        )
        msg = db.scalar(stmt)
        if not msg:
            return None

        # file 后端：用进度 sidecar 的瞬时 state/cursor 覆盖行上值（更新鲜）。
        # 文件缺失（终态已删 / 升级前老消息）→ 回退读行旧列，向后兼容。
        # 用局部变量，不改 ORM 对象，避免读路径误把 overlay 落库。
        eff_state = msg.stream_state
        eff_cursor = msg.stream_cursor or 0
        from src.core.config import get_settings

        if get_settings().stream_progress_backend != "sqlite":
            from src.service.stream_progress_store import get_progress_store

            prog = get_progress_store().read(msg.id)
            if prog and prog.get("stream_state"):
                eff_state = prog["stream_state"]
                if prog.get("stream_cursor") is not None:
                    eff_cursor = prog["stream_cursor"]

        if eff_state == "streaming":
            return None

        result: dict = {
            "status": eff_state,
            "error": None,
            "cursor": eff_cursor,
        }
        if eff_state == "interrupted":
            result["message_id"] = msg.id
        return result

    def can_admit(self, stream_class: str = "light") -> bool:
        """资源阀门：给定类别的任务此刻能否入场。

        - **总闸** ``AGENT_MAX_INFLIGHT``：所有流共享（默认 4）。
        - **heavy 闸** ``AGENT_MAX_HEAVY``：仅限制 heavy 路数（默认 3）。
        - **light 预留**：heavy 最多占 ``总闸 - 1``，但 **light 只看总闸**，
          heavy 没跑满时 light 可借用空 heavy 槽（例如 1 路 heavy + 3 路 light）。
        """
        # 不再按 heavy/light 分级限流（重活/轻活的本质改为「单请求输出 token 上限」，
        # 见 build_chat_model max_tokens）。这里只保留一道**不分类的总并发闸**，
        # 防单 GPU 被瞬时高并发压垮。stream_class 入参保留仅为兼容调用方签名。
        del stream_class
        policy = get_agent_runtime_policy()
        if not policy.slot_gating_enabled():
            return True
        total_cap = policy.effective_max_inflight()
        if total_cap > 0 and self.count_active_streams() >= total_cap:
            return False
        return True

    def _can_start_now(self, stream_class: str = "light") -> bool:
        return self.can_admit(stream_class)

    def _default_priority(
        self,
        *,
        orchestrator_conversation_id: int | None,
    ) -> tuple[int, str]:
        if orchestrator_conversation_id is not None:
            return ORCHESTRATION_PRIORITY, "orchestration"
        return USER_CHAT_PRIORITY, "user_chat"

    def _launch_pending(self, pending: PendingStart) -> None:
        task = pending.task or ActiveStreamTask(
            pending.conversation_id,
            stream_msg_id=pending.stream_msg_id,
            source=pending.source,
            stream_class=pending.stream_class,
        )
        task.source = pending.source
        task.stream_class = pending.stream_class
        task.status = "streaming"
        task.error_message = None
        # 防"task 覆盖竞争"：同一会话已有一个仍在跑的旧 task 时，直接用新 task
        # 覆盖 self._tasks[id] 会让旧 task 与字典“失联”——它跑完进 finally 时
        # self._tasks[id] 已是新对象，清理/状态机错乱，残留一个 is_active 却永不
        # 清理的僵尸（ttft=null、tokens=0），占住会话槽，后续消息全被 REJECTED → 卡死。
        # 这里在覆盖前先取消失联的旧 task，保证状态机干净。
        prev = self._tasks.get(pending.conversation_id)
        if (
            prev is not None
            and prev is not task
            and prev._asyncio_task is not None
            and not prev._asyncio_task.done()
        ):
            logger.warning(
                "launch: conv=%s 覆盖前取消失联旧 task(status=%s)，防僵尸残留",
                pending.conversation_id, prev.status,
            )
            prev.status = "cancelled"
            prev._asyncio_task.cancel()
        self._tasks[pending.conversation_id] = task
        _fire_and_forget_mark_state(
            pending.stream_msg_id,
            pending.conversation_id,
            "streaming",
        )
        coro = self._run_agent_background(
            conversation_id=pending.conversation_id,
            agent=pending.agent,
            messages=pending.messages,
            config=pending.config,
            stream_msg_id=pending.stream_msg_id,
            skill_name=pending.skill_name,
            debug_content_only=pending.debug_content_only,
            task=task,
            agent_input=pending.agent_input,
            orchestrator_owned_db=pending.orchestrator_owned_db,
            orchestrator_workspace_id=pending.orchestrator_workspace_id,
            orchestrator_conversation_id=pending.orchestrator_conversation_id,
            orchestrator_auth_token=pending.orchestrator_auth_token,
        )
        task._asyncio_task = asyncio.create_task(coro)

    @staticmethod
    def _stream_task_is_stale_active(task: ActiveStreamTask) -> bool:
        if not task.is_active:
            return False
        if task._asyncio_task is None:
            return True
        if task._asyncio_task.done():
            return True
        # 无进展：协程仍 pending 但长时间无任何 chunk/事件（如模型极慢、56tok/264s）。
        stall_limit = _agent_stall_timeout()
        if (time.monotonic() - task._last_progress_at) > stall_limit:
            return True
        # 硬墙：活跃太久（远超正常流耗时）仍未结束 → 判定僵死。
        # 覆盖“asyncio task 仍 pending 但永远不产出”的卡死（如汇总流卡在
        # 无超时 await、cancel 后协程未退出），否则它会永久占槽阻塞后续流。
        if (time.monotonic() - task._created_at) > _agent_stream_timeouts()[2]:
            return True
        return False

    @staticmethod
    def _stale_clear_reason(task: ActiveStreamTask) -> str:
        if task._asyncio_task is None or task._asyncio_task.done():
            return "流协程异常退出，已清理"
        stall_limit = _agent_stall_timeout()
        if (time.monotonic() - task._last_progress_at) > stall_limit:
            return f"流长时间无进展（>{int(stall_limit)}s），已释放槽位"
        return "流超时仍未结束，已清理"

    def _clear_stale_active_task(self, conversation_id: int, task: ActiveStreamTask) -> None:
        reason = self._stale_clear_reason(task)
        logger.warning(
            "clearing stale active stream conv=%s asyncio_done=%s reason=%s",
            conversation_id,
            task._asyncio_task.done() if task._asyncio_task else None,
            reason,
        )
        task.status = "error"
        task.error_message = reason
        if task.stream_msg_id:
            _fire_and_forget_mark_state(
                task.stream_msg_id,
                conversation_id,
                "error",
                error_message=reason,
            )
        if task._asyncio_task and not task._asyncio_task.done():
            task._asyncio_task.cancel()
        self._drain_queue_if_slot_available()

    def _drain_queue_if_slot_available(self) -> None:
        # "light" 是最宽松的类别；只要它能入场就说明还有总槽，值得尝试 drain。
        if self._can_start_now("light") and self._queue.depth() > 0:
            self._drain_queue()

    def _pop_next_admittable(self, skip: set[int]) -> PendingStart | None:
        """按优先级取出第一个【此刻可入场】的排队项。

        队列已按 (priority, sequence) 排序；逐个看其类别能否入场——
        若队头是被 heavy 闸卡住的重活，则跳过它，让后面的轻活先上
        （消除队头阻塞 HOL，正是 heavy/light 分级的目的）。
        """
        for item in self._queue._items:
            if item.conversation_id in skip:
                continue
            if self.can_admit(item.stream_class):
                return self._queue.remove(item.conversation_id)
        return None

    def _drain_queue(self) -> None:
        skip: set[int] = set()
        while self._queue.depth() > 0:
            pending = self._pop_next_admittable(skip)
            if pending is None:
                return  # 没有任何可入场的排队项了
            existing = self._tasks.get(pending.conversation_id)
            if existing and existing.is_active:
                if self._stream_task_is_stale_active(existing):
                    self._clear_stale_active_task(pending.conversation_id, existing)
                else:
                    if not self._queue.enqueue(pending):
                        logger.error(
                            "drain: failed to re-enqueue conv=%s (duplicate?)",
                            pending.conversation_id,
                        )
                    else:
                        logger.info(
                            "drain: re-enqueued conv=%s, slot still busy",
                            pending.conversation_id,
                        )
                    skip.add(pending.conversation_id)  # 防本轮重复选中导致死循环
                    continue
            logger.info(
                "dequeue agent stream conv=%s source=%s class=%s priority=%s remaining=%s",
                pending.conversation_id,
                pending.source,
                pending.stream_class,
                pending.priority,
                self._queue.depth(),
            )
            self._launch_pending(pending)

    def request_start(
        self,
        conversation_id: int,
        agent: Any,
        messages: list[dict],
        config: dict,
        stream_msg_id: int,
        skill_name: str,
        debug_content_only: bool,
        *,
        priority: int | None = None,
        source: str | None = None,
        stream_class: str | None = None,
        agent_input: Any | None = None,
        preempt: bool = False,
        orchestrator_owned_db: Session | None = None,
        orchestrator_workspace_id: int | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestrator_auth_token: str | None = None,
    ) -> StartResult:
        existing = self._tasks.get(conversation_id)
        if existing and existing.is_active:
            # 僵尸活跃流（SSE 断开后协程已死/卡死但 status 仍 streaming）会永久占住会话槽，
            # 使「切换对话 / 重试」时每次发送都被 REJECTED → 报「当前会话已有正在执行的任务」。
            # 与 _drain_queue 行为对齐：先回收僵尸再判断，僵尸清掉后本会话不再 is_active，
            # 落到下方正常入场逻辑。仅回收「真僵尸」，活流仍按原样拒绝（不会打断在跑的流）。
            if self._stream_task_is_stale_active(existing):
                self._clear_stale_active_task(conversation_id, existing)
                existing = self._tasks.get(conversation_id)
            # 用户主动重发（preempt=True）：即便旧流仍真在跑（未到 stall 超时墙、非僵尸），
            # 也抢占——用户重发等于明确放弃上一轮，应当场 cancel 旧流起新流，而非让他干等
            # 3-5 分钟超时墙（卡死协程恰好挂着不产出时正是这种情况）。抢占只属于这一条
            # 用户入口；编排派单/群派活 preempt=False，仍按原语义拒绝/排队，绝不互相打断。
            elif existing and existing.is_active and preempt:
                logger.warning(
                    "start preempt: conv=%s 用户主动重发，抢占在跑的活流(msg=%s)",
                    conversation_id, existing.stream_msg_id,
                )
                self._clear_stale_active_task(conversation_id, existing)
                existing = self._tasks.get(conversation_id)
            if existing and existing.is_active:
                logger.warning(
                    "start refused: conversation %s already has active stream",
                    conversation_id,
                )
                return StartResult.REJECTED
        if existing and existing.status == "queued":
            logger.warning(
                "start refused: conversation %s already queued", conversation_id
            )
            return StartResult.REJECTED

        if existing and existing._cleanup_task and not existing._cleanup_task.done():
            existing._cleanup_task.cancel()
            logger.info(
                "start: cancelled stale cleanup for conversation %s", conversation_id
            )

        default_priority, default_source = self._default_priority(
            orchestrator_conversation_id=orchestrator_conversation_id,
        )
        resolved_source = source or default_source
        resolved_class = resolve_stream_class(stream_class, resolved_source)
        task = ActiveStreamTask(
            conversation_id,
            stream_msg_id=stream_msg_id,
            source=resolved_source,
            stream_class=resolved_class,
        )
        pending = PendingStart(
            conversation_id=conversation_id,
            agent=agent,
            messages=messages,
            config=config,
            stream_msg_id=stream_msg_id,
            skill_name=skill_name,
            debug_content_only=debug_content_only,
            priority=priority if priority is not None else default_priority,
            source=resolved_source,
            stream_class=resolved_class,
            agent_input=agent_input,
            task=task,
            orchestrator_owned_db=orchestrator_owned_db,
            orchestrator_workspace_id=orchestrator_workspace_id,
            orchestrator_conversation_id=orchestrator_conversation_id,
            orchestrator_auth_token=orchestrator_auth_token,
        )

        self._drain_queue_if_slot_available()
        if self._can_start_now(resolved_class):
            self._launch_pending(pending)
            return StartResult.STARTED

        task.status = "queued"
        self._tasks[conversation_id] = task
        position = self._queue.depth() + 1
        task.buffer.add({
            "type": "agent_queued",
            "data": {},
            "position": position,
            "source": pending.source,
            "message": "已加入执行队列，等待其他对话完成",
        })
        if not self._queue.enqueue(pending):
            self._tasks.pop(conversation_id, None)
            return StartResult.REJECTED
        _fire_and_forget_mark_state(stream_msg_id, conversation_id, "queued")
        logger.info(
            "agent stream queued conv=%s source=%s priority=%s position=%s",
            conversation_id,
            pending.source,
            pending.priority,
            position,
        )
        return StartResult.QUEUED

    def broadcast(self, conversation_id: int, event: dict) -> None:
        task = self._tasks.get(conversation_id)
        if not task:
            return
        for sub in list(task.subscribers):
            try:
                sub(event)
            except Exception:
                task.subscribers.discard(sub)

    def start(
        self,
        conversation_id: int,
        agent: Any,
        messages: list[dict],
        config: dict,
        stream_msg_id: int,
        skill_name: str,
        debug_content_only: bool,
        *,
        orchestrator_owned_db: Session | None = None,
        orchestrator_workspace_id: int | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestrator_auth_token: str | None = None,
        priority: int | None = None,
        source: str | None = None,
        stream_class: str | None = None,
    ) -> StartResult:
        """启动 Agent 流式任务，返回 started / queued / rejected。"""
        return self.request_start(
            conversation_id=conversation_id,
            agent=agent,
            messages=messages,
            config=config,
            stream_msg_id=stream_msg_id,
            skill_name=skill_name,
            debug_content_only=debug_content_only,
            orchestrator_owned_db=orchestrator_owned_db,
            orchestrator_workspace_id=orchestrator_workspace_id,
            orchestrator_conversation_id=orchestrator_conversation_id,
            orchestrator_auth_token=orchestrator_auth_token,
            priority=priority,
            source=source,
            stream_class=stream_class,
        )

    def cancel(self, conversation_id: int) -> bool:
        task = self._tasks.get(conversation_id)
        if not task:
            logger.warning("[cancel] conv=%s no active task in registry, cancel missed", conversation_id)
            return False
        if task.status == "queued":
            pending = self._queue.remove(conversation_id)
            self._tasks.pop(conversation_id, None)
            task.status = "cancelled"
            evt = task.buffer.add({"status": "cancelled"})
            self.broadcast(conversation_id, evt)
            stream_msg_id = (
                pending.stream_msg_id
                if pending
                else (task.stream_msg_id or 0)
            )
            _fire_and_forget_mark_state(stream_msg_id, conversation_id, "cancelled")
            logger.info("[cancel] conv=%s queued task removed", conversation_id)
            return True
        if not task.is_active:
            logger.warning("[cancel] conv=%s task not active (status=%s), cancel missed", conversation_id, task.status)
            return False

        task.status = "cancelled"

        if task._asyncio_task and not task._asyncio_task.done():
            task._asyncio_task.cancel()
            logger.info("[cancel] conv=%s task.cancel() called, asyncio_task will raise CancelledError", conversation_id)
        else:
            logger.warning("[cancel] conv=%s asyncio_task already done before cancel()", conversation_id)

        return True

    async def approve_and_resume(
        self,
        conversation_id: int,
        agent: Any,
        config: dict,
        stream_msg_id: int,
        decisions: list[dict],
        *,
        orchestrator_owned_db: Session | None = None,
        orchestrator_workspace_id: int | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestrator_auth_token: str | None = None,
    ) -> StartResult:
        """HITL approve: 新建 task + 新 buffer，用 Command(resume) 继续 agent 执行。"""
        from langgraph.types import Command

        resume_input = Command(resume={"decisions": decisions})
        result = self.request_start(
            conversation_id=conversation_id,
            agent=agent,
            messages=[],
            config=config,
            stream_msg_id=stream_msg_id,
            skill_name="",
            debug_content_only=False,
            agent_input=resume_input,
            orchestrator_owned_db=orchestrator_owned_db,
            orchestrator_workspace_id=orchestrator_workspace_id,
            orchestrator_conversation_id=orchestrator_conversation_id,
            orchestrator_auth_token=orchestrator_auth_token,
            priority=HITL_RESUME_PRIORITY,
            source="hitl_resume",
        )
        logger.info(
            "[approve] conv=%s resume request result=%s",
            conversation_id, result,
        )
        return result

    def _schedule_cleanup(self, conversation_id: int) -> None:
        task = self._tasks.get(conversation_id)

        async def _cleanup() -> None:
            await asyncio.sleep(TASK_TTL_SECONDS)
            current = self._tasks.get(conversation_id)
            if current is task:
                self._tasks.pop(conversation_id, None)
                logger.info(
                    "cleanup: removed task for conversation %s", conversation_id
                )
            else:
                logger.info(
                    "cleanup: conversation %s task replaced, skipping removal",
                    conversation_id,
                )

        cleanup_task = asyncio.create_task(_cleanup())
        if task:
            task._cleanup_task = cleanup_task

    async def _run_agent_background(
        self,
        conversation_id: int,
        agent: Any,
        messages: list[dict],
        config: dict,
        stream_msg_id: int,
        skill_name: str,
        debug_content_only: bool,
        task: ActiveStreamTask,
        agent_input: Any | None = None,
        orchestrator_owned_db: Session | None = None,
        orchestrator_workspace_id: int | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestrator_auth_token: str | None = None,
    ) -> None:
        from src.service.chat_service import ChatService

        stream_conv_id = orchestrator_conversation_id or conversation_id
        if orchestrator_workspace_id is not None:
            from src.service.agent.orchestrator.runtime import (
                register_stream_session,
                set_context,
            )

            register_stream_session(
                stream_conv_id,
                workspace_id=orchestrator_workspace_id,
                auth_token=orchestrator_auth_token,
            )

        if orchestrator_owned_db is not None:
            if orchestrator_workspace_id is None:
                raise ValueError(
                    "orchestrator_workspace_id required when orchestrator_owned_db is set"
                )
            from src.service.agent.orchestrator.runtime import set_context

            set_context(
                orchestrator_owned_db,
                orchestrator_workspace_id,
                orchestrator_conversation_id,
                auth_token=orchestrator_auth_token,
                bind_auth_token=True,
            )

        stream_start_time = time.monotonic()
        assistant_text_parts: list[str] = []
        latest_updates_text: str | None = None
        state_final = "completed"
        _last_checkpoint_count = 0

        from src.service.stream_metrics import metrics as _stream_metrics

        # 预初始化 finally 会引用到的资源句柄：必须在进入 try 之前定义，
        # 否则若在“记录开始~创建迭代器”这段窗口里被 cancel，finally 引用到
        # 未定义变量会再抛错、掩盖真因。
        _first_token_recorded = False
        _heartbeat_task: asyncio.Task | None = None
        _stall_watchdog_task: asyncio.Task | None = None
        _agent_it = None
        _metrics_started = False

        async def _heartbeat_loop():
            try:
                while True:
                    await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                    try:
                        await _run_db_write(
                            _flush_heartbeat_sync, conversation_id
                        )
                    except Exception:
                        pass
            except asyncio.CancelledError:
                pass

        def _extract_updates_content(event: Any) -> str | None:
            if not isinstance(event, dict) or event.get("type") != "updates":
                return None
            data = event.get("data")
            if not isinstance(data, dict):
                return None
            tools_payload = data.get("model")
            if not isinstance(tools_payload, dict):
                return None
            messages_payload = tools_payload.get("messages")
            if not isinstance(messages_payload, list):
                return None

            latest_content: str | None = None
            for message in messages_payload:
                if not isinstance(message, dict):
                    continue
                kwargs_payload = message.get("kwargs")
                if not isinstance(kwargs_payload, dict):
                    continue
                content = kwargs_payload.get("content")
                if isinstance(content, str):
                    content = content.strip()
                    if content:
                        latest_content = content
            return latest_content

        try:
            # 在 try 内记录开始 + 起心跳：这两步连同后续 astream 全部置于
            # try/finally 保护下。历史缺陷是它们在 try 之外 —— 若协程在“记录
            # 开始~进入循环”这段窗口被 cancel（重入覆盖/用户取消/切会话都会
            # 触发），CancelledError 在进 try 前抛出，finally 不执行：record_finish
            # 不调用 → metrics inflight 永久泄漏；_tasks 不清理 → 残留僵尸
            # （ttft=null、tok=0、几十分钟不灭）。移进 try 后，任何步骤被 cancel
            # 都会走 finally 完成清理。
            _stream_metrics.record_start(conversation_id, task.source)
            _metrics_started = True
            _heartbeat_task = asyncio.create_task(_heartbeat_loop())

            stream_input = agent_input if agent_input is not None else {"messages": messages}
            # 注入 recursion_limit：默认不限制（大哨兵），避免把正常多步任务在第 60 步
            # 腰斩成假 completed；真失控由 720s 硬墙 + 900s 内容看门狗回收。不覆盖调用方
            # 已显式传入的 recursion_limit。
            stream_config = dict(config) if config else {}
            stream_config.setdefault("recursion_limit", _agent_recursion_limit())
            # subgraphs=True：让子代理（task 工具派生的子图）的 token 事件也流出，
            # 带非空 ns=('tools:<uuid>',) 标识来自哪个子任务。用于「子任务逐字实时进度」。
            # 顶层事件 ns=()，行为不变；子任务事件按 ns 分流（见下方 _event_subagent_ns）。
            _agent_it = agent.astream(
                stream_input,
                stream_mode=["messages", "updates", "custom"],
                config=stream_config,
                version="v2",
                subgraphs=True,
            ).__aiter__()

            event_count = 0
            chunk_timeout_default, first_chunk_timeout, _ = _agent_stream_timeouts()

            async def _first_chunk_stall_watchdog():
                """首包迟迟不来时，自动 dump 协程 await 链 + 全线程栈，钉死卡点。

                本看门狗是独立 asyncio task：即便 _run_agent_background 的协程卡在
                aget_tuple（checkpointer 单连接）这类 await 上，事件循环仍在跑，本
                task 照常被调度，能对「卡住协程」get_stack() 拿到它停在哪个 await，
                并用 _dump_all_thread_stacks() 看 aiosqlite 后台线程是否卡在某操作。
                """
                dumps = 0
                last_dumped_progress = -1.0
                try:
                    while True:
                        await asyncio.sleep(FIRST_CHUNK_STALL_DUMP_SECONDS)
                        now = time.monotonic()
                        # 「内容级」无进展：仅 touch_content（真实正文 token/工具产出）刷新。
                        # filler 事件（重复 messages/updates、空 chunk）不刷新它 → 僵尸流不被续命。
                        no_content = now - task._last_content_at
                        # 「任意事件」无进展：用于诊断 dump（判断是不是连事件都没有）。
                        stalled = now - task._last_progress_at
                        # 自动判死（兜底隔离）：内容级无进展超阈值 → 强制取消该流、腾空槽位。
                        # 阈值放宽到默认 240s（可配置），避免误杀正常重活（生成长代码/文档、跑脚本）。
                        _no_content_limit = _auto_kill_no_content_seconds()
                        if no_content >= _no_content_limit:
                            _at = task._asyncio_task
                            logger.error(
                                "[stall-watchdog] conv=%s source=%s 内容级无进展 %.0fs ≥ 自动判死 %.0fs，"
                                "强制终止该流并释放槽位（event_count=%d, 任意事件无进展=%.0fs，"
                                "疑模型无响应/卡死）",
                                conversation_id, task.source, no_content,
                                _no_content_limit, event_count, stalled,
                            )
                            task.status = "error"
                            task.error_message = (
                                f"流内容无进展超过 {int(_no_content_limit)}s，"
                                "已自动终止（疑似模型无响应/卡死）"
                            )
                            if _at is not None and not _at.done():
                                _at.cancel()
                            return  # 主协程将被 cancel → 走 finally 收尾、释放槽位
                        if stalled < FIRST_CHUNK_STALL_DUMP_SECONDS:
                            continue  # 有事件流动，不必 dump（但内容级判死已在上面把关）
                        # 诊断 dump：最多 MAX 次，按 stall 段去重（防刷屏）
                        if dumps >= FIRST_CHUNK_STALL_DUMP_MAX:
                            continue
                        if task._last_progress_at == last_dumped_progress:
                            continue
                        last_dumped_progress = task._last_progress_at
                        dumps += 1
                        at = task._asyncio_task
                        coro_stack: list[str] = []
                        if at is not None and not at.done():
                            try:
                                for frame in at.get_stack(limit=25):
                                    co = frame.f_code
                                    coro_stack.append(
                                        f"{co.co_filename.rsplit('/', 1)[-1].rsplit(chr(92), 1)[-1]}"
                                        f":{frame.f_lineno} {co.co_name}"
                                    )
                            except Exception:
                                pass
                        # 外层协程被 asyncio.wait_for 包裹，真正卡点（aget_tuple /
                        # Lock.acquire / httpx）在内层 __anext__ 这个独立 task 里，
                        # 只有遍历 all_tasks 才看得到。取每个 task 栈最深 8 帧=当前卡点。
                        cur = asyncio.current_task()
                        task_lines: list[str] = []
                        try:
                            for t in asyncio.all_tasks():
                                if t is cur or t.done():
                                    continue
                                try:
                                    frames = t.get_stack(limit=60)
                                except Exception:
                                    frames = []
                                # 全帧（不再截断 [-22:]），保留库名 basename，定位最深卡点
                                tail = [
                                    f"{f.f_code.co_filename.rsplit('/', 1)[-1].rsplit(chr(92), 1)[-1]}"
                                    f":{f.f_lineno} {f.f_code.co_name}"
                                    for f in frames
                                ]
                                # task repr 暴露它在 await 的对象（Future/Lock/Task/Event）——
                                # 泄漏 async 原语时这里能直接看到 "wait_for=<Future pending>" 等。
                                try:
                                    trepr = repr(t)
                                    if len(trepr) > 600:
                                        trepr = trepr[:600] + "…"
                                except Exception:
                                    trepr = "<repr failed>"
                                stack_str = " <- ".join(tail) if tail else "<无栈>"
                                task_lines.append(
                                    f"{t.get_name()} {trepr}\n        栈: {stack_str}"
                                )
                        except Exception:
                            pass
                        thread_lines = [
                            f"[{t['name']}] " + " <- ".join(t["stack"])
                            for t in _dump_all_thread_stacks(top_frames=12)
                        ]
                        logger.warning(
                            "[stall-watchdog] conv=%s source=%s 无进展 %.0fs"
                            "(event_count=%d, dump %d/%d)\n"
                            "  >>> 卡住协程 await 链(外层):\n    %s\n"
                            "  >>> 所有 asyncio task 栈尾(真正卡点):\n    %s\n"
                            "  >>> 全线程栈:\n    %s",
                            conversation_id,
                            task.source,
                            stalled,
                            event_count,
                            dumps,
                            FIRST_CHUNK_STALL_DUMP_MAX,
                            "\n    ".join(coro_stack) or "(取不到协程栈)",
                            "\n    ".join(task_lines) or "(无 pending task)",
                            "\n    ".join(thread_lines) or "(取不到线程栈)",
                        )
                except asyncio.CancelledError:
                    pass

            _stall_watchdog_task = asyncio.create_task(_first_chunk_stall_watchdog())
            while True:
                chunk_timeout = (
                    chunk_timeout_default
                    if event_count > 0
                    else first_chunk_timeout
                )
                try:
                    chunk = await asyncio.wait_for(
                        _agent_it.__anext__(),
                        timeout=chunk_timeout,
                    )
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError:
                    if event_count == 0:
                        raise Exception(
                            "无法连接当前语言模型或首包响应超时，"
                            f"请检查设置中的 API Key、Base URL 与模型名称（等待超过 {int(chunk_timeout)} 秒）。"
                        ) from None
                    # chunk 超时：刚刚整整 chunk_timeout(默认180s) 秒迭代器一个 chunk 都没吐。
                    # 但「180s 无 chunk」不等于挂死——健康长流也会出现：静默长工具（execute_timeout
                    # 默认允许单个命令跑到 600s，期间脚本/转换不吐增量 stdout，astream 不产生任何
                    # 事件）、或模型长思考/大上下文预处理。这类图里仍有待执行节点(state.next 非空且
                    # 非 interrupt)，应继续等，不能当场 break——否则会把健康长流按「部分完成」收尾、
                    # 表现为「长任务运行中途输出停下、就这么结束了」(2026-06-08 回归修复)。
                    #
                    # 真挂死(model 节点 ainvoke 卡死、永不出 token/工具产出)由独立的「内容级 900s
                    # 无进展看门狗」(_first_chunk_stall_watchdog) cancel 并标 error 回收——它才是
                    # 权威的挂死判定。故此处既不用 180s 一刀切，也不再保留旧的「续等 20 次后假装
                    # completed」（那才是 wangliang 当初要治的「对话锁住」）。
                    if await _graph_has_pending_non_interrupt_work(
                        agent, stream_config
                    ):
                        logger.info(
                            "[run] conv=%s chunk 超时(%ds 无 chunk)但图仍有待执行节点，继续等待"
                            "（真挂死交由 900s 内容看门狗回收，event_count=%d）",
                            conversation_id, int(chunk_timeout), event_count,
                        )
                        continue
                    # 图无 pending(非 interrupt)：astream 未抛 StopAsyncIteration 但已无后续节点，
                    # 结束信号可能丢失，按已完成收尾。
                    logger.warning(
                        "[run] conv=%s chunk 超时(%ds 无 chunk)且图无待执行节点，按已完成收尾"
                        "（结束信号可能丢失，event_count=%d）",
                        conversation_id, int(chunk_timeout), event_count,
                    )
                    break
                event_count += 1
                task.touch_progress()
                # 子任务事件识别：subgraphs=True 后，task 工具派生的子图事件带非空
                # ns=('tools:<uuid>',)。非空 ns ⇒ 这是某个并行子任务的产出，须按 ns 分流：
                # 不拼进父 agent 主气泡、不 relay 群时间线，仅广播给前端按子任务 lane 渲染。
                _subagent_ns = _event_subagent_ns(chunk)
                serializable = ChatService.convert_to_serializable(chunk)
                updates_content = _extract_updates_content(serializable)
                if updates_content:
                    latest_updates_text = updates_content

                if (
                    isinstance(serializable, dict)
                    and serializable.get("type") == "custom"
                ):
                    custom_data = serializable.get("data")
                    if (
                        isinstance(custom_data, dict)
                        and custom_data.get("type") == "tool_output"
                    ):
                        # 子任务（非空 ns）内部 shell 的 stdout 不广播到父流——否则子任务
                        # curl 抓的网页/脚本输出会以「执行」行平铺到父 agent 主时间线。
                        # 子任务过程只在其 task 行内呈现；这里仅刷新计时、不进父 buffer。
                        if _subagent_ns is None:
                            evt = task.buffer.add(custom_data)
                            self.broadcast(conversation_id, evt)
                        # 工具产出 = 真实进展，刷新内容计时（工具执行期豁免判死）
                        task.touch_content()
                    elif (
                        isinstance(custom_data, dict)
                        and custom_data.get("type") == "tool_keepalive"
                    ):
                        # 长命令静默运行期的心跳：刷新内容计时、豁免无进展判死，
                        # 但不进 buffer、不广播——纯保活信号，不污染 UI 与持久化。
                        task.touch_content()
                    continue

                text_part = ChatService._extract_text_from_chunk(serializable)
                # 工具返回（ToolMessage）绝不能进 assistant 正文：read 读到的文件原文、
                # write/edit 的 "Cannot write to … already exists" 回执、shell 的
                # "[工作目录: …]" 环境提示、create_orchestration_plan 的 JSON 等，都是
                # 给模型看的工具结果，应走 tool part 折叠卡片（buffer 仍保留完整
                # serializable 供 parts 解析），绝不能糊进 msg.content 当正文平铺展示。
                _is_tool_chunk = _chunk_is_tool_message(serializable)
                if text_part and not _is_tool_chunk and not _subagent_ns:
                    # 仅顶层（ns 空）的模型正文进父气泡 + 群 relay；子任务正文按 ns 分流，
                    # 走前端子任务 lane（下方 buffer.add 仍广播，带 ns），不糊进父主回复。
                    assistant_text_parts.append(text_part)
                    # 模型正文 token = 真实进展，刷新内容计时（防止被无进展看门狗误判死）
                    task.touch_content()
                    # 群协作：把成员/组长产出的「模型自然语言」增量逐字推到群时间线。
                    # 外层 not _is_tool_chunk 已过滤掉 ToolMessage（工具返回的文件原文、
                    # plan JSON 等不会进这里），无需再判一次。
                    try:
                        from src.service.group_room_service import (
                            relay_group_stream_delta,
                        )

                        relay_group_stream_delta(conversation_id, text_part)
                    except Exception:
                        pass
                elif text_part and not _is_tool_chunk and _subagent_ns:
                    # 子任务正文 token：算真实进展（刷新判死计时），但不进父气泡/不 relay。
                    task.touch_content()
                # 群协作：成员私有流里 write_todos 的「新完成项」→ 投 progress 里程碑。
                # 与上方文本 relay 并列：write_todos 是工具块(无 text_part)，故单独判，
                # 不挂在 text_part 分支上；仅顶层流(ns 空)处理，子任务进度不刷群。
                if not _subagent_ns:
                    try:
                        from src.service.group_room_service import (
                            relay_group_todo_progress,
                        )

                        relay_group_todo_progress(conversation_id, serializable)
                    except Exception:
                        pass
                if text_part:
                    if not _first_token_recorded:
                        _stream_metrics.record_first_token(conversation_id)
                        _first_token_recorded = True
                        logger.info(
                            "[metrics] conv=%s first_token_ms=%d source=%s",
                            conversation_id,
                            int((time.monotonic() - stream_start_time) * 1000),
                            task.source,
                        )
                    _stream_metrics.add_tokens(conversation_id, 1)

                if not debug_content_only:
                    evt = task.buffer.add(serializable)
                    self.broadcast(conversation_id, evt)

                if (
                    len(task.buffer._events) - _last_checkpoint_count
                    > BUFFER_CHECKPOINT_LEN
                ):
                    _last_checkpoint_count = len(task.buffer._events)
                    cursor_snapshot = task.buffer.cursor
                    current_text = "".join(assistant_text_parts)
                    # checkpoint 只落 content + cursor（O(1)），不再快照/重放整个
                    # buffer（曾导致 O(n²) 卡死大文档任务）。完整 parts 终态再解析。
                    ok = await _run_db_write(
                        _checkpoint_flush_sync,
                        stream_msg_id,
                        cursor_snapshot,
                        [],
                        current_text or None,
                        conversation_id,
                    )
                    if not ok:
                        logger.warning(
                            "[run] conv=%s checkpoint flush FAILED at cursor=%d",
                            conversation_id, cursor_snapshot,
                        )

            final_text = latest_updates_text or "模型已完成调用。"

            is_interrupted = False
            interrupt_payload = None
            try:
                state = await agent.aget_state(config)
                if state.next:
                    for task_item in state.tasks:
                        if task_item.interrupts:
                            is_interrupted = True
                            interrupt_payload = _extract_interrupt_payload(
                                task_item.interrupts
                            )
                            break
            except Exception:
                logger.warning(
                    "[run] conv=%s aget_state failed after stream end",
                    conversation_id,
                    exc_info=True,
                )

            if is_interrupted and interrupt_payload:
                state_final = "interrupted"
                final_text = latest_updates_text or "等待用户确认..."
                logger.info(
                    "[run] conv=%s HITL interrupt detected, event_count=%d, payload=%s",
                    conversation_id, task.buffer.cursor, list(interrupt_payload.keys()),
                )
                events_snapshot = list(task.buffer._events)
                from src.service.hitl_pending_parts import (
                    extract_message_parts_for_interrupt,
                )

                interrupt_parts = extract_message_parts_for_interrupt(
                    events_snapshot,
                    interrupt_payload,
                    stream_msg_id,
                )
                evt = task.buffer.add({
                    "status": "interrupted",
                    "message_id": stream_msg_id,
                    "message_parts": interrupt_parts,
                })
                self.broadcast(conversation_id, evt)
                elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
                ok = await self._flush_terminal(
                    stream_msg_id,
                    task,
                    state="interrupted",
                    content=final_text,
                    elapsed_ms=elapsed_ms,
                    interrupt_payload=interrupt_payload,
                )
                if not ok:
                    await self._ensure_terminal_state(stream_msg_id, "interrupted")
            else:
                # 先 flush 终态到 DB，再广播 completed 事件。
                # 这样前端收到 completed 时 DB 已有 final_text，
                # 避免因 flush 未提交而读到空内容。
                elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
                ok = await self._flush_terminal(
                    stream_msg_id,
                    task,
                    state="completed",
                    content=final_text,
                    elapsed_ms=elapsed_ms,
                )
                if not ok:
                    await self._ensure_terminal_state(stream_msg_id, "completed")

                # terminal event 带上 content，前端可直接显示，
                # 不必再等 DB 查询（避免 flush/broadcast 竞态）
                evt = task.buffer.add({
                    "status": "completed",
                    "content": final_text,
                })
                logger.info(
                    "[run] conv=%s broadcasting completed event: seq=%d, subscribers=%d, text_len=%d",
                    conversation_id, evt["seq"], len(task.subscribers), len(final_text),
                )
                self.broadcast(conversation_id, evt)

        except asyncio.CancelledError:
            if task.status == "error" and task.error_message:
                state_final = "error"
                user_error = task.error_message
                partial_text = latest_updates_text or None
                logger.warning(
                    "[run] conv=%s stale/error cancel: %s, event_count=%d",
                    conversation_id,
                    user_error,
                    task.buffer.cursor,
                )
                evt = task.buffer.add({"status": "error", "error": user_error})
                self.broadcast(conversation_id, evt)
                elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
                ok = await self._flush_terminal(
                    stream_msg_id,
                    task,
                    state="error",
                    content=partial_text,
                    error_message=user_error,
                    elapsed_ms=elapsed_ms,
                )
                if not ok:
                    await self._ensure_terminal_state(stream_msg_id, "error")
                raise

            state_final = "cancelled"
            partial_text = latest_updates_text or None
            logger.info(
                "[run] conv=%s CancelledError caught, event_count=%d, text_len=%s, task.status=%s",
                conversation_id, task.buffer.cursor,
                len(partial_text) if partial_text else "None",
                task.status,
            )
            evt = task.buffer.add({"status": "cancelled"})
            logger.info(
                "[run] conv=%s broadcasting cancelled event: seq=%d, subscribers=%d",
                conversation_id, evt["seq"], len(task.subscribers),
            )
            self.broadcast(conversation_id, evt)

            elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
            ok = await self._flush_terminal(
                stream_msg_id,
                task,
                state="cancelled",
                content=partial_text,
                elapsed_ms=elapsed_ms,
            )
            if not ok:
                await self._ensure_terminal_state(stream_msg_id, "cancelled")
            raise

        except _GraphRecursionError:
            # agent 触达递归上限。默认已「不限制」(大哨兵)，正常任务到不了这里；只有
            # 显式把 AGENT_RECURSION_LIMIT 设成有限正整数时才会触发（或真撞上哨兵=失控）。
            # 不当作 error（否则下游 fail-fast 跳过、整盘僵死）；按“已完成”收尾，
            # 保留它在循环前已产出的内容（往往主体已写好，只是卡在重复读取）。
            logger.warning(
                "[run] conv=%s 触达递归上限(%d)，按已产出内容收尾（event_count=%d）",
                conversation_id, _agent_recursion_limit(), task.buffer.cursor,
            )
            final_text = (
                latest_updates_text
                or "".join(assistant_text_parts)
                or "（任务因达到步数上限提前结束，已产出部分结果）"
            )
            evt = task.buffer.add({"status": "completed"})
            self.broadcast(conversation_id, evt)
            elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
            ok = await self._flush_terminal(
                stream_msg_id, task, state="completed",
                content=final_text, elapsed_ms=elapsed_ms,
            )
            if not ok:
                await self._ensure_terminal_state(stream_msg_id, "completed")

        except Exception as e:
            from src.service.agent.error_messages import format_agent_error_for_user

            user_error = format_agent_error_for_user(e)
            logger.error(
                "[run] conv=%s agent FAILED: %s, event_count=%d, text_len=%s",
                conversation_id, e, task.buffer.cursor,
                len("".join(assistant_text_parts)) if assistant_text_parts else "0",
                exc_info=True,
            )
            state_final = "error"
            task.error_message = user_error
            partial_text = latest_updates_text or None

            evt = task.buffer.add({"status": "error", "error": user_error})
            self.broadcast(conversation_id, evt)

            elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
            ok = await self._flush_terminal(
                stream_msg_id,
                task,
                state="error",
                content=partial_text,
                error_message=user_error,
                elapsed_ms=elapsed_ms,
            )
            if not ok:
                await self._ensure_terminal_state(stream_msg_id, "error")

        finally:
            if _heartbeat_task is not None:
                _heartbeat_task.cancel()
                try:
                    await _heartbeat_task
                except asyncio.CancelledError:
                    pass

            if _stall_watchdog_task is not None:
                _stall_watchdog_task.cancel()
                try:
                    await _stall_watchdog_task
                except asyncio.CancelledError:
                    pass

            if _agent_it is not None:
                try:
                    await asyncio.wait_for(_agent_it.aclose(), timeout=5.0)
                except Exception:
                    pass

            if task.status == "cancelled" and state_final != "cancelled":
                logger.warning(
                    "[run] conv=%s finally: task.status=cancelled but state_final=%s, doing fallback flush",
                    conversation_id, state_final,
                )
                state_final = "cancelled"
                partial_text = latest_updates_text or None
                elapsed_ms = int((time.monotonic() - stream_start_time) * 1000)
                ok = await self._flush_terminal(
                    stream_msg_id,
                    task,
                    state="cancelled",
                    content=partial_text,
                    elapsed_ms=elapsed_ms,
                )
                if not ok:
                    await self._ensure_terminal_state(stream_msg_id, "cancelled")
            logger.info(
                "[run] conv=%s finally: state_final=%s, buffer_cursor=%d",
                conversation_id, state_final, task.buffer.cursor,
            )
            # 仅在确实记录过开始时才 record_finish（保证 inflight 配平，
            # 不残留泄漏；record_start 未执行则无需也不应 finish）。
            if _metrics_started:
                _stream_metrics.record_finish(
                    conversation_id,
                    state_final,
                    error=task.error_message,
                )
            logger.info(
                "[metrics] conv=%s finished status=%s total_ms=%d source=%s",
                conversation_id,
                state_final,
                int((time.monotonic() - stream_start_time) * 1000),
                task.source,
            )
            task.status = state_final
            loop = asyncio.get_running_loop()
            # 用 shield 保护终态收尾：切换会话/重入会 cancel 本协程，若 cancel 命中
            # 这里的 await，finally 会半途中断 → task 状态没清、_schedule_cleanup 没跑，
            # 留下 status=error/done=False 的僵尸（曾观测：切群聊后组长卡死在此行）。
            # shield 让 _finalize_task_stream 一定跑完；再吞掉 CancelledError 走完后续清理。
            try:
                await asyncio.shield(
                    loop.run_in_executor(
                        _DB_WRITE_EXECUTOR, _finalize_task_stream, conversation_id, state_final
                    )
                )
            except asyncio.CancelledError:
                logger.info(
                    "[run] conv=%s finalize 期间被 cancel，已 shield 保证收尾完成",
                    conversation_id,
                )

            task.subscribers.clear()
            # 只在 self._tasks[id] 仍是“本 task”时才安排清理：若已被新流覆盖
            # （重入竞争），字典里是别人的 task，这里不能去清它（会误删在跑的流，
            # 或留下本 task 永不清理）。被覆盖时本 task 已与字典失联，无需清理。
            if self._tasks.get(conversation_id) is task:
                self._schedule_cleanup(conversation_id)
            else:
                logger.warning(
                    "[run] conv=%s finally: task 已被新流覆盖，跳过清理（防误删/僵尸）",
                    conversation_id,
                )

            # 编排流清理放进 try：reset_context/db.close 在判死后 db 处于坏状态时可能抛，
            # 绝不能让它跳过下面的 _drain_queue()，否则排队流永远抽不出来 → 0活跃+N排队
            # 永久卡死、只能重启（实测：批量判死后最后一条编排流 finally 抛异常即触发）。
            try:
                if orchestrator_owned_db is not None:
                    from src.service.agent.orchestrator.runtime import reset_context

                    reset_context(stream_conv_id)
                    orchestrator_owned_db.close()
                elif orchestrator_workspace_id is not None:
                    from src.service.agent.orchestrator.runtime import reset_context

                    reset_context(stream_conv_id)
            except Exception:
                logger.warning(
                    "[run] conv=%s finally: orchestrator 清理失败（不影响抽队列）",
                    conversation_id, exc_info=True,
                )
            finally:
                # 无论如何都要抽队列：释放的槽位必须让排队流入场
                try:
                    self._drain_queue()
                except Exception:
                    logger.error(
                        "[run] conv=%s finally: _drain_queue 失败", conversation_id,
                        exc_info=True,
                    )

    async def _ensure_terminal_state(self, stream_msg_id: int, state: str) -> None:
        """flush 失败兜底：仅写 stream_state，不写 content/parts，保证不卡在 streaming。"""
        def _do():
            from src.db.session import sqlite_db_session

            with sqlite_db_session() as db:
                try:
                    msg = db.get(ConversationMessage, stream_msg_id)
                    if msg and msg.stream_state == "streaming":
                        msg.stream_state = state
                        msg.stream_cursor = 0
                        db.commit()
                        logger.info(
                            "[ensure] msg_id=%s terminal state set to %s (fallback after flush failure)",
                            stream_msg_id, state,
                        )
                except Exception:
                    pass
        await _run_db_write(_do)

    async def _flush_terminal(
        self,
        stream_msg_id: int,
        task: ActiveStreamTask,
        state: str,
        content: str | None,
        error_message: str | None = None,
        elapsed_ms: int | None = None,
        interrupt_payload: dict | None = None,
    ) -> bool:
        events_snapshot = list(task.buffer._events)
        cursor_snapshot = task.buffer.cursor
        ok = await _run_db_write(
            _flush_terminal_sync,
            stream_msg_id,
            cursor_snapshot,
            events_snapshot,
            state,
            content,
            error_message,
            elapsed_ms,
            interrupt_payload,
            task.conversation_id,
        )
        if not ok:
            logger.error(
                "[flush] conv=%s terminal state=%s FLUSH FAILED",
                task.conversation_id, state,
            )
        return ok


def _finalize_task_stream(conversation_id: int, stream_state: str) -> None:
    try:
        from src.db.session import get_session_local
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.conversation import Conversation, ConversationMessage
        from src.models.workspace import cst_now

        db = get_session_local()()

        # 1. 更新会话状态 + 推 SSE 事件（必须在 log 检查之前，确保普通聊天也能更新）
        conv = db.get(Conversation, conversation_id)
        if conv:
            if stream_state in ("completed", "cancelled"):
                conv.status = "idle"
            elif stream_state == "error":
                conv.status = "error"
            elif stream_state == "interrupted":
                conv.status = "interrupted"
            db.commit()
            try:
                from src.service.workspace_events import WorkspaceEventBus, CONVERSATION_STATUS_CHANGED
                WorkspaceEventBus.push(conv.workspace_id, {
                    "type": CONVERSATION_STATUS_CHANGED,
                    "conversation_id": conversation_id,
                    "target_type": conv.target_type,
                    "target_id": conv.target_id,
                    "status": conv.status,
                })
            except Exception:
                logger.warning("push conversation_status_changed failed conv=%s", conversation_id, exc_info=True)

        # 1.5 群协作投影：若该会话是某房间成员的私有会话，把其终态结论投影到群时间线。
        # 放在 log 检查之前，因为群内 @ 派发的成员流没有 TaskExecutionLog，
        # 否则会在下方 `if not log: return` 处提前退出，永远投影不出去。
        try:
            from src.service.group_room_service import (
                auto_confirm_leader_plan_if_pending,
                project_member_conversation_if_in_room,
                unregister_group_stream_relay,
            )

            # 流式中继到此结束（终态投影会写一条完整消息收尾）
            unregister_group_stream_relay(conversation_id)
            project_member_conversation_if_in_room(conversation_id, stream_state)
            # 组长会话正常结束 → 若它创建了未确认的编排计划，自动确认执行派活
            # （群组长无真人确认，否则计划会停在 pending、成员永不开工）
            if stream_state == "completed":
                auto_confirm_leader_plan_if_pending(conversation_id)
        except Exception:
            logger.warning(
                "group room projection failed conv=%s",
                conversation_id,
                exc_info=True,
            )

        # 2. 后执行反思（仅 completed，从 Conversation 获取 employee_id）
        if stream_state == "completed":
            employee_id = None
            if conv and conv.target_type == "employee":
                employee_id = conv.target_id
            if employee_id is not None:
                try:
                    from src.service.reflection_engine import run_reflection

                    run_reflection(conversation_id, employee_id, db)
                except Exception:
                    logger.warning("reflection failed conv=%s", conversation_id, exc_info=True)

        # 3. 更新 TaskExecutionLog（仅当存在时）
        log = db.scalars(
            select(TaskExecutionLog).where(
                TaskExecutionLog.conversation_id == conversation_id,
                TaskExecutionLog.run_status.in_(("running", "queued")),
            )
        ).first()
        if not log:
            db.close()
            return

        # HITL interrupt 只是暂停等待，不应落为失败终态。
        if stream_state == "interrupted":
            log.run_status = "running"
            log.run_result = "等待人工确认"
            db.commit()
            db.refresh(log)
            db.close()
            return

        log.ended_at = cst_now()
        if log.started_at and log.ended_at:
            log.duration_ms = int(
                (log.ended_at.replace(tzinfo=None) - log.started_at.replace(tzinfo=None)).total_seconds() * 1000
            )

        if stream_state == "completed":
            from src.service.orchestrator_execution_summary import (
                resolve_assistant_delivery_text,
            )

            last_msg = db.scalars(
                select(ConversationMessage).where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                ).order_by(ConversationMessage.id.desc())
            ).first()
            final_text = resolve_assistant_delivery_text(last_msg)
            log.run_status = "success"
            log.run_result = "任务执行成功"
            log.output_json = json.dumps({"content": final_text}, ensure_ascii=False)
        elif stream_state == "cancelled":
            log.run_status = "cancelled"
            log.run_result = "任务已取消"
        else:
            log.run_status = "failed"
            log.run_result = "任务执行失败"
            err_text = "agent stream error"
            last_msg = db.scalars(
                select(ConversationMessage).where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                ).order_by(ConversationMessage.id.desc())
            ).first()
            if last_msg and last_msg.extra_meta:
                try:
                    meta = json.loads(last_msg.extra_meta)
                    if isinstance(meta, dict) and meta.get("error_message"):
                        err_text = str(meta["error_message"])[:2000]
                except (json.JSONDecodeError, TypeError):
                    pass
            log.error_message = err_text

        db.commit()
        db.refresh(log)

        summary_message = None
        orch_conv_id = log.orchestrator_conversation_id
        try:
            from src.service.orchestrator_execution_summary import (
                append_orchestrator_execution_summary,
                resolve_log_orchestrator_conversation_id,
            )

            summary_message = append_orchestrator_execution_summary(
                db, log, stream_state
            )
            if orch_conv_id is None:
                orch_conv_id = resolve_log_orchestrator_conversation_id(db, log)
        except Exception:
            logger.warning(
                "orchestrator execution summary failed conv=%s",
                conversation_id,
                exc_info=True,
            )

        if registry.on_task_finalized:
            try:
                registry.on_task_finalized(
                    conversation_id,
                    stream_state,
                    log.task_id,
                    log.workspace_id,
                    orchestrator_conversation_id=orch_conv_id,
                    summary_message_id=(
                        summary_message.id if summary_message else None
                    ),
                    execution_log_id=log.id,
                )
            except Exception:
                logger.warning(
                    "on_task_finalized callback failed conv=%s", conversation_id, exc_info=True
                )

        db.close()
    except Exception:
        logger.error(
            "_finalize_task_stream failed conv=%s state=%s",
            conversation_id, stream_state, exc_info=True
        )


def cleanup_zombie_executions(db: Any) -> int:
    try:
        from sqlalchemy import select
        from src.models.task_execution_log import TaskExecutionLog
        from src.models.workspace import cst_now
        from datetime import timedelta

        now = cst_now()
        threshold = now - timedelta(minutes=10)

        zombies = list(
            db.scalars(
                select(TaskExecutionLog).where(
                    TaskExecutionLog.run_status == "running",
                    (
                        TaskExecutionLog.last_heartbeat_at.is_(None)
                        | (TaskExecutionLog.last_heartbeat_at < threshold)
                    ),
                )
            ).all()
        )
        for log in zombies:
            log.run_status = "timeout"
            log.run_result = "任务超时"
            log.error_message = "进程重启时检测到任务无心跳超时"
            log.ended_at = now
            if log.started_at:
                log.duration_ms = int(
                    (now.replace(tzinfo=None) - log.started_at.replace(tzinfo=None)).total_seconds() * 1000
                )

        if zombies:
            db.commit()
            logger.info("cleanup_zombie_executions: cleaned %d zombie tasks", len(zombies))
        return len(zombies)
    except Exception:
        logger.error("cleanup_zombie_executions failed", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        return 0


def _emergency_flush_all() -> None:
    from src.service.message_parts_extractor import extract_message_parts_from_buffer
    from src.db.session import get_session_local

    for cid, task in list(registry._tasks.items()):
        if not task.is_active:
            continue
        try:
            db = get_session_local()()
            events = list(task.buffer._events)
            parts = extract_message_parts_from_buffer(events)
            stmt = (
                select(ConversationMessage)
                .where(
                    ConversationMessage.conversation_id == cid,
                    ConversationMessage.role == "assistant",
                    ConversationMessage.stream_state == "streaming",
                )
                .order_by(ConversationMessage.id.desc())
                .limit(1)
            )
            msg = db.scalar(stmt)
            if msg:
                msg.stream_state = "error"
                msg.stream_cursor = task.buffer.cursor
                if parts:
                    msg.message_parts = json.dumps(parts, ensure_ascii=False)
                db.commit()
                logger.info(
                    "[emergency] conv=%s flushed on exit: parts_count=%d",
                    cid, len(parts) if parts else 0,
                )
            db.close()
        except Exception:
            pass


atexit.register(_emergency_flush_all)

registry = StreamRegistry()
