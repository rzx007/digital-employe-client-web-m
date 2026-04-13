from __future__ import annotations

import json
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from typing import Any

from apscheduler.triggers.cron import CronTrigger  # pylint: disable=import-error
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import CST, cst_now
from src.service.workspace_service import WorkspaceService


class TaskService:
    @staticmethod
    def _is_skill_dispatch(dispatch_type: str | None) -> bool:
        return (dispatch_type or "skill").strip().lower() == "skill"

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
    def _extract_tasks_from_employee(employee: Employee) -> list[dict[str, Any]]:
        meta = TaskService._loads_json(employee.meta_json, {})
        tasks = meta.get("tasks")
        if isinstance(tasks, list):
            return [item for item in tasks if isinstance(item, dict)]
        return []

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
    def sync_workspace_tasks(db: Session, workspace_id: int) -> list[EmployeeTask]:
        WorkspaceService.get_workspace(db, workspace_id)
        employees = list(
            db.scalars(
                select(Employee)
                .where(Employee.workspace_id == workspace_id)
                .order_by(Employee.id.asc())
            ).all()
        )
        upserted: list[EmployeeTask] = []
        now = cst_now()

        for employee in employees:
            # mcp/非skill任务不保留在任务表中，避免被误查询或误执行。
            stale_non_skill_tasks = list(
                db.scalars(
                    select(EmployeeTask).where(
                        EmployeeTask.workspace_id == workspace_id,
                        EmployeeTask.employee_id == employee.id,
                        EmployeeTask.dispatch_type != "skill",
                    )
                ).all()
            )
            for stale_task in stale_non_skill_tasks:
                db.delete(stale_task)

            tasks = TaskService._extract_tasks_from_employee(employee)
            active_signatures: set[tuple[str, str, int | None, int | None]] = set()
            for raw_task in tasks:
                task_name = str(raw_task.get("task_name") or "").strip()
                cron_expression = str(raw_task.get("cron_expression") or "").strip()
                if not task_name or not cron_expression:
                    continue

                dispatch_type = str(raw_task.get("dispatch_type") or "skill").strip() or "skill"
                if not TaskService._is_skill_dispatch(dispatch_type):
                    continue
                skill_id = TaskService._to_int(raw_task.get("skill_id"))
                signature = (task_name, dispatch_type, skill_id)
                active_signatures.add(signature)

                existing = db.scalar(
                    select(EmployeeTask).where(
                        EmployeeTask.workspace_id == workspace_id,
                        EmployeeTask.employee_id == employee.id,
                        EmployeeTask.task_name == task_name,
                        EmployeeTask.dispatch_type == dispatch_type,
                        EmployeeTask.skill_id == skill_id,
                    )
                )
                if existing:
                    task = existing
                else:
                    task = EmployeeTask(
                        workspace_id=workspace_id,
                        employee_id=employee.id,
                        task_name=task_name,
                        dispatch_type=dispatch_type,
                        skill_id=skill_id,
                    )
                    db.add(task)

                task.employee_name_snapshot = employee.name
                task.priority = TaskService._to_int(raw_task.get("priority")) or 0
                task.task_type = TaskService._to_int(raw_task.get("task_type"))
                task.cron_expression = cron_expression
                task.cron_expression_type = str(raw_task.get("cron_expression_type") or "custom")
                task.is_active = TaskService._to_bool(raw_task.get("is_active"), default=True)
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
                        EmployeeTask.employee_id == employee.id,
                    )
                ).all()
            )
            for task in existing_tasks:
                current_signature = (task.task_name, task.dispatch_type, task.skill_id)
                if current_signature in active_signatures and TaskService._is_skill_dispatch(task.dispatch_type):
                    continue
                if not TaskService._is_skill_dispatch(task.dispatch_type):
                    db.delete(task)
                    continue
                task.is_active = False
                task.next_run_at = None
                task.updated_at = now

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
    def list_execution_logs(
        db: Session,
        workspace_id: int,
        employee_id: int | None = None,
        task_id: int | None = None,
        run_status: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TaskExecutionLog], int]:
        stmt = select(TaskExecutionLog).where(TaskExecutionLog.workspace_id == workspace_id)
        count_stmt = select(func.count()).select_from(TaskExecutionLog).where(TaskExecutionLog.workspace_id == workspace_id)

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
        # 查询所有的员工
        employees = list(db.scalars(select(Employee).where(Employee.workspace_id == workspace_id).order_by(Employee.id.asc())).all())
        # 根据员工的ID和name生成k-v
        employee_name_map = {emp.id: emp.name for emp in employees}
        # 给items加上员工姓名字段
        for item in items:
            item.employee_name = employee_name_map.get(item.employee_id, "")

        return items, total

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
        employees = list(
            db.scalars(
                select(Employee).where(Employee.workspace_id == workspace_id).order_by(Employee.id.asc())
            ).all()
        )
        employee_name_map = {emp.id: emp.name for emp in employees}
        log.employee_name = employee_name_map.get(log.employee_id, "")
        return log

    @staticmethod
    def build_monthly_calendar(
        db: Session,
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

        employee_stmt = select(Employee)
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

