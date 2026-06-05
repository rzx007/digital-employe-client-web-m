"""群协作房间服务（路线 A：隔离会话之上的"编排+投影"层）。

核心职责：
1. ensure_room：为一个群会话（target_type="group"）惰性建立 GroupRoom 实例；
2. dispatch_to_member：把一条消息路由到某成员的**私有员工会话**并启动其 agent 流
   —— 完全复用现有 1:1 派发路径（append-user + registry.request_start），零新机制；
3. 投影：成员私有流完成后，把"结论/状态"写到群时间线（带 sender_*）并经
   WorkspaceEventBus 推送 room_message 事件，前端订阅即可看到共享时间线。

不变量保持：每个成员仍是"一会话=一线程=一流=一隔离上下文"（I1–I4 不动），
房间只是更高阶的组合对象。@提及决定唤醒谁，白名单决定谁能 @ 谁。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.chat_group import ChatGroup
from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.group_room import GroupRoom, GroupRoomMember
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)

def _schedule_stream_start(
    *,
    conversation_id: int,
    agent: Any,
    messages: list,
    stream_msg_id: int,
    orchestrator_workspace_id: int | None = None,
    orchestrator_conversation_id: int | None = None,
    orchestrator_auth_token: str | None = None,
    orchestrator_owned_db: Any | None = None,
    source: str = "group_room",
) -> None:
    """把 registry.request_start 投递到主事件循环执行。

    群派活/汇总常由 agent 工具调用线程或完成回调触发，那些线程没有运行中的
    asyncio loop，直接 request_start 内部的 create_task 会报 "no running event loop"。
    统一经主循环 call_soon_threadsafe 启动；取不到主循环则同步兜底。

    orchestrator_owned_db：给该编排流一个**独立** DB session，避免与调用方
    （如总管自身的流式会话）共用 session 触发并发会话错误
    （"concurrent operations are not permitted"）。
    """
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
            orchestrator_workspace_id=orchestrator_workspace_id,
            orchestrator_conversation_id=orchestrator_conversation_id,
            orchestrator_auth_token=orchestrator_auth_token,
            orchestrator_owned_db=orchestrator_owned_db,
            source=source,
        )
        # 启动被拒（该会话已有活跃/排队流——常见于组长会话复用同一
        # conversation_id 先 dispatch 后 summarize 时撞车）→ 必须回滚：
        # 否则 DB 已被写成 streaming、relay 已注册，留下永久僵尸流占槽。
        if result == StartResult.REJECTED:
            logger.warning(
                "stream start REJECTED conv=%s source=%s → 回滚 streaming/relay",
                conversation_id, source,
            )
            try:
                from src.service.stream_registry import _mark_stream_state_sync

                _mark_stream_state_sync(stream_msg_id, conversation_id, "failed")
            except Exception:
                logger.warning(
                    "rollback stream_state failed conv=%s", conversation_id,
                    exc_info=True,
                )
            unregister_group_stream_relay(conversation_id)

    try:
        from src.service.agent.orchestrator.runtime import get_main_loop

        get_main_loop().call_soon_threadsafe(_do_start)
    except Exception:
        _do_start()


ROOM_MESSAGE_EVENT = "room_message"
ROOM_MESSAGE_STREAM_EVENT = "room_message_stream"  # 逐字流式增量
ROOM_MEMBER_STATE_EVENT = "room_member_state"


# 群流式中继：conversation_id -> 该流在群里的归属信息。
# 成员/组长流产出 token 时，经 relay_group_stream_delta 实时推到群时间线。
_GROUP_STREAM_RELAY: dict[int, dict] = {}


def register_group_stream_relay(
    conversation_id: int,
    *,
    room_id: int,
    room_conversation_id: int,
    workspace_id: int,
    sender_id: int | None,
    sender_label: str,
) -> None:
    """登记一个流到群的流式中继（派活时调用）。"""
    _GROUP_STREAM_RELAY[conversation_id] = {
        "room_id": room_id,
        "room_conversation_id": room_conversation_id,
        "workspace_id": workspace_id,
        "sender_id": sender_id,
        "sender_label": sender_label,
        "acc": 0,  # 已推送的累计字符数（用于前端判断是否新消息）
    }


def unregister_group_stream_relay(conversation_id: int) -> None:
    _GROUP_STREAM_RELAY.pop(conversation_id, None)


def relay_group_stream_delta(conversation_id: int, delta_text: str) -> None:
    """成员/组长流产出文本增量时，实时推到群时间线（逐字流式）。

    由 stream_registry 的运行循环在每个文本 chunk 调用。无中继登记则直接返回。
    """
    info = _GROUP_STREAM_RELAY.get(conversation_id)
    if not info or not delta_text:
        return
    try:
        from src.service.workspace_events import WorkspaceEventBus

        first = info["acc"] == 0
        info["acc"] += len(delta_text)
        WorkspaceEventBus.push(info["workspace_id"], {
            "type": ROOM_MESSAGE_STREAM_EVENT,
            "room_id": info["room_id"],
            "room_conversation_id": info["room_conversation_id"],
            "source_conversation_id": conversation_id,
            "sender_id": info["sender_id"],
            "sender_label": info["sender_label"],
            "delta": delta_text,
            "first": first,  # 该流首个增量 → 前端新建一条"进行中"消息
            "acc": info["acc"],  # 累计已生成字符数 → 前端显示“正在生成 N 字”进度
        })
    except Exception:
        logger.warning(
            "relay group stream delta failed conv=%s", conversation_id, exc_info=True
        )


def auto_confirm_leader_plan_if_pending(leader_conversation_id: int) -> None:
    """组长流结束后：若组长刚创建了未确认（pending）的编排计划，自动确认执行。

    群组长场景没有真人点“确认执行”，但总管 agent 的系统 prompt / 工具返回值
    都强制“创建计划后等用户确认”，导致组长生成计划后停在 pending、成员永不开工。
    这里做代码层兜底：组长会话对应的最新 pending 计划，直接 execute_plan 派活，
    不依赖 LLM 是否记得调 confirm_orchestration_plan。
    """
    from src.db.session import get_session_local
    from src.models.conversation import Conversation
    from src.models.orchestration_plan import OrchestrationPlan
    from src.service.agent.orchestrator.execution import execute_plan

    db = get_session_local()()
    try:
        conv = db.get(Conversation, leader_conversation_id)
        # 仅处理群组长会话（target_type=group_leader），避免影响普通总管的人审流程
        if conv is None or conv.target_type != "group_leader":
            return
        plan = db.scalars(
            select(OrchestrationPlan)
            .where(OrchestrationPlan.conversation_id == leader_conversation_id)
            .order_by(OrchestrationPlan.id.desc())
        ).first()
        if plan is None or plan.status != "pending":
            return  # 没有计划，或已确认/已取消，无需处理
        logger.info(
            "auto-confirming leader plan #%s (conv=%s) — 群组长无真人确认，代为执行",
            plan.id, leader_conversation_id,
        )
        execute_plan(db, plan, conv.workspace_id)
    except Exception:
        logger.warning(
            "auto_confirm_leader_plan failed conv=%s",
            leader_conversation_id, exc_info=True,
        )
    finally:
        db.close()


# @提及解析：@员工名 或 @[员工名]（支持名字含空格）
_MENTION_RE = re.compile(r"@\[([^\]]+)\]|@(\S+)")

# 房间创建锁：防止同一群会话被并发 ensure_room（前端常同时打 /room、/room/dag、
# 发消息，每个 session 各自 check-then-act 都查不到房间 → 各建一个，产生多个
# 房间 + 多个组长会话 → 多个组长流抢慢模型 → 首包超时全失败）。
# 按 room_conversation_id 串行化创建段，杜绝重复房间。
import threading as _threading

_ROOM_CREATE_LOCKS: dict[int, _threading.Lock] = {}
_ROOM_CREATE_LOCKS_GUARD = _threading.Lock()


def _get_room_create_lock(room_conversation_id: int) -> _threading.Lock:
    with _ROOM_CREATE_LOCKS_GUARD:
        lock = _ROOM_CREATE_LOCKS.get(room_conversation_id)
        if lock is None:
            lock = _threading.Lock()
            _ROOM_CREATE_LOCKS[room_conversation_id] = lock
        return lock


def build_leader_brief(question: str, roster: str) -> str:
    """组长会话的系统 prompt/用户消息拼装。

    roster 格式为每行一条：- 姓名（员工ID: N）
    例：
        - 张三（员工ID: 1）
        - 李四（员工ID: 2）
    """
    return (
        "你是这个群的组长（调度员）。没有真人会替你点「确认执行」，"
        "但当用户需求模糊时你必须先澄清，不能凭空臆测。\n"
        "群里现有以下成员可供你分派任务：\n"
        f"{roster}\n\n"
        "判断用户需求是否清晰：\n"
        "- 若关键信息不足以拆解派活（目标 / 范围 / 交付物 / 受众 / 格式 等任一不明），"
        "**本轮必须调用 `submit_clarifying_questions`**（context 取 long_document 或 general）"
        "一次性列清要点；调用后停下，**不要** create_orchestration_plan、不要派活，"
        "等用户回答后的下一轮再继续。禁止只在聊天里列问题而不调工具。\n"
        "- 若需求已清晰：先用一句话说你的安排，再 create_orchestration_plan、"
        "随后立即 confirm_orchestration_plan 执行（互不依赖可并行，有先后用 depends_on）。\n"
        "成员产出会自动汇总到群里。\n\n"
        f"用户需求：{question}"
    )


class GroupRoomService:
    # ---- 房间生命周期 ----

    @staticmethod
    def ensure_room(db: Session, group_conversation: Conversation) -> GroupRoom:
        """为群会话惰性创建/获取房间实例。

        group_conversation: target_type="group" 的会话，target_id=ChatGroup.id。
        """
        room = db.scalars(
            select(GroupRoom)
            .where(GroupRoom.room_conversation_id == group_conversation.id)
            .order_by(GroupRoom.id.asc())  # 历史重复房间时稳定返回最早那个
        ).first()
        if room is not None:
            return room

        # 进入创建段：按群会话加锁串行化，并在锁内 double-check 重查，
        # 防止并发请求各自创建出多个房间 + 多个组长。
        lock = _get_room_create_lock(group_conversation.id)
        with lock:
            # 让本 session 看到其它 session 刚提交的房间（清掉本地身份映射缓存）
            db.expire_all()
            room = db.scalars(
                select(GroupRoom).where(
                    GroupRoom.room_conversation_id == group_conversation.id
                )
            ).first()
            if room is not None:
                return room
            return GroupRoomService._create_room_locked(db, group_conversation)

    @staticmethod
    def _create_room_locked(
        db: Session, group_conversation: Conversation
    ) -> GroupRoom:
        """实际创建房间 + 登记成员 + 建组长会话。仅在 ensure_room 的创建锁内调用。"""
        chat_group = db.get(ChatGroup, group_conversation.target_id)
        room = GroupRoom(
            workspace_id=group_conversation.workspace_id,
            chat_group_id=chat_group.id if chat_group else None,
            room_conversation_id=group_conversation.id,
            status="active",
            title=group_conversation.title or (chat_group.name if chat_group else None),
        )
        db.add(room)
        db.flush()

        # 把群成员登记为房间成员（默认 worker，白名单允许 user/leader）
        if chat_group:
            for emp in chat_group.members:
                member = GroupRoomMember(
                    room_id=room.id,
                    employee_id=emp.id,
                    role_in_room="worker",
                    state="ready",
                    allow_from=json.dumps(["user", "leader"], ensure_ascii=False),
                )
                db.add(member)

        # 组长（调度员）：一条专用会话跑总管编排 agent，负责"分解→派活→汇总"。
        # 用户不 @ 具体成员时，消息默认交给组长统筹。
        leader_conv = Conversation(
            workspace_id=group_conversation.workspace_id,
            target_type="group_leader",  # 复用总管 agent 能力，但用独立 type 避免污染总管会话列表
            target_id=group_conversation.id,  # 指向房间会话，便于回溯
            title=f"[群:{room.id}] 组长",
        )
        db.add(leader_conv)
        db.flush()
        room.leader_conversation_id = leader_conv.id

        db.commit()
        db.refresh(room)
        logger.info(
            "created group_room id=%s for conv=%s group=%s leader_conv=%s",
            room.id,
            group_conversation.id,
            room.chat_group_id,
            room.leader_conversation_id,
        )
        return room

    @staticmethod
    def list_members(db: Session, room: GroupRoom) -> list[GroupRoomMember]:
        return list(
            db.scalars(
                select(GroupRoomMember)
                .where(GroupRoomMember.room_id == room.id)
                .order_by(GroupRoomMember.id.asc())
            ).all()
        )

    # ---- @提及解析 ----

    @staticmethod
    def resolve_mentions(
        db: Session,
        room: GroupRoom,
        text: str,
        explicit_mentions: list[dict] | None = None,
    ) -> list[GroupRoomMember]:
        """解析消息中 @ 到的房间成员。

        优先用前端结构化传来的 explicit_mentions（[{id,name}]）；
        否则从文本里正则提取 @名字 再按成员员工名匹配。
        """
        members = GroupRoomService.list_members(db, room)
        if not members:
            return []
        emp_by_id = {m.employee_id: m for m in members}
        name_to_member: dict[str, GroupRoomMember] = {}
        for m in members:
            emp = db.get(Employee, m.employee_id)
            if emp and emp.name:
                name_to_member[emp.name.strip()] = m

        matched: dict[int, GroupRoomMember] = {}

        if explicit_mentions:
            for mention in explicit_mentions:
                mid = mention.get("id")
                if mid is not None and int(mid) in emp_by_id:
                    member = emp_by_id[int(mid)]
                    matched[member.id] = member

        for raw in _MENTION_RE.findall(text or ""):
            name = (raw[0] or raw[1] or "").strip()
            if not name:
                continue
            # 支持 @全部 / @all 广播
            if name in ("全部", "所有人", "all", "everyone"):
                for m in members:
                    matched[m.id] = m
                continue
            member = name_to_member.get(name)
            if member:
                matched[member.id] = member

        return list(matched.values())

    # ---- 投影：把群时间线消息写入房间会话 ----

    @staticmethod
    def post_to_timeline(
        db: Session,
        room: GroupRoom,
        *,
        role: str,
        content: str,
        sender_id: int | None,
        sender_label: str | None,
        extra_meta: dict | None = None,
        message_parts: list | None = None,
    ) -> ConversationMessage:
        """向群时间线（房间会话）追加一条带作者归属的消息，并推送 SSE 事件。

        message_parts: 可选结构化 parts（如澄清问题卡片），非空时写入
        ConversationMessage.message_parts 列，前端直接渲染。
        """
        meta = dict(extra_meta) if extra_meta else {}
        meta["created_at"] = cst_now().isoformat()
        msg = ConversationMessage(
            conversation_id=room.room_conversation_id,
            role=role,
            content=content,
            sender_id=sender_id,
            sender_label=sender_label,
            stream_state="completed",
            extra_meta=json.dumps(meta, ensure_ascii=False),
            message_parts=(
                json.dumps(message_parts, ensure_ascii=False)
                if message_parts is not None
                else None
            ),
        )
        db.add(msg)
        conv = db.get(Conversation, room.room_conversation_id)
        if conv:
            conv.updated_at = cst_now()
        db.commit()
        db.refresh(msg)

        try:
            from src.service.workspace_events import WorkspaceEventBus

            WorkspaceEventBus.push(room.workspace_id, {
                "type": ROOM_MESSAGE_EVENT,
                "room_id": room.id,
                "room_conversation_id": room.room_conversation_id,
                "message_id": msg.id,
                "role": role,
                "content": content,
                "sender_id": sender_id,
                "sender_label": sender_label,
            })
        except Exception:
            logger.warning("push room_message failed room=%s", room.id, exc_info=True)
        return msg

    @staticmethod
    def update_member_state(
        db: Session, member: GroupRoomMember, state: str
    ) -> None:
        member.state = state
        db.commit()
        try:
            from src.service.workspace_events import WorkspaceEventBus

            WorkspaceEventBus.push(member.room.workspace_id, {
                "type": ROOM_MEMBER_STATE_EVENT,
                "room_id": member.room_id,
                "member_id": member.id,
                "employee_id": member.employee_id,
                "state": state,
            })
        except Exception:
            logger.warning(
                "push room_member_state failed member=%s", member.id, exc_info=True
            )

    # ---- 派发：把消息路由到成员私有会话并启动其流 ----

    @staticmethod
    def dispatch_to_member(
        db: Session,
        room: GroupRoom,
        member: GroupRoomMember,
        question: str,
        *,
        auth_token: str | None = None,
    ) -> int | None:
        """把一条消息路由到成员的私有员工会话并启动 agent 流。

        复用 1:1 路径：为成员（按需）建私有会话 → append user 消息 → registry.request_start。
        返回成员私有会话 id（启动成功）或 None（失败/拒绝）。
        """
        from src.service.agent.employee import get_agent
        from src.service.agent_stream_queue import StartResult
        from src.service.chat_service import ChatService
        from src.service.stream_registry import registry
        from src.core.config import get_settings

        employee = db.get(Employee, member.employee_id)
        if employee is None:
            logger.warning("dispatch_to_member: employee %s missing", member.employee_id)
            return None

        # 成员私有会话：每个房间成员复用同一条私有会话（隔离线程/上下文）
        conv = None
        if member.conversation_id is not None:
            conv = db.get(Conversation, member.conversation_id)
        if conv is None:
            conv = Conversation(
                workspace_id=room.workspace_id,
                target_type="employee",
                target_id=employee.id,
                title=f"[群:{room.id}] {employee.name}",
            )
            db.add(conv)
            db.flush()
            member.conversation_id = conv.id
            db.commit()

        member_conv_id = conv.id

        # 历史 + 追加 user 消息 + 占位 assistant（与 1:1 路径一致）
        history_messages, _ = ChatService._load_history_for_agent(
            db, conversation_id=member_conv_id,
            limit=get_settings().chat_history_max_messages,
        )
        ChatService._append_message(
            db, conversation=conv, role="user", content=question,
        )
        assistant_msg = ChatService._append_message(
            db, conversation=conv, role="assistant", content="",
        )
        db.commit()

        try:
            skills_path = ChatService.resolve_employee_skills_dir(
                skills_payload=employee.skills_json,
                employee_id=employee.id,
                employee_name=employee.name,
                employee_code=employee.employee_code,
            )
        except Exception:
            skills_path = ""

        settings = get_settings()
        # 群协作：成员共享房间产物目录，上游产出对下游可见
        from pathlib import Path

        shared_dir = str(
            Path(settings.artifacts_path) / f"room-{room.id}" / "artifacts"
        )
        agent = get_agent(
            skills_path,
            settings.artifacts_path,
            employee_id=employee.id,
            conversation_id=member_conv_id,
            shared_artifacts_dir=shared_dir,
        )

        request_messages: list[dict[str, Any]] = [*history_messages]
        request_messages.append({"role": "user", "content": question})

        # 登记流式中继：成员产出 token 时逐字推到群时间线
        employee = db.get(Employee, member.employee_id)
        register_group_stream_relay(
            member_conv_id,
            room_id=room.id,
            room_conversation_id=room.room_conversation_id,
            workspace_id=room.workspace_id,
            sender_id=member.employee_id,
            sender_label=employee.name if employee else f"员工#{member.employee_id}",
        )

        # 投递到主循环启动（可能由 agent 工具线程触发，无运行中的事件循环）
        assistant_msg.stream_state = "streaming"
        db.commit()
        _schedule_stream_start(
            conversation_id=member_conv_id,
            agent=agent,
            messages=request_messages,
            stream_msg_id=assistant_msg.id,
            source="group_room",
        )

        GroupRoomService.update_member_state(db, member, "running")
        # 投影由 stream_registry._finalize_task_stream 经
        # project_member_conversation_if_in_room 在成员流终态时可靠触发
        # （DB 映射查找，不依赖脆弱的即时 buffer 订阅）。
        return member_conv_id

    # ---- 投影订阅器 ----

    @staticmethod
    def _attach_projector(room_id: int, member_id: int, member_conv_id: int) -> None:
        """订阅成员私有流的终态，完成时把结论投影到群时间线。

        采用轻量方式：不逐 token 转发（防上下文爆炸），只在成员流**完成**时，
        读取其最终 assistant 消息内容作为"结论"投影到房间。
        成员完成的信号由 stream_registry.on_task_finalized 提供，但那是任务编排专用；
        对于群内 @ 派发的非任务流，这里用 buffer 订阅监听 stream_ended。
        """
        from src.service.stream_registry import registry

        task = registry._tasks.get(member_conv_id)
        if not task:
            return

        def _on_event(event: dict) -> None:
            data = event.get("data") if isinstance(event, dict) else None
            status_val = None
            if isinstance(data, dict):
                status_val = data.get("status")
            elif isinstance(data, str):
                status_val = data
            if status_val in ("completed", "cancelled", "error", "interrupted"):
                try:
                    GroupRoomService._project_member_conclusion(
                        room_id, member_id, member_conv_id, status_val
                    )
                except Exception:
                    logger.warning(
                        "project member conclusion failed conv=%s",
                        member_conv_id,
                        exc_info=True,
                    )

        task.subscribe(_on_event)

    @staticmethod
    def _project_member_conclusion(
        room_id: int, member_id: int, member_conv_id: int, status_val: str
    ) -> None:
        """读取成员私有会话最终结论，写到群时间线（独立 Session）。"""
        from src.db.session import get_session_local

        db = get_session_local()()
        try:
            room = db.get(GroupRoom, room_id)
            member = db.get(GroupRoomMember, member_id)
            if room is None or member is None:
                return
            employee = db.get(Employee, member.employee_id)
            sender_label = employee.name if employee else f"员工#{member.employee_id}"

            if status_val == "completed":
                last = db.scalars(
                    select(ConversationMessage)
                    .where(
                        ConversationMessage.conversation_id == member_conv_id,
                        ConversationMessage.role == "assistant",
                    )
                    .order_by(ConversationMessage.id.desc())
                ).first()
                content = (last.content or "").strip() if last else ""
                if not content:
                    content = "（已完成）"
                GroupRoomService.post_to_timeline(
                    db, room,
                    role="assistant",
                    content=content,
                    sender_id=member.employee_id,
                    sender_label=sender_label,
                    extra_meta={"member_conversation_id": member_conv_id},
                )
                GroupRoomService.update_member_state(db, member, "done")
            else:
                GroupRoomService.post_to_timeline(
                    db, room,
                    role="assistant",
                    content=f"（{sender_label} 的任务{status_val}）",
                    sender_id=member.employee_id,
                    sender_label=sender_label,
                )
                GroupRoomService.update_member_state(db, member, "ready")
        finally:
            db.close()

    # ---- 群消息入口（被 chat_service 的 group 分支调用）----

    @staticmethod
    def handle_group_message(
        db: Session,
        group_conversation: Conversation,
        question: str,
        *,
        extra_meta: dict | None = None,
        auth_token: str | None = None,
    ) -> dict:
        """处理一条发到群里的用户消息：写入时间线 + 解析 @ + 派发给被 @ 的成员。

        返回派发摘要，供 chat_service 生成 SSE 回执。
        """
        room = GroupRoomService.ensure_room(db, group_conversation)

        # 1) 把用户消息写到群时间线（作者=用户）
        explicit_mentions = (
            extra_meta.get("mentions") if isinstance(extra_meta, dict) else None
        )
        GroupRoomService.post_to_timeline(
            db, room,
            role="user",
            content=question,
            sender_id=None,
            sender_label="用户",
            extra_meta=extra_meta,
        )

        # 2) 解析 @ 提及
        targets = GroupRoomService.resolve_mentions(
            db, room, question, explicit_mentions
        )

        # 2.5) 未 @ 任何成员 → 交给组长统筹（分解→派活→汇总）
        if not targets:
            if GroupRoomService.leader_awaiting_clarification(db, room):
                # 兜底：普通消息视为澄清作答，resume 组长流
                last_interrupted = db.scalars(
                    select(ConversationMessage)
                    .where(
                        ConversationMessage.conversation_id == room.leader_conversation_id,
                        ConversationMessage.role == "assistant",
                        ConversationMessage.stream_state == "interrupted",
                    )
                    .order_by(ConversationMessage.id.desc())
                ).first()
                if last_interrupted is None:
                    # 竞态：两次查询之间中断态已被更新，跳过 resume 避免误派活
                    logger.warning(
                        "leader_awaiting_clarification 为 True 但未找到 interrupted 消息"
                        "（可能已被并发更新），跳过 resume room=%s", room.id,
                    )
                    return {"room_id": room.id, "dispatched": [], "note": "待澄清态已消失，已跳过"}
                from src.service.chat_service import ChatService
                from src.service.agent.orchestrator.runtime import get_main_loop
                import asyncio
                fut = asyncio.run_coroutine_threadsafe(
                    ChatService.approve_trigger(
                        db,
                        room.leader_conversation_id,
                        last_interrupted.id,
                        decisions=[{"type": "respond", "message": question}],
                        auth_token=auth_token,
                    ),
                    get_main_loop(),
                )
                fut.add_done_callback(
                    lambda f: logger.error(
                        "approve_trigger 兜底 resume 异常 room=%s: %s", room.id, f.exception()
                    ) if f.exception() else None
                )
                return {
                    "room_id": room.id,
                    "dispatched": [],
                    "note": "已作为澄清作答恢复组长",
                }
            leader_conv_id = GroupRoomService.dispatch_to_leader(
                db, room, question, auth_token=auth_token
            )
            return {
                "room_id": room.id,
                "dispatched": [],
                "leader_conversation_id": leader_conv_id,
                "note": "已交组长统筹安排",
            }

        # 3) 白名单校验 + 派发给被 @ 的成员
        dispatched: list[dict] = []
        for member in targets:
            if not GroupRoomService._allowed(member, "user"):
                logger.info(
                    "member %s not allowed from user, skip", member.employee_id
                )
                continue
            conv_id = GroupRoomService.dispatch_to_member(
                db, room, member, question, auth_token=auth_token
            )
            employee = db.get(Employee, member.employee_id)
            dispatched.append({
                "member_id": member.id,
                "employee_id": member.employee_id,
                "employee_name": employee.name if employee else None,
                "conversation_id": conv_id,
                "status": "started" if conv_id else "rejected",
            })

        return {"room_id": room.id, "dispatched": dispatched}

    @staticmethod
    def dispatch_to_leader(
        db: Session,
        room: GroupRoom,
        question: str,
        *,
        auth_token: str | None = None,
    ) -> int | None:
        """把消息交给组长（房间专属的总管编排 agent）统筹分解与派活。

        组长在自己的会话里跑 orchestrator agent，并被告知房间里有哪些成员
        （员工 id/名字），让它优先把任务分配给这些成员。组长创建并确认编排计划后，
        由完成驱动调度器（dependency_scheduler）按 DAG 派活到成员，
        成员产出再投影回群时间线。
        """
        from src.service.agent.orchestrator import get_orchestrator_agent
        from src.service.chat_service import ChatService
        from src.db.session import get_session_local

        # 全程用独立 session：本方法常由总管的工具调用线程触发，此时总管自身的
        # 流式会话正占用调用方 db，复用它做读写会与异步流并发，触发
        # "concurrent operations are not permitted"。用 leader_db 隔离。
        leader_db = get_session_local()()

        # 历史房间可能没有组长会话，惰性补建
        leader_conv = None
        if room.leader_conversation_id is not None:
            leader_conv = leader_db.get(Conversation, room.leader_conversation_id)
        if leader_conv is None:
            leader_conv = Conversation(
                workspace_id=room.workspace_id,
                target_type="group_leader",
                target_id=room.room_conversation_id,
                title=f"[群:{room.id}] 组长",
            )
            leader_db.add(leader_conv)
            leader_db.flush()
            # 同步把 leader_conversation_id 写回 room（用 leader_db 持久化）
            room_row = leader_db.get(GroupRoom, room.id)
            if room_row is not None:
                room_row.leader_conversation_id = leader_conv.id
            leader_db.commit()
            room.leader_conversation_id = leader_conv.id

        # 组长可调度的成员名单（注入上下文，引导它把活分给群成员）
        members = GroupRoomService.list_members(leader_db, room)
        roster_lines = []
        for m in members:
            if m.role_in_room == "leader":
                continue
            emp = leader_db.get(Employee, m.employee_id)
            if emp:
                roster_lines.append(f"- {emp.name}（员工ID: {emp.id}）")
        roster = "\n".join(roster_lines) or "（暂无可用成员）"
        leader_brief = build_leader_brief(question, roster)

        history_messages, _ = ChatService._load_history_for_agent(
            leader_db, conversation_id=leader_conv.id,
            limit=get_settings().chat_history_max_messages,
        )
        ChatService._append_message(
            leader_db, conversation=leader_conv, role="user", content=question,
        )
        assistant_msg = ChatService._append_message(
            leader_db, conversation=leader_conv, role="assistant", content="",
        )
        leader_db.commit()

        from pathlib import Path as _Path

        _shared = str(
            _Path(get_settings().artifacts_path) / f"room-{room.id}" / "artifacts"
        )
        # bind_context=False：构建时不把 session 绑进 orchestrator 上下文，
        # 由 request_start 用 orchestrator_owned_db=leader_db 统一绑定独立 session。
        agent = get_orchestrator_agent(
            workspace_id=room.workspace_id,
            db=leader_db,
            conversation_id=leader_conv.id,
            auth_token=auth_token,
            shared_artifacts_dir=_shared,
            bind_context=False,
        )

        request_messages: list[dict[str, Any]] = [*history_messages]
        request_messages.append({"role": "user", "content": leader_brief})

        # 组长也逐字流式推到群时间线（分解派活/汇总的过程可见）
        register_group_stream_relay(
            leader_conv.id,
            room_id=room.id,
            room_conversation_id=room.room_conversation_id,
            workspace_id=room.workspace_id,
            sender_id=None,
            sender_label="组长",
        )

        # 本方法可能由 agent 工具调用线程触发（无运行中的事件循环），
        # 必须把 request_start 投递到主循环，否则 asyncio.create_task 会报
        # "no running event loop"。
        assistant_msg.stream_state = "streaming"
        leader_db.commit()
        _schedule_stream_start(
            conversation_id=leader_conv.id,
            agent=agent,
            messages=request_messages,
            stream_msg_id=assistant_msg.id,
            orchestrator_workspace_id=room.workspace_id,
            orchestrator_conversation_id=leader_conv.id,
            orchestrator_auth_token=auth_token,
            orchestrator_owned_db=leader_db,
            source="group_leader",
        )
        logger.info(
            "dispatched to leader conv=%s for room=%s",
            leader_conv.id,
            room.id,
        )
        return leader_conv.id

    @staticmethod
    def summarize_by_leader(db: Session, room: GroupRoom) -> int | None:
        """所有成员任务完成后，让组长读取共享产物做最终汇总并发到群里。"""
        from pathlib import Path

        from src.service.agent.orchestrator import get_orchestrator_agent
        from src.service.agent_stream_queue import StartResult
        from src.service.chat_service import ChatService
        from src.service.stream_registry import registry

        if room.leader_conversation_id is None:
            return None
        leader_conv = db.get(Conversation, room.leader_conversation_id)
        if leader_conv is None:
            return None

        # 列出共享产物目录里的文件，告诉组长去读取汇总
        settings = get_settings()
        shared_dir = Path(settings.artifacts_path) / f"room-{room.id}" / "artifacts"
        files: list[str] = []
        if shared_dir.exists():
            for p in shared_dir.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(shared_dir).as_posix()
                    files.append(f"/artifacts/{rel}")
        files_text = "\n".join(f"- {f}" for f in files) or "（暂无产物文件）"

        summary_brief = (
            "所有成员的子任务已完成。请你作为组长，读取以下共享产物文件，"
            "把各成员的成果整合成一份**面向用户的最终汇总**（结构清晰、重点突出，"
            "必要时引用关键数据）。直接给出汇总内容，不要再创建新计划。\n\n"
            f"共享产物文件（用 read 工具读取 /artifacts/ 下路径）：\n{files_text}"
        )

        history_messages, _ = ChatService._load_history_for_agent(
            db, conversation_id=leader_conv.id,
            limit=get_settings().chat_history_max_messages,
        )
        ChatService._append_message(
            db, conversation=leader_conv, role="user", content="（系统）请汇总各成员成果",
        )
        assistant_msg = ChatService._append_message(
            db, conversation=leader_conv, role="assistant", content="",
        )
        db.commit()

        # 组长也用房间共享产物目录，才能读到成员产出。
        # 用独立 DB session + bind_context=False，避免与完成回调的 session 并发冲突。
        from src.db.session import get_session_local

        leader_db = get_session_local()()
        agent = get_orchestrator_agent(
            workspace_id=room.workspace_id,
            db=leader_db,
            conversation_id=leader_conv.id,
            shared_artifacts_dir=str(shared_dir),
            bind_context=False,
        )

        request_messages: list[dict[str, Any]] = [*history_messages]
        request_messages.append({"role": "user", "content": summary_brief})

        # 组长汇总也逐字流式推到群时间线
        register_group_stream_relay(
            leader_conv.id,
            room_id=room.id,
            room_conversation_id=room.room_conversation_id,
            workspace_id=room.workspace_id,
            sender_id=None,
            sender_label="组长",
        )

        assistant_msg.stream_state = "streaming"
        db.commit()

        _schedule_stream_start(
            conversation_id=leader_conv.id,
            agent=agent,
            messages=request_messages,
            stream_msg_id=assistant_msg.id,
            orchestrator_workspace_id=room.workspace_id,
            orchestrator_conversation_id=leader_conv.id,
            orchestrator_owned_db=leader_db,
            source="group_leader_summary",
        )
        return leader_conv.id

    @staticmethod
    def get_room_state(db: Session, group_conversation_id: int) -> dict | None:
        """返回房间状态（成员 + 角色/状态），供前端渲染成员侧栏。"""
        conv = db.get(Conversation, group_conversation_id)
        if conv is None or conv.target_type != "group":
            return None
        room = GroupRoomService.ensure_room(db, conv)
        members = GroupRoomService.list_members(db, room)
        # 组长实时状态：其会话是否正在流式输出
        leader_running = (
            room.leader_conversation_id is not None
            and GroupRoomService._conv_is_streaming(room.leader_conversation_id)
        )
        # 组长置顶（虚拟成员，不在 GroupRoomMember 表里，用总管编排 agent）
        member_dicts = [{
            "member_id": -1,
            "employee_id": None,
            "employee_name": "组长",
            "role_in_room": "leader",
            "state": "running" if leader_running else "ready",
            "conversation_id": room.leader_conversation_id,
        }]
        for m in members:
            if m.role_in_room == "leader":
                continue
            emp = db.get(Employee, m.employee_id)
            member_dicts.append({
                "member_id": m.id,
                "employee_id": m.employee_id,
                "employee_name": emp.name if emp else None,
                "role_in_room": m.role_in_room,
                # 实时状态：正在流式=running，否则用存储态（done/ready）
                "state": GroupRoomService._live_member_state(db, room, m),
                "conversation_id": m.conversation_id,
            })
        return {
            "room_id": room.id,
            "room_conversation_id": room.room_conversation_id,
            "chat_group_id": room.chat_group_id,
            "status": room.status,
            "title": room.title,
            "members": member_dicts,
        }

    @staticmethod
    def get_room_dag(db: Session, group_conversation_id: int) -> dict | None:
        """返回房间当前协作的 DAG（节点+边），用于前端画 SOP 流程图。

        只有"组长统筹"模式（组长创建了编排计划）才有 DAG；纯 @ 直接派活无计划，
        返回 has_dag=False，前端回退到简单成员列表。

        节点：用户 → 组长 → 各成员任务 → 组长汇总（虚拟）。
        每个任务节点带：负责员工、任务名、状态、产物引用、依赖上游。
        """
        from src.models.orchestration_plan import OrchestrationPlan
        from src.models.employee_task import EmployeeTask
        from src.models.task_execution_log import TaskExecutionLog
        from src.service.agent.orchestrator.dependency_scheduler import (
            build_dependency_maps,
        )

        conv = db.get(Conversation, group_conversation_id)
        if conv is None or conv.target_type != "group":
            return None
        room = GroupRoomService.ensure_room(db, conv)

        # 找组长最新的编排计划
        plan = None
        if room.leader_conversation_id is not None:
            plan = db.scalars(
                select(OrchestrationPlan)
                .where(
                    OrchestrationPlan.conversation_id == room.leader_conversation_id
                )
                .order_by(OrchestrationPlan.id.desc())
            ).first()
        if plan is None:
            return {"has_dag": False, "room_id": room.id, "nodes": [], "edges": []}

        plan_tasks = list(
            db.scalars(
                select(EmployeeTask)
                .where(EmployeeTask.orchestration_plan_id == plan.id)
                .order_by(EmployeeTask.id.asc())
            ).all()
        )
        if not plan_tasks:
            return {"has_dag": False, "room_id": room.id, "nodes": [], "edges": []}

        plan_json_obj = json.loads(plan.plan_json or "[]")
        dep_map, _succ = build_dependency_maps(plan_tasks, plan_json_obj)

        # 每个任务的最新执行日志（状态 + 产物）
        task_ids = [t.id for t in plan_tasks]
        logs_by_task: dict[int, TaskExecutionLog] = {}
        if task_ids:
            for log in db.scalars(
                select(TaskExecutionLog)
                .where(TaskExecutionLog.task_id.in_(task_ids))
                .order_by(TaskExecutionLog.id.asc())
            ).all():
                if log.task_id is not None:
                    logs_by_task[log.task_id] = log  # 保留最新（asc 顺序覆盖）

        def _task_state(log: TaskExecutionLog | None) -> str:
            if log is None:
                return "pending"
            s = (log.run_status or "").lower()
            if s in ("success", "completed"):
                return "done"
            if s == "queued":
                return "queued"
            if s == "running":
                return "running"
            if s in ("failed", "error", "cancelled"):
                return "failed"
            return "pending"

        import re
        from pathlib import Path as _Path

        # 房间共享产物目录里实际存在的文件（用于校验 + 兜底归属）
        settings = get_settings()
        shared_root = _Path(settings.artifacts_path) / f"room-{room.id}" / "artifacts"
        real_files: set[str] = set()
        if shared_root.exists():
            for p in shared_root.rglob("*"):
                if p.is_file():
                    real_files.add("/artifacts/" + p.relative_to(shared_root).as_posix())
        # 文件名 → 完整 /artifacts 路径，便于从文本里按文件名命中
        by_name: dict[str, str] = {}
        for f in real_files:
            by_name[f.rsplit("/", 1)[-1]] = f

        _path_re = re.compile(r"/artifacts/[^\s`\"'）)，。]+")

        def _artifacts(log: TaskExecutionLog | None) -> list[str]:
            """从执行日志里抽取该任务的产物路径：
            1) output_json.artifacts 结构化字段；
            2) output_json.content / run_result 文本里出现的 /artifacts/... 路径；
            只保留共享目录里真实存在的文件，避免幻觉路径。
            """
            if log is None:
                return []
            found: list[str] = []
            blob = log.output_json or ""
            try:
                out = json.loads(blob)
                if isinstance(out, dict):
                    arts = out.get("artifacts")
                    if isinstance(arts, list):
                        found.extend(str(a) for a in arts)
                    if out.get("content"):
                        blob = str(out["content"])
            except (json.JSONDecodeError, TypeError):
                pass
            for m in _path_re.findall(blob + " " + (log.run_result or "")):
                found.append(m)
            # 归一化 + 只留真实存在的
            result: list[str] = []
            seen: set[str] = set()
            for a in found:
                cand = a if a in real_files else by_name.get(a.rsplit("/", 1)[-1], "")
                if cand and cand in real_files and cand not in seen:
                    seen.add(cand)
                    result.append(cand)
            return result

        nodes: list[dict] = []
        edges: list[dict] = []

        # 固定节点：用户、组长
        nodes.append({
            "id": "user", "type": "user", "name": "用户",
            "task": plan.user_input or "", "state": "done", "artifacts": [],
        })
        leader_running = (
            room.leader_conversation_id is not None
            and GroupRoomService._conv_is_streaming(room.leader_conversation_id)
        )
        nodes.append({
            "id": "leader", "type": "leader", "name": "组长",
            "task": "分解与派活", "state": "running" if leader_running else "done",
            "artifacts": [],
            "running_since": (
                GroupRoomService._stream_started_at_iso(room.leader_conversation_id)
                if leader_running
                else None
            ),
        })
        edges.append({"from": "user", "to": "leader"})

        # 任务节点
        roots: list[str] = []
        leaves: list[str] = []
        for t in plan_tasks:
            log = logs_by_task.get(t.id)
            emp = db.get(Employee, t.employee_id)
            node_id = f"task-{t.id}"
            exec_conv_id = log.conversation_id if log and log.conversation_id else None
            task_state = _task_state(log)
            nodes.append({
                "id": node_id,
                "type": "worker",
                "name": emp.name if emp else f"员工#{t.employee_id}",
                "employee_id": t.employee_id,
                "task": t.task_name or "",
                "state": task_state,
                "artifacts": _artifacts(log),
                "conversation_id": exec_conv_id,
                "running_since": GroupRoomService._task_running_since_iso(
                    log, task_state, exec_conv_id
                ),
            })
            deps = dep_map.get(t.id, [])
            if not deps:
                roots.append(node_id)
                edges.append({"from": "leader", "to": node_id})
            else:
                for dep_id in deps:
                    edges.append({"from": f"task-{dep_id}", "to": node_id})

        # 叶子节点（没有后继）→ 汇入组长汇总
        has_successor = {e["from"] for e in edges}
        for t in plan_tasks:
            nid = f"task-{t.id}"
            if nid not in has_successor:
                leaves.append(nid)

        # 组长汇总节点：汇集本轮所有共享产物，方便一处查看
        all_done = all(
            _task_state(logs_by_task.get(t.id)) == "done" for t in plan_tasks
        )
        nodes.append({
            "id": "summary", "type": "leader", "name": "组长汇总",
            "task": "汇总结果", "state": "done" if all_done else "pending",
            "artifacts": sorted(real_files),
        })
        for nid in leaves:
            edges.append({"from": nid, "to": "summary"})

        return {
            "has_dag": True,
            "room_id": room.id,
            "plan_id": plan.id,
            "nodes": nodes,
            "edges": edges,
        }

    @staticmethod
    def _conv_is_streaming(conversation_id: int) -> bool:
        """该会话当前是否正在流式输出（不含仅排队未启动）。"""
        try:
            from src.service.stream_registry import registry

            return registry.is_active(conversation_id)
        except Exception:
            return False

    @staticmethod
    def _log_started_at_iso(log: Any) -> str | None:
        if log is None or getattr(log, "started_at", None) is None:
            return None
        return log.started_at.isoformat()

    @staticmethod
    def _stream_started_at_iso(conversation_id: int | None) -> str | None:
        """从 stream_metrics 取会话流式启动时刻（ISO8601）。"""
        if conversation_id is None:
            return None
        try:
            from datetime import datetime, timezone

            from src.service.stream_metrics import metrics

            ts = metrics.get_started_at(conversation_id)
            if ts is not None:
                return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except Exception:
            pass
        return None

    @staticmethod
    def _task_running_since_iso(
        log: Any,
        state: str,
        exec_conv_id: int | None,
    ) -> str | None:
        """任务节点进行中/排队时的权威起始时刻（优先 DB 日志，其次流指标）。"""
        if state not in ("running", "queued"):
            return None
        since = GroupRoomService._log_started_at_iso(log)
        if since is not None:
            return since
        if state == "running":
            return GroupRoomService._stream_started_at_iso(exec_conv_id)
        return None

    @staticmethod
    def _live_member_state(
        db: Session, room: GroupRoom, member: GroupRoomMember
    ) -> str:
        """成员实时状态：
        - 该成员有任意会话正在流式 → running；
        - 否则用存储态（done/ready/sleeping）。
        覆盖两条派活路径：@直接派（member.conversation_id）与组长编排派
        （employee 在本房间计划下的任务会话）。
        """
        from src.models.task_execution_log import TaskExecutionLog

        # @ 直接派的私有会话
        if member.conversation_id is not None and GroupRoomService._conv_is_streaming(
            member.conversation_id
        ):
            return "running"

        # 组长编排派的任务会话：查该员工在本房间(组长会话)下是否有 running/queued 日志
        if room.leader_conversation_id is not None:
            active_log = db.scalars(
                select(TaskExecutionLog).where(
                    TaskExecutionLog.orchestrator_conversation_id
                    == room.leader_conversation_id,
                    TaskExecutionLog.employee_id == member.employee_id,
                    TaskExecutionLog.run_status.in_(("running", "queued")),
                )
                .order_by(TaskExecutionLog.id.desc())
            ).first()
            if active_log is not None:
                cid = active_log.conversation_id
                if (active_log.run_status or "").lower() == "queued":
                    if cid is not None and GroupRoomService._conv_is_streaming(cid):
                        return "running"
                    return "queued"
                return "running"

        return member.state or "ready"

    @staticmethod
    def read_room_artifact(
        db: Session, group_conversation_id: int, path: str
    ) -> dict | None:
        """读取房间共享产物目录里的文件内容（用于前端弹窗预览）。

        path 形如 "/artifacts/weibo-hot-search/热搜榜单.md" 或相对路径。
        做路径校验，禁止越界访问共享目录之外。
        """
        from pathlib import Path

        conv = db.get(Conversation, group_conversation_id)
        if conv is None or conv.target_type != "group":
            return None
        room = GroupRoomService.ensure_room(db, conv)
        shared_root = (
            Path(get_settings().artifacts_path) / f"room-{room.id}" / "artifacts"
        ).resolve()

        rel = path.lstrip("/")
        if rel.startswith("artifacts/"):
            rel = rel[len("artifacts/"):]
        target = (shared_root / rel).resolve()
        # 防越界
        try:
            target.relative_to(shared_root)
        except ValueError:
            return None
        if not target.is_file():
            return None

        name = target.name
        suffix = target.suffix.lower().lstrip(".")
        is_text = suffix in (
            "md", "txt", "json", "csv", "html", "htm", "py", "js", "ts",
            "yaml", "yml", "log", "xml", "",
        )
        if is_text:
            try:
                content = target.read_text(encoding="utf-8", errors="replace")
            except Exception:
                content = ""
            # 限制返回大小
            if len(content) > 200_000:
                content = content[:200_000] + "\n\n…（内容过长已截断）"
            return {
                "name": name,
                "path": f"/artifacts/{rel}",
                "type": suffix or "text",
                "is_text": True,
                "content": content,
            }
        return {
            "name": name,
            "path": f"/artifacts/{rel}",
            "type": suffix,
            "is_text": False,
            "content": "",
        }

    @staticmethod
    def leader_awaiting_clarification(db: Session, room: "GroupRoom") -> bool:
        """组长会话最后一条 assistant 消息是否为 interrupted(待澄清)态。"""
        if room.leader_conversation_id is None:
            return False
        last = db.scalars(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == room.leader_conversation_id,
                ConversationMessage.role == "assistant",
            )
            .order_by(ConversationMessage.id.desc())
        ).first()
        return bool(last and last.stream_state == "interrupted")

    @staticmethod
    def _allowed(member: GroupRoomMember, source: str) -> bool:
        """白名单：source 是否允许唤醒该成员。allow_from=null → 不限。"""
        if not member.allow_from:
            return True
        try:
            allow = json.loads(member.allow_from)
            if isinstance(allow, list):
                return source in allow
        except (json.JSONDecodeError, TypeError):
            pass
        return True


def _project_simple(
    db: Session,
    room: GroupRoom,
    conversation_id: int,
    stream_state: str,
    sender_label: str,
    *,
    sender_id: int | None,
) -> None:
    """读取某会话的最终 assistant 内容，作为结论投影到群时间线。"""
    if stream_state == "completed":
        last = db.scalars(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == conversation_id,
                ConversationMessage.role == "assistant",
            )
            .order_by(ConversationMessage.id.desc())
        ).first()
        content = (last.content or "").strip() if last else ""
        if not content:
            content = "（已完成）"
        GroupRoomService.post_to_timeline(
            db, room,
            role="assistant",
            content=content,
            sender_id=sender_id,
            sender_label=sender_label,
            extra_meta={"source_conversation_id": conversation_id},
        )
    elif stream_state in ("cancelled", "error"):
        GroupRoomService.post_to_timeline(
            db, room,
            role="assistant",
            content=f"（{sender_label}{stream_state}）",
            sender_id=sender_id,
            sender_label=sender_label,
        )
    logger.info(
        "projected conv=%s (%s) as '%s' to room=%s",
        conversation_id, stream_state, sender_label, room.id,
    )


def _flow_summary_back_to_curator(
    db: Session, room: GroupRoom, leader_conv_id: int
) -> None:
    """把组长的最终汇总回流到发起拉群的总管会话。

    只回流"最终汇总"那一次（计划里所有任务都完成时的组长完成事件），
    避免把组长最初的"已安排执行..."派活说明也回流。
    用 plan.status=='summarized' 作为"已进入汇总阶段"的标记。
    """
    from src.models.orchestration_plan import OrchestrationPlan

    curator_conv_id = room.origin_curator_conversation_id
    if curator_conv_id is None:
        return
    # 仅在计划已进入 summarized 阶段才回流（即这是汇总流，不是派活流）
    plan = db.scalars(
        select(OrchestrationPlan)
        .where(OrchestrationPlan.conversation_id == leader_conv_id)
        .order_by(OrchestrationPlan.id.desc())
    ).first()
    if plan is None or plan.status != "summarized":
        return
    # 幂等：避免重复回流
    if (plan.status or "") == "flowed_back":
        return

    # 取组长最终汇总文本
    last = db.scalars(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == leader_conv_id,
            ConversationMessage.role == "assistant",
        )
        .order_by(ConversationMessage.id.desc())
    ).first()
    summary_text = (last.content or "").strip() if last else ""
    if not summary_text:
        return

    curator_conv = db.get(Conversation, curator_conv_id)
    if curator_conv is None:
        return

    # 作为一条 user 消息追加到总管会话（让总管据此转告用户），并标记来源
    group_name = room.title or f"群#{room.id}"
    flow_msg = ConversationMessage(
        conversation_id=curator_conv_id,
        role="user",
        content=(
            f"📍 来自群「{group_name}」的协作汇总\n"
            f"（该群的组长已统筹各成员完成协作，下面是最终结果，"
            f"请你转告用户并按需补充）：\n\n{summary_text}"
        ),
        stream_state="completed",
        extra_meta=json.dumps(
            {
                "group_summary_flowback": True,
                "room_id": room.id,
                "group_name": group_name,
            },
            ensure_ascii=False,
        ),
    )
    db.add(flow_msg)
    plan.status = "flowed_back"
    db.commit()

    # 推工作空间事件，前端可提示总管会话有新汇总
    try:
        from src.service.workspace_events import WorkspaceEventBus

        WorkspaceEventBus.push(room.workspace_id, {
            "type": "group_summary_flowback",
            "room_id": room.id,
            "curator_conversation_id": curator_conv_id,
            "message_id": flow_msg.id,
        })
    except Exception:
        logger.warning("push group_summary_flowback failed", exc_info=True)
    logger.info(
        "flowed group summary back to curator conv=%s (room=%s)",
        curator_conv_id, room.id,
    )


def _resolve_room_for_orchestration_conv(
    db: Session, conversation_id: int
) -> tuple[GroupRoom | None, int | None]:
    """判断某会话是否为某房间组长派发的编排任务会话。

    组长派活经 start_task_as_conversation，会建 TaskExecutionLog，其
    orchestrator_conversation_id 指向组长会话。反查 GroupRoom.leader_conversation_id
    命中即属于该房间。返回 (房间, 该任务的员工id)。
    """
    from src.models.task_execution_log import TaskExecutionLog

    log = db.scalars(
        select(TaskExecutionLog)
        .where(TaskExecutionLog.conversation_id == conversation_id)
        .order_by(TaskExecutionLog.id.desc())
    ).first()
    if log is None or log.orchestrator_conversation_id is None:
        return None, None
    room = db.scalars(
        select(GroupRoom).where(
            GroupRoom.leader_conversation_id == log.orchestrator_conversation_id
        )
    ).first()
    if room is None:
        return None, None
    return room, log.employee_id


def project_member_conversation_if_in_room(
    conversation_id: int, stream_state: str
) -> None:
    """若该会话是某房间成员的私有会话，把其终态结论投影到群时间线。

    由 stream_registry._finalize_task_stream 在**任何**流终态时调用（不依赖
    TaskExecutionLog，也不依赖脆弱的即时 buffer 订阅）。用 DB 反查
    GroupRoomMember.conversation_id == 该会话，命中则投影。
    """
    from src.db.session import get_session_local

    db = get_session_local()()
    try:
        # A) 组长会话：把组长的汇总/回复投影到群时间线（作者=组长）
        leader_room = db.scalars(
            select(GroupRoom).where(
                GroupRoom.leader_conversation_id == conversation_id
            )
        ).first()
        if leader_room is not None:
            # 中断（HITL 澄清）：把组长 interrupted 消息里的 clarifying_questions
            # parts 投影成群时间线的一条卡片，让用户在群里看到并作答。
            if stream_state == "interrupted":
                last = db.scalars(
                    select(ConversationMessage)
                    .where(
                        ConversationMessage.conversation_id == conversation_id,
                        ConversationMessage.role == "assistant",
                        ConversationMessage.stream_state == "interrupted",
                    )
                    .order_by(ConversationMessage.id.desc())
                ).first()
                if last is None:
                    logger.warning(
                        "组长会话 %s interrupted 但无 assistant 消息，跳过澄清投影",
                        conversation_id,
                    )
                    return
                parts = json.loads(last.message_parts) if last.message_parts else None
                if parts is None:
                    logger.warning(
                        "组长会话 %s interrupted 但澄清消息无 parts，已投影纯文本兜底",
                        conversation_id,
                    )
                GroupRoomService.post_to_timeline(
                    db, leader_room,
                    role="assistant",
                    content=(last.content or "").strip() or "我需要先确认一些信息，请在群里补充说明。",
                    sender_id=None,
                    sender_label="组长",
                    extra_meta={
                        "clarify_target_conversation_id": conversation_id,
                        "clarify_message_id": last.id,
                    },
                    message_parts=parts,
                )
                return  # early-return：不落入 completed/_project_simple，不回流总管
            _project_simple(
                db, leader_room, conversation_id, stream_state, "组长", sender_id=None
            )
            # 汇总回流：组长流完成且房间有发起的总管会话 → 把组长这条回复
            # 转给总管会话，让总管把群里的最终结果转告用户。
            if (
                stream_state == "completed"
                and leader_room.origin_curator_conversation_id is not None
            ):
                _flow_summary_back_to_curator(
                    db, leader_room, conversation_id
                )
            return

        # B) 组长派发的编排任务会话：成员产出**只进 DAG 面板**（更新状态），
        #    不再刷群时间线，避免淹没。产物/结论由 DAG 接口从 TaskExecutionLog 实时读。
        task_room, task_employee_id = _resolve_room_for_orchestration_conv(
            db, conversation_id
        )
        if task_room is not None:
            if task_employee_id is not None:
                task_member = db.scalars(
                    select(GroupRoomMember).where(
                        GroupRoomMember.room_id == task_room.id,
                        GroupRoomMember.employee_id == task_employee_id,
                    )
                ).first()
                if task_member is not None:
                    new_state = "done" if stream_state in ("completed", "success") else "ready"
                    GroupRoomService.update_member_state(db, task_member, new_state)
            logger.info(
                "member task conv=%s (%s) → DAG only (room=%s)",
                conversation_id, stream_state, task_room.id,
            )
            return

        # C) 直接 @ 派发的成员私有会话：同样只更新状态 + 投影到群时间线。
        #    @ 直接派是用户点名要某成员单独回话，结论仍进时间线（用户在等它）。
        member = db.scalars(
            select(GroupRoomMember).where(
                GroupRoomMember.conversation_id == conversation_id
            )
        ).first()
        if member is None:
            return  # 非群相关会话，无需投影
        room = db.get(GroupRoom, member.room_id)
        if room is None:
            return
        employee = db.get(Employee, member.employee_id)
        sender_label = (
            employee.name if employee else f"员工#{member.employee_id}"
        )

        if stream_state == "completed":
            last = db.scalars(
                select(ConversationMessage)
                .where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                )
                .order_by(ConversationMessage.id.desc())
            ).first()
            content = (last.content or "").strip() if last else ""
            if not content:
                content = "（已完成）"
            GroupRoomService.post_to_timeline(
                db,
                room,
                role="assistant",
                content=content,
                sender_id=member.employee_id,
                sender_label=sender_label,
                extra_meta={"member_conversation_id": conversation_id},
            )
            GroupRoomService.update_member_state(db, member, "done")
        elif stream_state in ("cancelled", "error", "interrupted"):
            GroupRoomService.update_member_state(db, member, "ready")
        logger.info(
            "projected @member conv=%s (%s) to room=%s timeline",
            conversation_id,
            stream_state,
            room.id,
        )
    finally:
        db.close()
