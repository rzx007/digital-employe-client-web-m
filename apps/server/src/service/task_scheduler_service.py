from __future__ import annotations

import json
import logging
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from apscheduler.schedulers.background import BackgroundScheduler  # pylint: disable=import-error
from apscheduler.triggers.cron import CronTrigger  # pylint: disable=import-error
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.db.session import get_session_local
from src.models.employee import Employee
from src.models.employee_mcp import EmployeeMcp
from src.models.employee_skill import EmployeeSkill
from src.models.employee_task import EmployeeTask
from src.models.task_execution_log import TaskExecutionLog
from src.models.workspace import CST, Workspace, cst_now
from src.service.task_service import TaskService
from src.service.agent import get_agent
from src.service.skill_confirm_url import load_confirm_url_for_skill

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
                        EmployeeTask.dispatch_type.in_(("skill", "mcp")),
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
    def _stringify_lc_message_content(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict):
                    if block.get("type") == "text" and "text" in block:
                        parts.append(str(block.get("text", "")))
                    elif "text" in block:
                        parts.append(str(block["text"]))
            return "".join(parts)
        return str(content)

    @staticmethod
    def _extract_final_agent_text(invoke_result: Any) -> str:
        """从 agent.invoke 的返回状态中提取最后一条 AI 可见文本（用于定时任务 output_json）。"""
        if invoke_result is None:
            return ""
        if isinstance(invoke_result, str):
            return invoke_result.strip()

        messages = None
        if isinstance(invoke_result, dict):
            messages = invoke_result.get("messages")
        if messages is None:
            messages = getattr(invoke_result, "messages", None)
        if not isinstance(messages, (list, tuple)) or not messages:
            return ""

        try:
            from langchain_core.messages import AIMessage as _AIMessage
        except ImportError:
            _AIMessage = None

        for msg in reversed(messages):
            if _AIMessage is not None and isinstance(msg, _AIMessage):
                return TaskSchedulerService._stringify_lc_message_content(
                    msg.content
                ).strip()
            if type(msg).__name__ == "AIMessage":
                return TaskSchedulerService._stringify_lc_message_content(
                    getattr(msg, "content", "")
                ).strip()
            if isinstance(msg, dict):
                t = msg.get("type")
                if t in ("ai", "assistant"):
                    return TaskSchedulerService._stringify_lc_message_content(
                        msg.get("content")
                    ).strip()

        last = messages[-1]
        if isinstance(last, dict):
            return TaskSchedulerService._stringify_lc_message_content(
                last.get("content")
            ).strip()
        return TaskSchedulerService._stringify_lc_message_content(
            getattr(last, "content", "")
        ).strip()

    @staticmethod
    def _resolve_skill_name(db: Session, employee: Employee, skill_id: int | None) -> str:
        if skill_id is None:
            return ""
        skill_name = db.scalar(
            select(EmployeeSkill.skill_name).where(
                EmployeeSkill.employee_id == employee.id,
                EmployeeSkill.skill_id == skill_id,
            ).limit(1)
        )
        if skill_name:
            return str(skill_name)
        # 兜底：历史数据可能缺少 employee_id 维度时，按 workspace + skill_id 查一次
        fallback_name = db.scalar(
            select(EmployeeSkill.skill_name).where(
                EmployeeSkill.workspace_id == employee.workspace_id,
                EmployeeSkill.skill_id == skill_id,
            ).order_by(EmployeeSkill.id.desc()).limit(1)
        )
        return str(fallback_name or "")

    @staticmethod
    def _first_tool_name_from_mcp_server_list_json(raw: str | None) -> str:
        if not raw or not str(raw).strip():
            return ""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return ""
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                return str(
                    first.get("toolName")
                    or first.get("name")
                    or first.get("tool_name")
                    or ""
                ).strip()
        if isinstance(data, dict):
            tools = data.get("tools") or data.get("toolList") or data.get("servers")
            if isinstance(tools, list) and tools:
                t0 = tools[0]
                if isinstance(t0, dict):
                    return str(
                        t0.get("toolName")
                        or t0.get("name")
                        or t0.get("tool_name")
                        or ""
                    ).strip()
        return ""

    @classmethod
    def _execute_mcp_tool_call(cls, db: Session, task: EmployeeTask) -> dict[str, Any]:
        settings = get_settings()
        base = (settings.mcp_base_url or "").strip().rstrip("/")
        if not base:
            raise ValueError("未配置 MCP_BASE_URL。")
        if task.capability_id is None:
            raise ValueError("MCP 任务缺少 capability_id。")

        em = db.scalar(
            select(EmployeeMcp).where(
                EmployeeMcp.employee_id == task.employee_id,
                EmployeeMcp.mcp_id == task.capability_id,
            )
        )
        if not em:
            raise ValueError(
                f"未找到员工绑定的 MCP：employee_id={task.employee_id} mcp_id={task.capability_id}"
            )

        server_name = (em.server_name or "").strip()
        if not server_name:
            raise ValueError("MCP 记录缺少 server_name。")

        input_payload = TaskSchedulerService._loads_json(task.task_input_json, {})
        tool_name = str(input_payload.get("mcp_tool_name") or "").strip()
        if not tool_name:
            tool_name = TaskSchedulerService._first_tool_name_from_mcp_server_list_json(
                em.aios_mcp_info_server_list_json
            )
        if not tool_name:
            raise ValueError(
                "无法解析 MCP toolName，请在任务输入中配置 mcp_tool_name。"
            )

        args = input_payload.get("arguments")
        if args is None:
            args = input_payload.get("mcp_arguments")
        if not isinstance(args, dict):
            args = {}

        timeout_sec = 600
        raw_to = input_payload.get("timeout")
        if isinstance(raw_to, int) and raw_to > 0:
            timeout_sec = raw_to
        elif isinstance(raw_to, str) and raw_to.isdigit():
            timeout_sec = int(raw_to)

        parsed_url = urllib.parse.urlparse(
            base if "://" in base else f"http://{base}"
        )
        host_header = parsed_url.netloc

        url = f"{base}/tool/call"
        payload = {
            "serverName": server_name,
            "toolName": tool_name,
            "arguments": args,
            "timeout": timeout_sec,
        }

        with httpx.Client(timeout=httpx.Timeout(timeout_sec + 60.0)) as client:
            response = client.post(
                url,
                headers={
                    "Accept": "*/*",
                    "Host": host_header,
                    "Connection": "keep-alive",
                },
                json=payload,
            )

        return {
            "response": response,
            "server_name": server_name,
            "tool_name": tool_name,
        }

    @classmethod
    def _invoke_sql_agent_update_confirm_url(
        cls,
        *,
        run_log_id: int,
        confirm_url: str,
        skills_dir: str,
        workspace_root: str,
    ) -> None:
        """通过挂载了 LangChain SQLDatabaseToolkit 的 Agent 更新 task_execution_logs.confirm_url。"""
        safe_url = confirm_url.replace("'", "''")
        skills_arg = str(Path(skills_dir).resolve()) if skills_dir.strip() else ""
        agent = get_agent(
            skills_arg,
            workspace_root or "",
            include_sqlite_tools=True,
        )
        thread_id = f"task-confirm-sql-{run_log_id}-{int(datetime.now().timestamp())}"
        prompt = (
            "你是一个只操作本应用 SQLite 数据库的助手。请使用提供的 SQL 相关工具执行更新，"
            "不要做与本次更新无关的大规模全表扫描。"
            f"将表 `task_execution_logs` 中主键 `id = {run_log_id}` 的行的字段 `confirm_url` "
            f"设置为（整段字符串作为列值）：{confirm_url!r}  "
            "等价 SQL 示例（请用工具执行语义一致的 UPDATE，注意字符串转义）："
            f"UPDATE task_execution_logs SET confirm_url = '{safe_url}' WHERE id = {run_log_id};"
            "执行完成后用一句话说明是否已更新。"
        )
        agent.invoke(
            {"messages": [{"role": "user", "content": prompt}]},
            config={"configurable": {"thread_id": thread_id}},
        )

    @classmethod
    def _maybe_write_confirm_url(
        cls,
        db: Session,
        *,
        run_log: TaskExecutionLog,
        task: EmployeeTask,
        employee: Employee | None,
        workspace: Workspace | None,
    ) -> None:
        if not employee or not workspace:
            return
        # 如果该任务不需要确认，则直接跳过
        if not getattr(task, "confirm_execution_result", False):
            return
        if task.skill_id is None:
            return
        skill_name = cls._resolve_skill_name(db, employee, task.skill_id)
        skills_dir = cls._resolve_skills_dir(employee.skills_json)
        if not skill_name or not skills_dir.strip():
            return
        resolved_dir = str(Path(skills_dir).resolve())
        confirm_url = load_confirm_url_for_skill(resolved_dir, skill_name)
        print(f"confirm_url: {confirm_url}")
        logger.warning("confirm_url: %s", confirm_url)
        if not confirm_url:
            logger.warning(
                "任务要求确认执行结果但未在 SKILL.md 中解析到 confirm_url，"
                "task_id=%s skill=%s",
                task.id,
                skill_name,
            )
            return
        try:
            cls._invoke_sql_agent_update_confirm_url(
                run_log_id=run_log.id,
                confirm_url=confirm_url,
                skills_dir=resolved_dir,
                workspace_root=str(workspace.root_path or ""),
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            logger.warning(
                "Agent SQL 工具写入 confirm_url 失败 run_log_id=%s: %s",
                run_log.id,
                exc,
                exc_info=True,
            )
        db.refresh(run_log)
        if run_log.confirm_url:
            return
        try:
            db.execute(
                text(
                    "UPDATE task_execution_logs SET confirm_url = :u WHERE id = :i"
                ),
                {"u": confirm_url, "i": run_log.id},
            )
            run_log.confirm_url = confirm_url
        except Exception as exc:  # pylint: disable=broad-exception-caught
            logger.warning(
                "confirm_url 直连回写失败 run_log_id=%s: %s",
                run_log.id,
                exc,
                exc_info=True,
            )

    @classmethod
    def _execute_task_call(cls, db: Session, task: EmployeeTask) -> dict[str, Any]:
        employee = db.get(Employee, task.employee_id)
        workspace = db.get(Workspace, task.workspace_id)
        if not employee or not workspace:
            raise ValueError("任务关联员工或工作空间不存在。")

        input_payload = TaskSchedulerService._loads_json(task.task_input_json, {})
        table_prompt = str(getattr(task, "user_prompt", "") or "").strip()
        prompt = (
            table_prompt
            or str(input_payload.get("prompt") or "").strip()
            or str(input_payload.get("user_prompt") or "").strip()
            or f"执行任务：{task.task_name}"
        )
        scene = str(input_payload.get("scene") or "")
        skill_name = cls._resolve_skill_name(db, employee, task.skill_id)
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
            if not task or not task.is_active or task.dispatch_type not in ("skill", "mcp"):
                return

            employee = db.get(Employee, task.employee_id)
            workspace = db.get(Workspace, task.workspace_id)

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
                if task.dispatch_type == "skill":
                    output = cls._execute_task_call(db, task)
                    run_log.run_status = "success"
                    run_log.run_result = "任务执行成功"
                    final_text = cls._extract_final_agent_text(output.get("response"))
                    run_log.output_json = cls._to_json_string({"content": final_text})
                    run_log.error_message = None
                else:
                    mcp_out = cls._execute_mcp_tool_call(db, task)
                    resp = mcp_out["response"]
                    try:
                        body: Any = resp.json()
                    except Exception:  # pylint: disable=broad-exception-caught
                        body = {"raw": resp.text}
                    if resp.status_code >= 400:
                        run_log.run_status = "failed"
                        run_log.run_result = "MCP 调用失败"
                        run_log.error_message = (
                            f"HTTP {resp.status_code}: {str(resp.text)[:2000]}"
                        )
                        run_log.output_json = cls._to_json_string(
                            body if isinstance(body, dict) else {"body": body}
                        )
                    else:
                        run_log.run_status = "success"
                        run_log.run_result = "任务执行成功"
                        run_log.error_message = None
                        if isinstance(body, dict) and "data" in body:
                            out_payload = body.get("data")
                        else:
                            out_payload = body
                        run_log.output_json = cls._to_json_string(
                            out_payload if out_payload is not None else body
                        )
            except Exception as exc:  # pylint: disable=broad-exception-caught
                logger.exception("定时任务执行失败 task_id=%s", task_id)
                run_log.run_status = "failed"
                run_log.run_result = "任务执行失败"
                run_log.error_message = str(exc)

            ended_at = cst_now()
            run_log.ended_at = ended_at
            run_log.duration_ms = int((ended_at - started_at).total_seconds() * 1000)
            task.last_run_at = ended_at
            task.next_run_at = TaskService.compute_next_run(task.cron_expression, now=ended_at)
            db.add(task)
            db.add(run_log)
            db.commit()
            if task.dispatch_type == "skill":
                cls._maybe_write_confirm_url(
                    db,
                    run_log=run_log,
                    task=task,
                    employee=employee,
                    workspace=workspace,
                )
                db.commit()

