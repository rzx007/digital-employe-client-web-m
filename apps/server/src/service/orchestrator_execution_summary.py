"""总管会话：子任务完成时自动写入摘要消息。"""

from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.conversation import Conversation, ConversationMessage
from src.models.employee import Employee
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)

_STATUS_HEADINGS: dict[str, str] = {
    "success": "任务完成",
    "failed": "任务失败",
    "cancelled": "任务已取消",
    "timeout": "任务超时",
}

_SUMMARY_SOURCE = "orchestrator_execution_summary"


def extract_execution_output_text(output_json: str, max_chars: int = 2000) -> str:
    try:
        data = json.loads(output_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(data, dict):
        return ""
    content = data.get("content") or data.get("text") or ""
    if not isinstance(content, str):
        content = str(content)
    content = content.strip()
    if not content:
        return ""
    if len(content) > max_chars:
        return content[:max_chars] + f"\n…（已截断，共 {len(content)} 字）"
    return content


def _map_stream_state_to_run_status(stream_state: str) -> str:
    if stream_state == "completed":
        return "success"
    if stream_state == "cancelled":
        return "cancelled"
    return "failed"


def build_execution_summary_content(
    log: TaskExecutionLog,
    employee_name: str,
    *,
    run_status: str | None = None,
    output_max_chars: int = 800,
) -> str:
    status = run_status or log.run_status
    heading = _STATUS_HEADINGS.get(status, "任务结束")
    duration = ""
    if log.duration_ms is not None:
        duration = f"，耗时 {log.duration_ms / 1000:.1f}s"

    lines = [
        f"【{heading}】{log.task_name_snapshot} — {employee_name}"
        f"（员工会话 #{log.conversation_id or '—'}{duration}）",
        "",
    ]

    if status == "success":
        excerpt = extract_execution_output_text(log.output_json, output_max_chars)
        if excerpt:
            lines.append("结果摘要：")
            lines.append(excerpt)
        else:
            lines.append("结果摘要：（无文本输出，详见下方任务执行卡片）")
    elif log.error_message:
        lines.append(f"原因：{str(log.error_message)[:500]}")

    lines.append("")
    lines.append("可点击下方卡片进入员工对话查看详情。")
    return "\n".join(lines).strip()


def _summary_event_time(log: TaskExecutionLog):
    """摘要消息在会话时间轴上的锚点：与任务结束时刻对齐。"""
    if log.ended_at is not None:
        return log.ended_at
    if log.started_at is not None:
        return log.started_at
    return cst_now()


def _find_summary_message(
    db: Session, orchestrator_conversation_id: int, execution_log_id: int
) -> ConversationMessage | None:
    recent = list(
        db.scalars(
            select(ConversationMessage)
            .where(
                ConversationMessage.conversation_id == orchestrator_conversation_id,
                ConversationMessage.role == "assistant",
            )
            .order_by(ConversationMessage.id.desc())
            .limit(30)
        ).all()
    )
    for msg in recent:
        if not msg.extra_meta:
            continue
        try:
            meta = json.loads(msg.extra_meta)
        except (json.JSONDecodeError, TypeError):
            continue
        if (
            meta.get("source") == _SUMMARY_SOURCE
            and meta.get("execution_log_id") == execution_log_id
        ):
            return msg
    return None


def _summary_already_posted(db: Session, orchestrator_conversation_id: int, execution_log_id: int) -> bool:
    return _find_summary_message(db, orchestrator_conversation_id, execution_log_id) is not None


def align_posted_summary_timestamp(
    db: Session,
    log: TaskExecutionLog,
    orchestrator_conversation_id: int,
) -> bool:
    """历史 backfill 若用了当前时间，对齐到任务结束时刻以修复卡片排序。"""
    msg = _find_summary_message(db, orchestrator_conversation_id, log.id)
    if msg is None:
        return False
    event_time = _summary_event_time(log)
    if msg.created_at == event_time:
        return False
    msg.created_at = event_time
    db.add(msg)
    db.commit()
    return True


def extract_text_from_message_parts(message_parts_json: str | None) -> str:
    if not message_parts_json:
        return ""
    try:
        parts = json.loads(message_parts_json)
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(parts, list):
        return ""
    texts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") != "text":
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text.strip())
    return "\n\n".join(texts)


