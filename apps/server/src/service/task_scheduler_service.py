from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler  # pylint: disable=import-error
from apscheduler.triggers.cron import CronTrigger  # pylint: disable=import-error
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.db.session import get_session_local
from src.models.employee import Employee
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import CST, Workspace, cst_now
from src.service.task_service import TaskService
from src.service.agent import get_agent

logger = logging.getLogger(__name__)


class TaskSchedulerService:
    _scheduler: BackgroundScheduler | None = None
    _job_prefix = "employee_task:"

    @classmethod
    def _get_scheduler(cls) -> BackgroundScheduler:
        if cls._scheduler is None:
            cls._scheduler = BackgroundScheduler(timezone=CST)
        return cls._scheduler

    @classmethod
    def start(cls) -> None:
        scheduler = cls._get_scheduler()
        if not scheduler.running:
            scheduler.start()
        cls.reload_jobs()

    @classmethod
    def shutdown(cls) -> None:
        if cls._scheduler and cls._scheduler.running:
            cls._scheduler.shutdown(wait=False)

    @classmethod
    def reload_jobs(cls) -> None:
        scheduler = cls._get_scheduler()
        if not scheduler.running:
            return

        for job in scheduler.get_jobs():
            if job.id.startswith(cls._job_prefix):
                scheduler.remove_job(job.id)

        with get_session_local()() as db:
            tasks = list(
                db.scalars(
                    select(EmployeeTask).where(
                        EmployeeTask.is_active.is_(True),
                        EmployeeTask.dispatch_type == "skill",
                    ).order_by(
                        EmployeeTask.priority.desc(),
                        EmployeeTask.id.desc(),
                    )
                ).all()
            )
            for task in tasks:
                try:
                    trigger = CronTrigger.from_crontab(task.cron_expression, timezone=CST)
                except ValueError as exc:
                    logger.warning("跳过非法 cron 任务 task_id=%s cron=%s err=%s", task.id, task.cron_expression, exc)
                    continue

                job_id = f"{cls._job_prefix}{task.id}"
                scheduler.add_job(
                    cls.run_task_job,
                    trigger=trigger,
                    id=job_id,
                    args=[task.id],
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                    misfire_grace_time=120,
                )
                job = scheduler.get_job(job_id)
                task.next_run_at = job.next_run_time if job else TaskService.compute_next_run(task.cron_expression)
                db.add(task)
            db.commit()

    @staticmethod
    def _resolve_skills_dir(skills_payload: str | list | dict | None) -> str:
        if not skills_payload:
            return ""

        data: Any = skills_payload
        if isinstance(skills_payload, str):
            try:
                data = json.loads(skills_payload)
            except json.JSONDecodeError:
                return skills_payload

        if isinstance(data, dict):
            path = data.get("skills_dir") or data.get("stored_path") or data.get("path")
            return str(path or "")
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, str):
                return first
            if isinstance(first, dict):
                path = first.get("skills_dir") or first.get("stored_path") or first.get("path")
                return str(path or "")
        return ""

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
    def _to_json_string(payload: Any) -> str:
        try:
            return json.dumps(payload, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return json.dumps({"raw": str(payload)}, ensure_ascii=False)

    @staticmethod
    def _resolve_skill_name(employee: Employee, skill_id: int | None) -> str:
        if skill_id is None:
            return ""
        meta = TaskSchedulerService._loads_json(employee.meta_json, {})
        skills = meta.get("skills")
        if not isinstance(skills, list):
            return ""
        for skill in skills:
            if not isinstance(skill, dict):
                continue
            if TaskSchedulerService._to_int(skill.get("id")) == skill_id:
                return str(skill.get("skillName") or skill.get("name") or "")
        return ""

    @classmethod
    def _execute_task_call(cls, db: Session, task: EmployeeTask) -> dict[str, Any]:
        employee = db.get(Employee, task.employee_id)
        workspace = db.get(Workspace, task.workspace_id)
        if not employee or not workspace:
            raise ValueError("任务关联员工或工作空间不存在。")

        input_payload = TaskSchedulerService._loads_json(task.task_input_json, {})
        prompt = str(input_payload.get("prompt") or f"执行任务：{task.task_name}")
        scene = str(input_payload.get("scene") or "")
        skill_name = cls._resolve_skill_name(employee, task.skill_id)
        question = prompt
        if skill_name:
            question = f"请使用{skill_name}技能完成以下任务：{prompt}"

        skills_dir = cls._resolve_skills_dir(employee.skills_json)
        if skills_dir:
            skills_dir = str(Path(skills_dir))



        agent = get_agent(skills_dir, workspace.root_path)
        thread_id = f"task-{task.id}-{int(datetime.now().timestamp())}"
        response = agent.invoke(
            {"messages": [{"role": "user", "content": question}]},
            config={"configurable": {"thread_id": thread_id}},
        )
        return {
            "scene": scene,
            "prompt": prompt,
            "skill_name": skill_name,
            "response": response,
        }

    @classmethod
    def run_task_job(cls, task_id: int) -> None:
        with get_session_local()() as db:
            task = db.get(EmployeeTask, task_id)
            if not task or not task.is_active or task.dispatch_type != "skill":
                return

            started_at = cst_now()
            run_log = TaskExecutionLog(
                task_id=task.id,
                workspace_id=task.workspace_id,
                employee_id=task.employee_id,
                skill_id=task.skill_id,
                task_name_snapshot=task.task_name,
                run_status="running",
                run_result="执行中",
                input_json=task.task_input_json or "{}",
                output_json="{}",
                started_at=started_at,
            )
            db.add(run_log)
            db.commit()
            db.refresh(run_log)

            try:
                output = cls._execute_task_call(db, task)
                run_log.run_status = "success"
                run_log.run_result = "任务执行成功"
                run_log.output_json = cls._to_json_string(output)
                run_log.error_message = None
            except Exception as exc:  # pylint: disable=broad-exception-caught
                logger.exception("定时任务执行失败 task_id=%s", task_id)
                run_log.run_status = "failed"
                run_log.run_result = "任务执行成功"
                run_log.error_message = str(exc)

            ended_at = cst_now()
            run_log.ended_at = ended_at
            run_log.duration_ms = int((ended_at - started_at).total_seconds() * 1000)
            task.last_run_at = ended_at
            task.next_run_at = TaskService.compute_next_run(task.cron_expression, now=ended_at)
            db.add(task)
            db.add(run_log)
            db.commit()

