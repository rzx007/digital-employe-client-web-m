"""学习闭环：journal 捕获（子任务终态结构化流水，零模型调用）。"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import cst_now

logger = logging.getLogger(__name__)

_CONCLUSION_MAX = 500


def _brain_root_for(employee_id: int) -> Path:
    """员工大脑根 = <skill_path>/<employee_id>。"""
    from src.service.agent.paths import resolve_employee_memories_dir
    return resolve_employee_memories_dir(employee_id=employee_id).parent


def _conclusion_from_output(output_json: str | None) -> str:
    if not output_json:
        return ""
    try:
        content = json.loads(output_json).get("content", "") or ""
    except (ValueError, TypeError):
        content = ""
    return content[:_CONCLUSION_MAX]


def capture_journal_entry(db: Session, log: TaskExecutionLog) -> None:
    """子任务终态 → 往员工大脑 journal/YYYY-MM-DD.jsonl 追加一条。零模型、容错。"""
    try:
        if log is None or log.employee_id is None:
            return
        entry = {
            "ts": (log.started_at or cst_now()).isoformat(),
            "task_id": log.task_id,
            "task_name": log.task_name_snapshot or "",
            "employee_id": log.employee_id,
            "status": log.run_status,
            "duration_ms": log.duration_ms,
            "conclusion": _conclusion_from_output(log.output_json),
            "error": log.error_message,
            "tools_used": [],  # 2A-2 填充
        }
        jdir = _brain_root_for(log.employee_id) / "journal"
        jdir.mkdir(parents=True, exist_ok=True)
        fname = (log.ended_at or log.started_at or cst_now()).strftime("%Y-%m-%d") + ".jsonl"
        with (jdir / fname).open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        logger.warning("journal capture failed log_id=%s", getattr(log, "id", None), exc_info=True)