def resolve_assistant_delivery_text(msg: ConversationMessage | None) -> str:
    if msg is None:
        return ""
    content = (msg.content or "").strip()
    if content:
        return content
    return extract_text_from_message_parts(msg.message_parts)


def backfill_missing_orchestrator_summaries(
    db: Session,
    workspace_id: int,
    orchestrator_conversation_id: int,
    *,
    limit: int = 10,
) -> int:
    """补写尚未落库的总管摘要（finalize 漏写或历史数据）。"""
    from src.service.task_service import TaskService

    logs, _ = TaskService.list_execution_logs(
        db,
        workspace_id,
        orchestrator_conversation_id=orchestrator_conversation_id,
        page=1,
        page_size=limit,
    )
    posted = 0
    for log in logs:
        if log.run_status not in ("success", "failed", "cancelled", "timeout"):
            continue
        if _summary_already_posted(db, orchestrator_conversation_id, log.id):
            align_posted_summary_timestamp(db, log, orchestrator_conversation_id)
            continue
        stream_state = {
            "success": "completed",
            "cancelled": "cancelled",
        }.get(log.run_status, "error")
        if append_orchestrator_execution_summary(db, log, stream_state):
            posted += 1
    return posted


def resolve_log_orchestrator_conversation_id(
    db: Session, log: TaskExecutionLog
) -> int | None:
    """解析执行日志归属的总管会话（列优先，否则从任务/编排计划推导）。"""
    if log.orchestrator_conversation_id is not None:
        return int(log.orchestrator_conversation_id)

    from src.models.employee_task import EmployeeTask
    from src.service.orchestrator_conversation_links import (
        resolve_orchestrator_conversation_id,
    )

    if log.task_id is None:
        return None
    task = db.get(EmployeeTask, log.task_id)
    if task is None:
        return None
    orch_conv_id = resolve_orchestrator_conversation_id(db, task)
    if orch_conv_id is not None:
        log.orchestrator_conversation_id = orch_conv_id
        db.add(log)
        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.warning(
                "persist orchestrator_conversation_id failed execution=%s",
                log.id,
                exc_info=True,
            )
            return orch_conv_id
    return orch_conv_id


def append_orchestrator_execution_summary(
    db: Session,
    log: TaskExecutionLog,
    stream_state: str,
) -> ConversationMessage | None:
    """子任务结束时向总管会话追加一条 assistant 摘要消息。"""
    orch_conv_id = resolve_log_orchestrator_conversation_id(db, log)
    if orch_conv_id is None:
        logger.warning(
            "skip orchestrator summary: no orch conv execution=%s task=%s",
            log.id,
            log.task_id,
        )
        return None

    conv = db.get(Conversation, orch_conv_id)
    if not conv or conv.target_type != "curator":
        return None

    if _summary_already_posted(db, orch_conv_id, log.id):
        return None

    employee = db.get(Employee, log.employee_id)
    employee_name = employee.name if employee else str(log.employee_id)
    run_status = _map_stream_state_to_run_status(stream_state)
    content = build_execution_summary_content(
        log,
        employee_name,
        run_status=run_status,
    )

    event_time = _summary_event_time(log)
    meta = {
        "source": _SUMMARY_SOURCE,
        "execution_log_id": log.id,
        "task_id": log.task_id,
        "employee_conversation_id": log.conversation_id,
        "run_status": run_status,
        "created_at": event_time.isoformat(),
    }
    message = ConversationMessage(
        conversation_id=orch_conv_id,
        role="assistant",
        content=content,
        extra_meta=json.dumps(meta, ensure_ascii=False),
        stream_state="completed",
        created_at=event_time,
    )
    db.add(message)
    conv.updated_at = cst_now()
    db.add(conv)
    db.commit()
    db.refresh(message)
    logger.info(
        "orchestrator execution summary posted orch_conv=%s execution=%s status=%s",
        orch_conv_id,
        log.id,
        run_status,
    )
    return message
