from __future__ import annotations

import json
import logging
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from typing import Any

from apscheduler.triggers.cron import CronTrigger  # pylint: disable=import-error
from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.skill_rating import SkillRating
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import CST, cst_now
from src.service.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)


class TaskService:
    @staticmethod
    def _is_skill_dispatch(dispatch_type: str | None) -> bool:
        return (dispatch_type or "skill").strip().lower() == "skill"

    @staticmethod
    def _is_mcp_dispatch(dispatch_type: str | None) -> bool:
        return (dispatch_type or "").strip().lower() == "mcp"

    @staticmethod
    def _is_skill_or_mcp_dispatch(dispatch_type: str | None) -> bool:
        d = (dispatch_type or "").strip().lower()
        return d in ("skill", "mcp")

    @staticmethod
    def _loads_json(raw: str | None, default: Any) -> Any:
        if not raw:
            return default
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return default

    @staticmethod
    def _to_int(value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _to_bool(value: Any, default: bool = True) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"1", "true", "yes", "y", "on"}:
                return True
            if lowered in {"0", "false", "no", "n", "off"}:
                return False
        return bool(value)

    @staticmethod
    def _build_trigger(cron_expression: str) -> CronTrigger:
        return CronTrigger.from_crontab(cron_expression, timezone=CST)

    @staticmethod
    def compute_next_run(cron_expression: str, now: datetime | None = None) -> datetime | None:
        if not cron_expression:
            return None
        current = now or cst_now()
        try:
            trigger = TaskService._build_trigger(cron_expression)
            return trigger.get_next_fire_time(previous_fire_time=None, now=current)
        except ValueError:
            return None

    @staticmethod
    def _extract_shift_info(employee: Employee) -> tuple[int | None, str | None, dict[str, Any]]:
        meta = TaskService._loads_json(employee.meta_json, {})
        shift_schedule = TaskService._loads_json(getattr(employee, "shift_schedule_json", "{}"), {})
        if not isinstance(shift_schedule, dict):
            shift_schedule = {}
        if not shift_schedule:
            from_meta = meta.get("shift_schedule")
            if isinstance(from_meta, dict):
                shift_schedule = from_meta

        shift_id = TaskService._to_int(meta.get("shift_id"))
        if shift_id is None:
            shift_id = TaskService._to_int(shift_schedule.get("shift_id"))
        shift_name = meta.get("shift_name") or shift_schedule.get("shift_name")
        if shift_id is None and shift_name is None and shift_schedule:
            shift_id = 0
            shift_name = "Default Shift"
        return shift_id, str(shift_name) if shift_name is not None else None, shift_schedule

    @staticmethod
    def _describe_cron(cron_expression: str) -> str:
        if cron_expression.startswith("*/") and cron_expression.endswith(" * * * *"):
            minute = cron_expression.split(" ")[0].replace("*/", "")
            if minute.isdigit():
                return f"每 {minute} 分钟"
        return cron_expression

    @staticmethod
    def list_employee_tasks_as_dict(db: Session, employee_id: int) -> list[dict]:
        """查询某个员工的所有 skill/mcp 任务，以 dict 列表返回（供 API 序列化）。"""
        tasks = list(
            db.scalars(
                select(EmployeeTask).where(
                    EmployeeTask.employee_id == employee_id,
                    EmployeeTask.dispatch_type.in_(("skill", "mcp")),
                ).order_by(EmployeeTask.id.asc())
            ).all()
        )
        return [
            {
                "id": t.id,
                "task_name": t.task_name,
                "dispatch_type": t.dispatch_type,
                "skill_id": t.skill_id,
                "capability_id": t.capability_id,
                "priority": t.priority,
                "task_type": t.task_type,
                "cron_expression": t.cron_expression,
                "cron_expression_type": t.cron_expression_type,
                "is_active": t.is_active,
                "confirm_execution_result": t.confirm_execution_result,
                "user_prompt": t.user_prompt,
                "source": getattr(t, "source", None) or "manual",
                "config": {"input": json.loads(t.task_input_json or "{}")},
            }
            for t in tasks
        ]

    @staticmethod
    def sync_workspace_tasks(db: Session, workspace_id: int) -> list[EmployeeTask]:
        """启动时只重算 next_run_at，不再从 meta_json.tasks 同步或停用任务。
        employee_tasks 表是任务唯一数据源。"""
        now = cst_now()
        tasks = list(
            db.scalars(
                select(EmployeeTask).where(
                    EmployeeTask.workspace_id == workspace_id,
                    EmployeeTask.is_active.is_(True),
                )
            ).all()
        )
        for task in tasks:
            if task.employee_id:
                employee = db.get(Employee, task.employee_id)
                if employee:
                    task.employee_name_snapshot = employee.name
            task.next_run_at = TaskService.compute_next_run(task.cron_expression, now=now)
            task.updated_at = now
        if tasks:
            db.commit()
            logger.info(
                "sync_workspace_tasks: recalculated next_run_at for %d active tasks in workspace %d",
                len(tasks),
                workspace_id,
            )
        return tasks

    @staticmethod
    def upsert_employee_tasks(
        db: Session,
        workspace_id: int,
        employee_id: int,
        tasks: list[dict],
    ) -> list[EmployeeTask]:
        """为单个员工 upsert 任务（创建/编辑员工时调用）。
        按 (task_name, dispatch_type, skill_id, capability_id) 签名去重，
        不在输入列表中的已有任务会被物理删除（执行记录保留）。"""
        employee = db.get(Employee, employee_id)
        employee_name = employee.name if employee else ""
        now = cst_now()

        active_signatures: set[tuple[str, str, int | None, int | None]] = set()
        upserted: list[EmployeeTask] = []

        for raw_task in tasks:
            task_name = str(raw_task.get("task_name") or "").strip()
            cron_expression = str(raw_task.get("cron_expression") or "").strip()
            if not task_name or not cron_expression:
                continue

            dispatch_type = str(raw_task.get("dispatch_type") or "skill").strip().lower() or "skill"
            if not TaskService._is_skill_or_mcp_dispatch(dispatch_type):
                continue

            skill_id: int | None
            capability_id: int | None
            if TaskService._is_mcp_dispatch(dispatch_type):
                skill_id = None
                capability_id = TaskService._to_int(raw_task.get("capability_id"))
                if capability_id is None:
                    continue
            else:
                skill_id = TaskService._to_int(raw_task.get("skill_id"))
                capability_id = None

            signature = (task_name, dispatch_type, skill_id, capability_id)
            active_signatures.add(signature)

            existing = db.scalar(
                select(EmployeeTask).where(
                    EmployeeTask.workspace_id == workspace_id,
                    EmployeeTask.employee_id == employee_id,
                    EmployeeTask.task_name == task_name,
                    EmployeeTask.dispatch_type == dispatch_type,
                    EmployeeTask.skill_id == skill_id,
                    EmployeeTask.capability_id == capability_id,
                )
            )
            if existing:
                task = existing
            else:
                task = EmployeeTask(
                    workspace_id=workspace_id,
                    employee_id=employee_id,
                    task_name=task_name,
                    dispatch_type=dispatch_type,
                    skill_id=skill_id,
                    capability_id=capability_id,
                )
                db.add(task)

            task.employee_name_snapshot = employee_name
            task.priority = TaskService._to_int(raw_task.get("priority")) or 0
            task.task_type = TaskService._to_int(raw_task.get("task_type"))
            task.cron_expression = cron_expression
            task.cron_expression_type = str(raw_task.get("cron_expression_type") or "custom")
            if "is_active" in raw_task:
                task.is_active = TaskService._to_bool(
                    raw_task.get("is_active"),
                    default=task.is_active if existing else True,
                )
            elif not existing:
                task.is_active = True
            task.confirm_execution_result = TaskService._to_bool(
                raw_task.get("confirm_execution_result"), default=False
            )
            task_input = raw_task.get("config", {})
            if isinstance(task_input, dict):
                task_input = task_input.get("input", {})
            if not isinstance(task_input, dict):
                task_input = {}
            up = raw_task.get("user_prompt")
            if up is not None and str(up).strip():
                task_input["prompt"] = str(up).strip()
                task_input.setdefault("user_prompt", str(up).strip())
            task.task_input_json = json.dumps(task_input, ensure_ascii=False)
            stored_prompt = (
                str(up).strip()
                if up is not None and str(up).strip()
                else str(task_input.get("prompt") or "").strip()
            )
            task.user_prompt = stored_prompt or None
            task.next_run_at = TaskService.compute_next_run(task.cron_expression, now=now) if task.is_active else None
            task.updated_at = now
            upserted.append(task)

        existing_tasks = list(
            db.scalars(
                select(EmployeeTask).where(
                    EmployeeTask.workspace_id == workspace_id,
                    EmployeeTask.employee_id == employee_id,
                )
            ).all()
        )
        for task in existing_tasks:
            current_signature = (
                task.task_name,
                task.dispatch_type,
                task.skill_id,
                task.capability_id,
            )
            if current_signature in active_signatures:
                continue
            db.delete(task)

        db.commit()
        for task in upserted:
            db.refresh(task)
        return upserted

    @staticmethod
    def list_active_tasks(db: Session, workspace_id: int, employee_id: int | None = None) -> list[EmployeeTask]:
        stmt = select(EmployeeTask).where(
            EmployeeTask.workspace_id == workspace_id,
            EmployeeTask.is_active.is_(True),
            EmployeeTask.dispatch_type == "skill",
        )
        if employee_id is not None:
            stmt = stmt.where(EmployeeTask.employee_id == employee_id)
        stmt = stmt.order_by(EmployeeTask.priority.desc(), EmployeeTask.id.desc())
        return list(db.scalars(stmt).all())

    @staticmethod
    def build_daily_schedule(
        db: Session,
        workspace_id: int,
        employee_id: int,
        target_date: date,
    ) -> list[dict[str, Any]]:
        WorkspaceService.get_workspace(db, workspace_id)
        employee = db.get(Employee, employee_id)
        if not employee or employee.workspace_id != workspace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")

        tasks = TaskService.list_active_tasks(db, workspace_id=workspace_id, employee_id=employee_id)
        day_start = datetime.combine(target_date, time.min).replace(tzinfo=CST)
        day_end = day_start + timedelta(days=1)
        result: list[dict[str, Any]] = []
        for task in tasks:
            fire_times: list[str] = []
            try:
                trigger = TaskService._build_trigger(task.cron_expression)
                next_fire = trigger.get_next_fire_time(previous_fire_time=None, now=day_start - timedelta(seconds=1))
                while next_fire and next_fire < day_end:
                    if next_fire >= day_start:
                        fire_times.append(next_fire.strftime("%Y-%m-%d %H:%M:%S"))
                    next_fire = trigger.get_next_fire_time(previous_fire_time=next_fire, now=next_fire)
            except ValueError:
                fire_times = []
            result.append(
                {
                    "task_id": task.id,
                    "task_name": task.task_name,
                    "skill_id": task.skill_id,
                    "cron_expression": task.cron_expression,
                    "execution_points": fire_times,
                }
            )
        return result

    @staticmethod
    def list_today_tasks(db: Session, workspace_id: int) -> list[dict[str, Any]]:
        """返回今日所有任务的统一视图：已执行（from logs）+ 待执行（from employee_tasks）。

        已执行任务直接从 task_execution_logs 查询今天的记录，
        待执行任务从 employee_tasks 查今天 cron 会触发但还没有执行记录的任务；
        查询时排除 execute_mode 为 immediate 以及 cron_expression 为空（含纯空白）的任务。
        两部分按 task_id 去重合并。
        """
        now = cst_now()
        target_date = now.date()
        day_start = datetime.combine(target_date, time.min).replace(tzinfo=CST)
        day_end = day_start + timedelta(days=1)

        # === Part A: 已执行任务（直接查 logs 表）===
        logs = list(
            db.scalars(
                select(TaskExecutionLog).where(
                    TaskExecutionLog.workspace_id == workspace_id,
                    TaskExecutionLog.started_at >= day_start,
                    TaskExecutionLog.started_at < day_end,
                ).order_by(TaskExecutionLog.started_at.desc())
            ).all()
        )

        # === Part B 查询（任务列表）前置，仅用于汇总 employee_id 以便构建名映射 ===
        tasks = list(
            db.scalars(
                select(EmployeeTask).where(
                    EmployeeTask.workspace_id == workspace_id,
                    EmployeeTask.is_active.is_(True),
                    EmployeeTask.dispatch_type.in_(("skill", "mcp")),
                    EmployeeTask.execute_mode != "immediate",
                    and_(
                        EmployeeTask.cron_expression.isnot(None),
                        func.trim(EmployeeTask.cron_expression) != "",
                    ),
                ).order_by(EmployeeTask.priority.desc(), EmployeeTask.id.asc())
            ).all()
        )

        # 员工姓名按 logs/tasks 实际引用的 employee_id 解析（员工已是用户级，
        # cosmetic workspace_id stamp 可能 != workspace，不能按 workspace 过滤）
        referenced_ids = {
            log.employee_id for log in logs if log.employee_id is not None
        } | {t.employee_id for t in tasks if t.employee_id is not None}
        emp_name_map = {
            e.id: e.name
            for e in db.scalars(
                select(Employee).where(Employee.id.in_(referenced_ids))
            ).all()
        } if referenced_ids else {}

        executed_task_ids: set[int] = set()
        result: list[dict[str, Any]] = []
        seen_task_ids: set[int] = set()

        for log in logs:
            tid = log.task_id if log.task_id else 0
            if tid and tid in seen_task_ids:
                continue
            if tid:
                seen_task_ids.add(tid)
                executed_task_ids.add(tid)

            result.append({
                "task_id": tid,
                "task_name": log.task_name_snapshot or "",
                "employee_id": log.employee_id,
                "employee_name": emp_name_map.get(log.employee_id, ""),
                "cron_expression": None,
                "execute_mode": "scheduled",
                "planned_at": log.started_at.strftime("%Y-%m-%d %H:%M:%S") if log.started_at else None,
                "execution_id": log.id,
                "run_status": log.run_status,
                "run_result": log.run_result,
                "started_at": log.started_at.strftime("%Y-%m-%d %H:%M:%S") if log.started_at else None,
                "ended_at": log.ended_at.strftime("%Y-%m-%d %H:%M:%S") if log.ended_at else None,
                "duration_ms": log.duration_ms,
                "conversation_id": log.conversation_id,
            })

        # === Part B: 待执行任务（from employee_tasks，排除已有执行记录的）===
        for task in tasks:
            if task.id in executed_task_ids:
                continue

            fire_times: list[str] = []
            if task.cron_expression:
                try:
                    trigger = TaskService._build_trigger(task.cron_expression)
                    next_fire = trigger.get_next_fire_time(None, day_start - timedelta(seconds=1))
                    while next_fire and next_fire < day_end:
                        if next_fire >= day_start:
                            fire_times.append(next_fire.strftime("%Y-%m-%d %H:%M:%S"))
                        next_fire = trigger.get_next_fire_time(next_fire, next_fire)
                except ValueError:
                    pass

            if not fire_times:
                continue

            result.append({
                "task_id": task.id,
                "task_name": task.task_name,
                "employee_id": task.employee_id,
                "employee_name": emp_name_map.get(task.employee_id, task.employee_name_snapshot or ""),
                "cron_expression": task.cron_expression,
                "execute_mode": task.execute_mode,
                "planned_at": fire_times[0] if fire_times else None,
                "execution_id": None,
                "run_status": "pending",
                "run_result": None,
                "started_at": None,
                "ended_at": None,
                "duration_ms": None,
                "conversation_id": None,
            })

        # === Part C: 按 orchestration_plan_id 聚合编排计划子任务 ===
        from src.models.orchestration_plan import OrchestrationPlan
        from src.models.plan_run import PlanRun

        # 现 result 里既有"已执行"也有"待执行"。先按 task_id 找回 orchestration_plan_id。
        plan_id_by_task: dict[int, int] = {}
        all_task_ids = {r["task_id"] for r in result if r["task_id"]}
        if all_task_ids:
            rows = db.execute(
                select(EmployeeTask.id, EmployeeTask.orchestration_plan_id)
                .where(EmployeeTask.id.in_(all_task_ids), EmployeeTask.orchestration_plan_id.isnot(None))
            ).all()
            plan_id_by_task = {tid: pid for tid, pid in rows}

        # 把属于编排计划的行从 result 中抽出，按 plan_id 分组
        kept: list[dict] = []
        plan_buckets: dict[int, list[dict]] = {}
        plan_rows: list[dict] = []

        if plan_id_by_task:
            for r in result:
                pid = plan_id_by_task.get(r["task_id"])
                if pid is None:
                    kept.append(r)
                else:
                    plan_buckets.setdefault(pid, []).append(r)

            # 用 Part A 已加载的 logs 列表按 run_id 分组（含今天日期窗口），避免循环里 N+1。
            logs_by_run_id: dict[int, list[TaskExecutionLog]] = {}
            for _log in logs:
                if _log.run_id is not None:
                    logs_by_run_id.setdefault(_log.run_id, []).append(_log)

            for pid, sub_rows in plan_buckets.items():
                plan = db.get(OrchestrationPlan, pid)
                if plan is None:
                    # 防御：找不到 plan 时把原始子任务行放回 kept
                    kept.extend(sub_rows)
                    continue
                # 最新一轮 run
                latest_run = db.scalars(
                    select(PlanRun).where(PlanRun.plan_id == pid)
                    .order_by(PlanRun.run_seq.desc()).limit(1)
                ).first()
                # 本轮内的子任务执行日志（复用 Part A 已加载的 logs，按 run_id 分组）
                run_logs: list[TaskExecutionLog] = (
                    logs_by_run_id.get(latest_run.id, []) if latest_run is not None else []
                )
                # 与原 SQL 排序一致：按 started_at 升序
                run_logs = sorted(run_logs, key=lambda l: l.started_at or "")

                # 每个子任务取本轮**最新一条** log（按 id）作有效状态——处理返工：
                # 同一子任务 superseded(旧) + success(新) → 取 success，不被旧 log 拖成 pending。
                latest_log_by_task: dict[int, TaskExecutionLog] = {}
                for l in run_logs:
                    prev = latest_log_by_task.get(l.task_id)
                    if prev is None or (l.id or 0) > (prev.id or 0):
                        latest_log_by_task[l.task_id] = l

                # 聚合状态（按优先级）——只看每子任务的有效（最新）状态
                statuses = {l.run_status for l in latest_log_by_task.values() if l.run_status}
                if statuses & {"running", "queued"}:
                    agg_status = "running"
                elif statuses & {"failed", "error", "timeout"}:
                    agg_status = "failed"
                elif "cancelled" in statuses:
                    agg_status = "cancelled"
                elif "skipped" in statuses:
                    agg_status = "skipped"
                elif statuses and statuses <= {"success", "completed"}:
                    agg_status = "success"
                else:
                    agg_status = "pending"  # 本轮无日志 / 未跑

                started_iso = None
                if run_logs:
                    earliest = min((l.started_at for l in run_logs if l.started_at), default=None)
                    started_iso = earliest.strftime("%Y-%m-%d %H:%M:%S") if earliest else None
                duration_total = sum(
                    (l.duration_ms or 0) for l in run_logs if l.ended_at and l.duration_ms
                ) or None

                # planned_at：用 plan.next_run_at 兜底（行还没跑过时）
                planned_iso = None
                if started_iso is None and plan.next_run_at is not None:
                    planned_iso = plan.next_run_at.strftime("%Y-%m-%d %H:%M:%S")

                # 标题：user_input 截断 60 字
                summary = (plan.user_input or "").strip().replace("\n", " ")
                if len(summary) > 60:
                    summary = summary[:60] + "…"

                # 跳转会话：优先本轮专属会话（定时轮）；为空则回落 plan 创建源会话
                # （即时/manual 计划、老数据、还没跑过的计划都靠这个回落保证点击可跳）。
                row_conv_id = (
                    latest_run.conversation_id
                    if latest_run is not None and latest_run.conversation_id is not None
                    else plan.conversation_id
                )

                plan_rows.append({
                    "task_id": 0,
                    "task_name": summary or f"编排计划 #{pid}",
                    "employee_id": 0,
                    "employee_name": "编排计划",
                    "cron_expression": plan.cron,
                    "execute_mode": "scheduled" if plan.is_recurring else "immediate",
                    "planned_at": planned_iso or started_iso,
                    "execution_id": None,
                    "run_status": agg_status,
                    "run_result": None,
                    "started_at": started_iso,
                    "ended_at": None,
                    "duration_ms": duration_total,
                    "conversation_id": row_conv_id,
                    "is_plan": True,
                    "plan_id": pid,
                    "run_seq": latest_run.run_seq if latest_run else None,
                })
        else:
            kept = list(result)

        # === Part D: 确认态定时计划但今天还没产生任何行（未触发）→ 补一条 pending plan 行 ===
        represented_plan_ids = set(plan_buckets.keys())
        sched_plans = db.scalars(
            select(OrchestrationPlan).where(
                OrchestrationPlan.workspace_id == workspace_id,
                OrchestrationPlan.status == "confirmed",
                OrchestrationPlan.schedule_kind.isnot(None),
            )
        ).all()
        for p in sched_plans:
            if p.id in represented_plan_ids:
                continue
            # 下次触发时间：recurring 用 next_run_at（或现算）；once 用 run_at
            planned = None
            if p.schedule_kind == "recurring":
                planned = p.next_run_at or (
                    TaskService.compute_next_run(p.cron) if p.cron else None
                )
            elif p.schedule_kind == "once":
                planned = p.run_at
            planned_iso = planned.strftime("%Y-%m-%d %H:%M:%S") if planned else None
            summary = (p.user_input or "").strip().replace("\n", " ")
            if len(summary) > 60:
                summary = summary[:60] + "…"
            plan_rows.append({
                "task_id": 0,
                "task_name": summary or f"编排计划 #{p.id}",
                "employee_id": 0,
                "employee_name": "编排计划",
                "cron_expression": p.cron,
                "execute_mode": "scheduled",
                "planned_at": planned_iso,
                "execution_id": None,
                "run_status": "pending",
                "run_result": None,
                "started_at": None,
                "ended_at": None,
                "duration_ms": None,
                "conversation_id": p.conversation_id,
                "is_plan": True,
                "plan_id": p.id,
                "run_seq": None,
            })

        result = kept + plan_rows

        result.sort(key=lambda x: (
            0 if x["run_status"] == "running" else 1,
            x["started_at"] or x["planned_at"] or "",
        ), reverse=True)

        return result

    @staticmethod
    def _attach_skill_ratings_for_logs(db: Session, items: list[TaskExecutionLog]) -> None:
        """为执行日志列表挂载 skill_rating_summary（同页内按 log id 关联最新一条评分）。"""
        if not items:
            return
        log_ids = [i.id for i in items]
        ratings = list(
            db.scalars(
                select(SkillRating)
                .where(SkillRating.task_execution_log_id.in_(log_ids))
                .order_by(SkillRating.id.desc())
            ).all()
        )
        by_log: dict[int, SkillRating] = {}
        for r in ratings:
            lid = r.task_execution_log_id
            if lid is not None and lid not in by_log:
                by_log[lid] = r
        for item in items:
            setattr(item, "skill_rating_summary", by_log.get(item.id))

    @staticmethod
    def list_execution_logs(
        db: Session,
        workspace_id: int,
        employee_id: int | None = None,
        task_id: int | None = None,
        run_status: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        orchestrator_conversation_id: int | None = None,
        orchestration_plan_id: int | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TaskExecutionLog], int]:
        stmt = select(TaskExecutionLog).where(TaskExecutionLog.workspace_id == workspace_id)
        count_stmt = select(func.count()).select_from(TaskExecutionLog).where(TaskExecutionLog.workspace_id == workspace_id)

        if orchestrator_conversation_id is not None:
            from src.models.orchestration_plan import OrchestrationPlan

            orchestrated_task_ids = select(EmployeeTask.id).join(
                OrchestrationPlan,
                EmployeeTask.orchestration_plan_id == OrchestrationPlan.id,
            ).where(
                OrchestrationPlan.conversation_id == orchestrator_conversation_id,
                EmployeeTask.workspace_id == workspace_id,
            )
            orch_filter = or_(
                TaskExecutionLog.orchestrator_conversation_id
                == orchestrator_conversation_id,
                and_(
                    TaskExecutionLog.orchestrator_conversation_id.is_(None),
                    TaskExecutionLog.task_id.in_(orchestrated_task_ids),
                ),
            )
            stmt = stmt.where(orch_filter)
            count_stmt = count_stmt.where(orch_filter)

        if orchestration_plan_id is not None:
            plan_task_ids = select(EmployeeTask.id).where(
                EmployeeTask.orchestration_plan_id == orchestration_plan_id,
                EmployeeTask.workspace_id == workspace_id,
            )
            stmt = stmt.where(TaskExecutionLog.task_id.in_(plan_task_ids))
            count_stmt = count_stmt.where(TaskExecutionLog.task_id.in_(plan_task_ids))

        if employee_id is not None:
            stmt = stmt.where(TaskExecutionLog.employee_id == employee_id)
            count_stmt = count_stmt.where(TaskExecutionLog.employee_id == employee_id)
        if task_id is not None:
            stmt = stmt.where(TaskExecutionLog.task_id == task_id)
            count_stmt = count_stmt.where(TaskExecutionLog.task_id == task_id)
        if run_status:
            stmt = stmt.where(TaskExecutionLog.run_status == run_status)
            count_stmt = count_stmt.where(TaskExecutionLog.run_status == run_status)
        if start_time is not None:
            stmt = stmt.where(TaskExecutionLog.started_at >= start_time)
            count_stmt = count_stmt.where(TaskExecutionLog.started_at >= start_time)
        if end_time is not None:
            stmt = stmt.where(TaskExecutionLog.started_at <= end_time)
            count_stmt = count_stmt.where(TaskExecutionLog.started_at <= end_time)

        total = db.scalar(count_stmt) or 0
        items = list(
            db.scalars(
                stmt.order_by(TaskExecutionLog.started_at.desc(), TaskExecutionLog.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
        )
        # 按 items 中实际出现的 employee_id 解析员工姓名（员工已是用户级，
        # cosmetic workspace_id stamp 可能 != 日志 workspace，不能按 workspace 过滤）
        emp_ids = {item.employee_id for item in items if item.employee_id is not None}
        employee_name_map = {
            e.id: e.name
            for e in db.scalars(select(Employee).where(Employee.id.in_(emp_ids))).all()
        } if emp_ids else {}
        # 给items加上员工姓名字段
        for item in items:
            item.employee_name = employee_name_map.get(item.employee_id, "")
        task_ids = [item.task_id for item in items if getattr(item, "task_id", None) is not None]
        task_confirm_map: dict[int, bool] = {}
        task_dispatch_map: dict[int, str] = {}
        task_rework_map: dict[int, int] = {}
        if task_ids:
            task_rows = list(
                db.execute(
                    select(
                        EmployeeTask.id,
                        EmployeeTask.confirm_execution_result,
                        EmployeeTask.dispatch_type,
                        EmployeeTask.rework_count,
                    ).where(EmployeeTask.id.in_(task_ids))
                ).all()
            )
            task_confirm_map = {int(r[0]): bool(r[1]) for r in task_rows}
            task_dispatch_map = {int(r[0]): str(r[2]) for r in task_rows}
            task_rework_map = {int(r[0]): int(r[3]) for r in task_rows}
        for item in items:
            item.confirm_execution_result = task_confirm_map.get(item.task_id)
            item.dispatch_type = task_dispatch_map.get(item.task_id)
            item.rework_count = task_rework_map.get(item.task_id, 0)

        TaskService._attach_skill_ratings_for_logs(db, items)

        return items, total

    @staticmethod
    def latest_execution_logs_by_task_ids(
        db: Session,
        task_ids: list[int],
    ) -> dict[int, TaskExecutionLog]:
        """每个 task_id 对应最新一条 execution log（批量查询，避免循环 LIMIT 1）。"""
        if not task_ids:
            return {}

        max_log_ids = list(
            db.scalars(
                select(func.max(TaskExecutionLog.id))
                .where(TaskExecutionLog.task_id.in_(task_ids))
                .group_by(TaskExecutionLog.task_id)
            ).all()
        )
        if not max_log_ids:
            return {}

        logs = list(
            db.scalars(
                select(TaskExecutionLog).where(TaskExecutionLog.id.in_(max_log_ids))
            ).all()
        )
        return {
            log.task_id: log
            for log in logs
            if log.task_id is not None
        }

    @staticmethod
    def confirm_task_execution_log(
        db: Session,
        workspace_id: int,
        execution_log_id: int,
    ) -> TaskExecutionLog:
        """将指定执行日志标记为已确认结果。"""
        WorkspaceService.get_workspace(db, workspace_id)
        log = db.get(TaskExecutionLog, execution_log_id)
        if not log or log.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到任务执行日志。",
            )
        log.result_confirmed = True
        db.add(log)
        db.commit()
        db.refresh(log)
        _emp = db.get(Employee, log.employee_id)
        log.employee_name = _emp.name if _emp is not None else ""
        task = db.get(EmployeeTask, log.task_id)
        log.confirm_execution_result = (
            bool(task.confirm_execution_result) if task is not None else None
        )
        log.dispatch_type = task.dispatch_type if task is not None else None
        TaskService._attach_skill_ratings_for_logs(db, [log])
        return log

    @staticmethod
    def mark_task_execution_log_read(
        db: Session,
        workspace_id: int,
        execution_log_id: int,
    ) -> TaskExecutionLog:
        """将指定执行日志标记为已读。"""
        WorkspaceService.get_workspace(db, workspace_id)
        log = db.get(TaskExecutionLog, execution_log_id)
        if not log or log.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到任务执行日志。",
            )
        log.is_read = True
        db.add(log)
        db.commit()
        db.refresh(log)
        _emp = db.get(Employee, log.employee_id)
        log.employee_name = _emp.name if _emp is not None else ""
        task = db.get(EmployeeTask, log.task_id)
        log.confirm_execution_result = (
            bool(task.confirm_execution_result) if task is not None else None
        )
        log.dispatch_type = task.dispatch_type if task is not None else None
        TaskService._attach_skill_ratings_for_logs(db, [log])
        return log

    @staticmethod
    def cancel_task_execution_log(
        db: Session,
        workspace_id: int,
        execution_log_id: int,
        *,
        reason: str = "已由总管中止",
    ) -> TaskExecutionLog:
        """中止指定执行日志:终止其会话流并标记为 cancelled(已终态则原样返回,幂等)。"""
        WorkspaceService.get_workspace(db, workspace_id)
        log = db.get(TaskExecutionLog, execution_log_id)
        if not log or log.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到任务执行日志。",
            )

        # 仅对仍在进行(running/queued/pending)的执行做中止;已终态幂等返回。
        if log.run_status in ("running", "queued", "pending"):
            from src.service.chat_service import ChatService

            if log.conversation_id:
                ChatService.cancel_conversation_stream(log.conversation_id)
            now = cst_now()
            log.run_status = "cancelled"
            log.run_result = reason
            log.ended_at = now
            if log.started_at:
                log.duration_ms = int(
                    (
                        now.replace(tzinfo=None)
                        - log.started_at.replace(tzinfo=None)
                    ).total_seconds()
                    * 1000
                )
            db.add(log)
            db.commit()
            db.refresh(log)

        _emp = db.get(Employee, log.employee_id)
        log.employee_name = _emp.name if _emp is not None else ""
        task = db.get(EmployeeTask, log.task_id)
        log.confirm_execution_result = (
            bool(task.confirm_execution_result) if task is not None else None
        )
        log.dispatch_type = task.dispatch_type if task is not None else None
        TaskService._attach_skill_ratings_for_logs(db, [log])
        return log

    @staticmethod
    def delete_all_execution_logs(
        db: Session,
        workspace_id: int,
        *,
        orchestrator_conversation_id: int | None = None,
    ) -> int:
        """删除任务执行日志。未传 orchestrator_conversation_id 时删除整个工作空间。"""
        stmt = db.query(TaskExecutionLog).filter(
            TaskExecutionLog.workspace_id == workspace_id
        )
        if orchestrator_conversation_id is not None:
            stmt = stmt.filter(
                TaskExecutionLog.orchestrator_conversation_id
                == orchestrator_conversation_id
            )
        count = stmt.delete()
        db.commit()
        return count

    @staticmethod
    def build_monthly_calendar(
        db: Session,
        user_id: str | None = None,
        year: int | None = None,
        month: int | None = None,
        employee_id: int | None = None,
    ) -> dict[str, Any]:
        now = cst_now()
        target_year = year or now.year
        target_month = month or now.month
        if target_month < 1 or target_month > 12:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month 必须在 1 到 12 之间。")

        total_days = monthrange(target_year, target_month)[1]
        start_of_month = date(target_year, target_month, 1)
        end_of_month = date(target_year, target_month, total_days)

        employee_stmt = select(Employee).where(Employee.user_id == user_id)
        if employee_id is not None:
            employee_stmt = employee_stmt.where(Employee.id == employee_id)
        employees = list(db.scalars(employee_stmt.order_by(Employee.id.asc())).all())
        if employee_id is not None and not employees:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")

        employee_ids = [emp.id for emp in employees]
        tasks_by_employee: dict[int, list[EmployeeTask]] = {emp_id: [] for emp_id in employee_ids}
        if employee_ids:
            task_stmt = select(EmployeeTask).where(
                EmployeeTask.employee_id.in_(employee_ids),
                EmployeeTask.is_active.is_(True),
                EmployeeTask.dispatch_type == "skill",
            ).order_by(EmployeeTask.priority.desc(), EmployeeTask.id.desc())
            for task in list(db.scalars(task_stmt).all()):
                tasks_by_employee.setdefault(task.employee_id, []).append(task)

        days: dict[str, Any] = {}
        for day_num in range(1, total_days + 1):
            day_date = date(target_year, target_month, day_num)
            day_key = day_date.strftime("%Y-%m-%d")
            day_employees: list[dict[str, Any]] = []

            for employee in employees:
                shift_id, shift_name, shift_schedule = TaskService._extract_shift_info(employee)
                schedule_start = shift_schedule.get("start_date")
                schedule_end = shift_schedule.get("end_date")
                in_shift = True
                try:
                    if schedule_start:
                        in_shift = day_date >= datetime.strptime(str(schedule_start), "%Y-%m-%d").date()
                    if in_shift and schedule_end:
                        in_shift = day_date <= datetime.strptime(str(schedule_end), "%Y-%m-%d").date()
                except ValueError:
                    in_shift = True

                employee_tasks = tasks_by_employee.get(employee.id, [])
                if not in_shift and not employee_tasks:
                    continue
                if not in_shift:
                    continue

                tasks_payload = [
                    {
                        "is_active": task.is_active,
                        "task_type": task.task_type,
                        "task_id": task.id,
                        "task_name": task.task_name,
                        "employee_id": employee.id,
                        "employee_name": employee.name,
                        "cron_expression": task.cron_expression,
                        "cron_description": TaskService._describe_cron(task.cron_expression),
                        "cron_expression_type": task.cron_expression_type,
                    }
                    for task in employee_tasks
                ]
                if not tasks_payload and not shift_schedule:
                    continue

                day_employees.append(
                    {
                        "employee_id": employee.id,
                        "employee_name": employee.name,
                        "tasks": tasks_payload,
                        "shift_id": shift_id,
                        "shift_name": shift_name,
                        "shift_schedule": shift_schedule,
                    }
                )

            days[day_key] = {"day": day_num, "date": day_key, "employees": day_employees}

        return {"year": target_year, "month": target_month, "days": days}

    @staticmethod
    def get_execution_metrics(
        db: Session,
        workspace_id: int,
        employee_id: int,
        days: int = 7,
    ) -> dict[str, Any]:
        """近 N 日执行指标：基于 task_execution_logs 聚合，无新表。"""
        if days < 1 or days > 90:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="days 必须在 1 到 90 之间。",
            )

        WorkspaceService.get_workspace(db, workspace_id)
        employee = db.get(Employee, employee_id)
        if not employee or employee.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到员工。",
            )

        end_at = cst_now()
        start_at = end_at - timedelta(days=days)

        rows = db.execute(
            select(TaskExecutionLog.run_status, func.count())
            .where(
                TaskExecutionLog.workspace_id == workspace_id,
                TaskExecutionLog.employee_id == employee_id,
                TaskExecutionLog.started_at >= start_at,
                TaskExecutionLog.started_at <= end_at,
            )
            .group_by(TaskExecutionLog.run_status)
        ).all()

        counts = {str(status): int(count) for status, count in rows}
        success = counts.get("success", 0)
        failed = counts.get("failed", 0)
        timeout = counts.get("timeout", 0)
        cancelled = counts.get("cancelled", 0)
        total_finished = success + failed + timeout + cancelled
        failure_count = failed + timeout
        failure_rate: float | None = None
        if total_finished > 0:
            failure_rate = round(failure_count / total_finished * 100, 1)

        return {
            "days": days,
            "start_at": start_at,
            "end_at": end_at,
            "total_finished": total_finished,
            "success": success,
            "failed": failed,
            "timeout": timeout,
            "cancelled": cancelled,
            "failure_count": failure_count,
            "failure_rate": failure_rate,
        }

    @staticmethod
    def get_conversation_tool_parts(db: Session, conversation_id: int | None) -> list[dict[str, Any]]:
        """取某会话 assistant 消息 message_parts 里 type 以 'tool-' 开头的 part(按消息顺序)。"""
        from src.models.conversation import ConversationMessage

        if conversation_id is None:
            return []
        msgs = list(
            db.scalars(
                select(ConversationMessage)
                .where(
                    ConversationMessage.conversation_id == conversation_id,
                    ConversationMessage.role == "assistant",
                )
                .order_by(ConversationMessage.id.asc())
            ).all()
        )
        out: list[dict[str, Any]] = []
        for m in msgs:
            if not m.message_parts:
                continue
            try:
                parts = json.loads(m.message_parts)
            except (ValueError, TypeError):
                continue
            if not isinstance(parts, list):
                continue
            for p in parts:
                if (
                    isinstance(p, dict)
                    and isinstance(p.get("type"), str)
                    and p["type"].startswith("tool-")
                ):
                    out.append(p)
        return out

    @staticmethod
    def get_execution_tool_footprint(
        db: Session, workspace_id: int, execution_log_id: int
    ) -> list[dict[str, Any]]:
        """据执行日志取其会话级工具足迹(校验 workspace,404 若不存在/跨 workspace)。"""
        WorkspaceService.get_workspace(db, workspace_id)
        log = db.get(TaskExecutionLog, execution_log_id)
        if not log or log.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="未找到任务执行日志。"
            )
        return TaskService.get_conversation_tool_parts(db, log.conversation_id)

