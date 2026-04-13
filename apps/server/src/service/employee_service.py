from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path
from zipfile import ZipFile

import httpx
from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.employee import Employee, EmployeeShiftSchedule
from src.models.employee_skill import EmployeeSkill
from src.models.workspace import Workspace
from src.schemas.employee import EmployeeCreate, EmployeeUpdate, ShiftScheduleCreateWithoutEmployee
from src.service.skill_service import SkillService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService
from src.service.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)


class EmployeeService:

    @staticmethod
    def _extract_shift_schedule(meta: dict) -> dict:
        shift_schedule = meta.get("shift_schedule")
        if isinstance(shift_schedule, dict):
            return shift_schedule
        return {}

    @staticmethod
    def _safe_skill_file_path(skill_dir: Path, relative_path: str) -> Path | None:
        relative = Path(relative_path)
        if relative.is_absolute() or ".." in relative.parts:
            return None
        return skill_dir / relative

    @staticmethod
    def _resolve_local_employees_root() -> Path:
        return Path.cwd() / "local-employees"

    @staticmethod
    def _employee_to_dict(employee: Employee) -> dict:
        metadata = json.loads(employee.meta_json or "{}")
        shift_schedule = json.loads(
            getattr(employee, "shift_schedule_json", "{}") or "{}")
        if not isinstance(shift_schedule, dict):
            shift_schedule = {}
        if not shift_schedule and isinstance(metadata, dict):
            from_meta = metadata.get("shift_schedule")
            if isinstance(from_meta, dict):
                shift_schedule = from_meta
        return {
            "id": employee.id,
            "workspace_id": employee.workspace_id,
            "employee_code": employee.employee_code,
            "name": employee.name,
            "description": getattr(employee, "description", None),
            "version": employee.version,
            "skills": json.loads(employee.skills_json or "[]"),
            "metadata": metadata,
            "shift_schedule": shift_schedule,
            "created_at": employee.created_at,
            "updated_at": employee.updated_at,
        }

    @staticmethod
    def _employee_skills_snapshot(db: Session, employee: Employee) -> list[dict]:
        """员工技能摘要：优先 employee_skills 表，否则回退 meta_json.skills。"""
        rows = list(
            db.scalars(
                select(EmployeeSkill)
                .where(EmployeeSkill.employee_id == employee.id)
                .order_by(EmployeeSkill.id.asc())
            ).all()
        )
        if rows:
            return [
                {
                    "id": r.id,
                    "skill_id": r.skill_id,
                    "skill_name": r.skill_name,
                    "skill_name_zh": r.skill_name_zh,
                    "skill_description": r.skill_description,
                }
                for r in rows
            ]
        meta = EmployeeService._load_employee_meta(employee)
        nested = meta.get("skills")
        if isinstance(nested, list):
            return [x for x in nested if isinstance(x, dict)]
        return []

    @staticmethod
    def employee_detail_dict(db: Session, employee: Employee) -> dict:
        """员工详情：在 metadata 中附加 skills_info（技能信息列表）。"""
        data = EmployeeService._employee_to_dict(employee)
        meta = data.get("metadata")
        if isinstance(meta, dict):
            meta = dict(meta)
        else:
            meta = {}
        meta["skills"] = EmployeeService._employee_skills_snapshot(db, employee)
        data["metadata"] = meta
        return data

    @staticmethod
    def _download_zip() -> Path:
        settings = get_settings()
        if not settings.employee_zip_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="未配置员工ZIP下载地址（EMPLOYEE_ZIP_URL）。")

        tmp_dir = Path(settings.employee_tmp_dir)
        if not tmp_dir.is_absolute():
            tmp_dir = Path.cwd() / tmp_dir
        tmp_dir.mkdir(parents=True, exist_ok=True)

        zip_path = tmp_dir / f"employees-{uuid.uuid4().hex}.zip"
        with httpx.stream("GET", settings.employee_zip_url, timeout=120.0) as resp:
            resp.raise_for_status()
            with zip_path.open("wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
        return zip_path

    @staticmethod
    def _extract_zip(zip_path: Path, extract_dir: Path) -> Path:
        if extract_dir.exists():
            shutil.rmtree(extract_dir, ignore_errors=True)
        extract_dir.mkdir(parents=True, exist_ok=True)
        with ZipFile(zip_path, "r") as zip_file:
            zip_file.extractall(extract_dir)
        return extract_dir

    @staticmethod
    def _resolve_employee_dirs(extract_dir: Path) -> list[Path]:
        level_one = [p for p in extract_dir.iterdir() if p.is_dir()]
        if len(level_one) == 1:
            candidate = level_one[0]
            has_employee_payload = (
                candidate / "skills").is_dir() or any(candidate.glob("*.json"))
            if has_employee_payload:
                return [candidate]
            children = [p for p in candidate.iterdir() if p.is_dir()]
            if children:
                return children
        return level_one

    @staticmethod
    def _flatten_wrapped_extract_dir(extract_dir: Path) -> Path:
        level_one = [p for p in extract_dir.iterdir() if p.is_dir()]
        if len(level_one) != 1:
            return extract_dir

        wrapper = level_one[0]
        has_employee_payload = (
            wrapper / "skills").is_dir() or any(wrapper.glob("*.json"))
        if has_employee_payload:
            return extract_dir

        children = [p for p in wrapper.iterdir()]
        if not children:
            return extract_dir

        for child in children:
            shutil.move(str(child), extract_dir / child.name)
        wrapper.rmdir()
        logger.warning(
            "Flattened wrapped employee extract dir: wrapper=%s target=%s", wrapper, extract_dir)
        return extract_dir

    @staticmethod
    def _load_json_file(path: Path) -> dict:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    @staticmethod
    def _skill_content_to_file_map(skill_content: object) -> dict[str, str] | None:
        """将 skillContent（JSON 字符串，如 {\"SKILL.md\": \"...\"}，或已是 dict）解析为 相对路径 -> 文件文本。"""
        if skill_content is None:
            return None
        if isinstance(skill_content, str):
            stripped = skill_content.strip()
            if not stripped:
                return None
            try:
                file_map = json.loads(stripped)
            except json.JSONDecodeError:
                return None
        elif isinstance(skill_content, dict):
            file_map = skill_content
        else:
            return None
        if not isinstance(file_map, dict) or not file_map:
            return None
        out: dict[str, str] = {}
        for rel_path, raw in file_map.items():
            if not isinstance(rel_path, str) or not rel_path.strip():
                continue
            if isinstance(raw, str):
                out[rel_path] = raw
            elif isinstance(raw, (dict, list)):
                out[rel_path] = json.dumps(raw, ensure_ascii=False)
            else:
                out[rel_path] = str(raw)
        return out or None

    @staticmethod
    def materialize_embedded_skills(employee_dir: Path) -> None:
        metadata = EmployeeService._load_json_file(
            employee_dir / "metadata.json")
        skills = metadata.get("skills")
        if not isinstance(skills, list):
            return

        for skill in skills:
            if not isinstance(skill, dict):
                continue
            skill_name = skill.get("skillName")
            if not isinstance(skill_name, str) or not skill_name.strip():
                continue
            file_map = EmployeeService._skill_content_to_file_map(
                skill.get("skillContent"))
            if not file_map:
                continue

            skill_dir = employee_dir / "skills" / skill_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            for relative_path, content in file_map.items():
                target = EmployeeService._safe_skill_file_path(
                    skill_dir, relative_path)
                if target is None:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")

    @staticmethod
    def _extract_employee_payload(employee_dir: Path) -> tuple[dict, list[dict]]:
        meta: dict = {}
        json_files = sorted(employee_dir.glob("*.json"))
        if json_files:
            priority_names = {"meta.json", "employee.json", "info.json"}
            meta_file = next(
                (p for p in json_files if p.name.lower() in priority_names), json_files[0])
            meta = EmployeeService._load_json_file(meta_file)

        skills_dir = employee_dir / "skills"
        if not skills_dir.exists():
            candidates = [p for p in employee_dir.rglob(
                "*") if p.is_dir() and "skill" in p.name.lower()]
            if candidates:
                skills_dir = candidates[0]

        skills: list[dict] = []
        if skills_dir.exists():
            skills.append({"skills_dir": str(skills_dir)})
        return meta, skills

    @staticmethod
    def _write_skills(skills: list[dict]) -> list[dict]:
        return skills

    @staticmethod
    def _load_employee_meta(employee: Employee) -> dict:
        try:
            meta = json.loads(employee.meta_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        return meta

    @staticmethod
    def _normalize_tasks(tasks: list | None) -> list[dict]:
        if not tasks:
            return []
        normalized: list[dict] = []
        for task in tasks:
            if not isinstance(task, dict):
                task = task.model_dump()
            task_name = str(task.get("task_name") or "").strip()
            cron_expression = str(task.get("cron_expression") or "").strip()
            if not task_name or not cron_expression:
                continue
            config = task.get("config")
            if not isinstance(config, dict):
                config = {}
            if isinstance(config.get("input"), dict):
                input_payload = dict(config["input"])
            else:
                input_payload = dict(config)
            user_prompt = task.get("user_prompt")
            if user_prompt is not None and str(user_prompt).strip():
                input_payload["prompt"] = str(user_prompt).strip()
                input_payload.setdefault("user_prompt", str(user_prompt).strip())
            normalized.append(
                {
                    "task_name": task_name,
                    "dispatch_type": str(task.get("dispatch_type") or "skill"),
                    "skill_id": task.get("skill_id"),
                    "priority": int(task.get("priority") or 0),
                    "task_type": task.get("task_type"),
                    "cron_expression": cron_expression,
                    "cron_expression_type": str(task.get("cron_expression_type") or "custom"),
                    "is_active": bool(task.get("is_active", True)),
                    "confirm_execution_result": TaskService._to_bool(
                        task.get("confirm_execution_result"), default=False
                    ),
                    "config": {"input": input_payload},
                    "user_prompt": user_prompt,
                }
            )
        return normalized

    @staticmethod
    def _validate_and_fetch_skills(skill_ids: list[int] | None, token: str) -> list[dict]:
        if not skill_ids:
            return []
        details: list[dict] = []
        seen: set[int] = set()
        for raw_id in skill_ids:
            skill_id = int(raw_id)
            if skill_id in seen:
                continue
            seen.add(skill_id)
            detail = SkillService.get_remote_skill(int(skill_id), token)
            if int(detail.get("status") or 0) != 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"技能未启用，skill_id={skill_id}",
                )
            skill_content = detail.get("skillContent")
            if not skill_content:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"技能内容为空，skill_id={skill_id}",
                )
            try:
                if isinstance(skill_content, str):
                    parsed_content = json.loads(skill_content)
                elif isinstance(skill_content, dict):
                    parsed_content = skill_content
                else:
                    raise ValueError("skillContent 不是字符串或对象")
                if not isinstance(parsed_content, dict):
                    raise ValueError("skillContent 解析后不是对象")
            except (json.JSONDecodeError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"技能内容格式不合法，skill_id={skill_id}",
                ) from exc
            details.append(detail)
        return details

    @staticmethod
    def _skill_detail_skill_content_to_text(skill_content: object) -> str | None:
        """将技能详情中的 skillContent（字符串或对象）存为 TEXT。"""
        if skill_content is None:
            return None
        if isinstance(skill_content, str):
            return skill_content
        if isinstance(skill_content, dict):
            return json.dumps(skill_content, ensure_ascii=False)
        return str(skill_content)

    @staticmethod
    def _save_skills_to_local_files(employee: Employee, skills: list[dict]) -> None:
        """将远程技能详情落盘到 local-employees/<员工目录>/skills/<skillName>/，与 metadata 内嵌技能结构一致。"""
        label = (employee.name or "").strip() or str(
            employee.employee_code or employee.id)
        employee_root = Path.cwd() / "local-employees" / label / "skills"
        for skill in skills:
            if not isinstance(skill, dict):
                continue
            skill_name = skill.get("skillName")
            if not isinstance(skill_name, str) or not skill_name.strip():
                continue
            file_map = EmployeeService._skill_content_to_file_map(
                skill.get("skillContent"))
            if not file_map:
                continue
            skill_dir = employee_root / skill_name.strip()
            skill_dir.mkdir(parents=True, exist_ok=True)
            for relative_path, content in file_map.items():
                target = EmployeeService._safe_skill_file_path(
                    skill_dir, relative_path)
                if target is None:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
        # 返回skkill所在的路径
        return employee_root

    @staticmethod
    def _skill_detail_prompt_to_text(prompt: object) -> str | None:
        if prompt is None:
            return None
        prompt_str = prompt if isinstance(prompt, str) else str(prompt)
        prompt_str = prompt_str.strip()
        return prompt_str or None

    @staticmethod
    def _replace_employee_skills(db: Session, employee: Employee, skills: list[dict]) -> None:
        db.execute(delete(EmployeeSkill).where(
            EmployeeSkill.employee_id == employee.id))
        for item in skills:
            db.add(
                EmployeeSkill(
                    workspace_id=employee.workspace_id,
                    employee_id=employee.id,
                    skill_id=int(item.get("id")),
                    skill_name=str(item.get("skillName") or ""),
                    skill_name_zh=str(item.get("displayNameZh") or ""),
                    skill_description=item.get("description"),
                    prompt=EmployeeService._skill_detail_prompt_to_text(
                        item.get("prompt")),
                    skill_content=EmployeeService._skill_detail_skill_content_to_text(
                        item.get("skillContent")),
                )
            )
        employee.skills_json = json.dumps(skills, ensure_ascii=False)

    @staticmethod
    def _replace_shift_schedule(
        db: Session,
        employee: Employee,
        shift_schedule: ShiftScheduleCreateWithoutEmployee | None,
    ) -> None:
        db.execute(delete(EmployeeShiftSchedule).where(
            EmployeeShiftSchedule.employee_id == employee.id))
        shift_payload: dict = {}
        if shift_schedule is not None:
            shift_payload = shift_schedule.model_dump(exclude_none=True)
            db.add(
                EmployeeShiftSchedule(
                    employee_id=employee.id,
                    start_date=shift_schedule.start_date,
                    end_date=shift_schedule.end_date,
                    status=shift_schedule.status,
                    notes=shift_schedule.notes,
                )
            )
        employee.shift_schedule_json = json.dumps(
            shift_payload, ensure_ascii=False)

    @staticmethod
    def sync_workspace_employees(db: Session, workspace: Workspace) -> list[Employee]:
        zip_path: Path | None = None
        extract_dir: Path | None = None
        should_cleanup_zip = False
        try:
            zip_path = EmployeeService._download_zip()
            should_cleanup_zip = True
            if not zip_path.exists():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"从远程接口未找到员工ZIP文件：{zip_path}",
                )
            extract_dir = EmployeeService._resolve_local_employees_root()
            extract_dir.parent.mkdir(parents=True, exist_ok=True)
            extract_dir = EmployeeService._extract_zip(zip_path, extract_dir)
            extract_dir = EmployeeService._flatten_wrapped_extract_dir(
                extract_dir)
            employee_dirs = EmployeeService._resolve_employee_dirs(extract_dir)

            synced: list[Employee] = []
            for employee_dir in employee_dirs:
                employee_code = employee_dir.name
                meta, skills_paths = EmployeeService._extract_employee_payload(
                    employee_dir)
                skills = EmployeeService._write_skills(skills_paths)

                existing = db.scalar(
                    select(Employee).where(
                        Employee.workspace_id == workspace.id,
                        Employee.employee_code == employee_code,
                    )
                )

                if existing:
                    employee = existing
                else:
                    employee = Employee(
                        workspace_id=workspace.id, employee_code=employee_code)
                    db.add(employee)

                employee.name = str(meta.get("name") or meta.get(
                    "employee_name") or employee_code)
                employee.description = (
                    meta.get("description")
                    or meta.get("skill_description")
                    or meta.get("skillDescription")
                    or meta.get("skills_description")
                    or meta.get("技能描述")
                    or meta.get("描述")
                    or None
                )
                employee.version = str(meta.get("version") or "")
                employee.skills_json = json.dumps(skills, ensure_ascii=False)
                employee.meta_json = json.dumps(meta, ensure_ascii=False)
                employee.shift_schedule_json = json.dumps(
                    EmployeeService._extract_shift_schedule(meta), ensure_ascii=False)
                synced.append(employee)

            db.commit()
            for employee in synced:
                db.refresh(employee)
            return synced
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=f"获取员工ZIP失败：{exc}") from exc
        finally:
            if should_cleanup_zip and zip_path and zip_path.exists():
                zip_path.unlink(missing_ok=True)

    @staticmethod
    def list_employees(db: Session, workspace_id: int) -> list[Employee]:
        return list(
            db.scalars(
                select(Employee).where(Employee.workspace_id ==
                                       workspace_id).order_by(Employee.id.desc())
            ).all()
        )

    @staticmethod
    def get_employee(db: Session, employee_id: int) -> Employee:
        employee = db.get(Employee, employee_id)
        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")
        return employee

    @staticmethod
    def update_employee(
        db: Session,
        employee_id: int,
        payload: EmployeeUpdate,
        token: str
    ) -> Employee:
        employee = EmployeeService.get_employee(db, employee_id)
        changed_tasks = False
        if payload.name is not None:
            employee.name = payload.name
        if payload.description is not None:
            employee.description = payload.description
        if payload.version is not None:
            employee.version = payload.version

        if "skill_ids" in payload.model_fields_set:
            skills = EmployeeService._validate_and_fetch_skills(
                payload.skill_ids, token)
            EmployeeService._replace_employee_skills(db, employee, skills)
            EmployeeService._save_skills_to_local_files(employee, skills)

        if "shift_schedule" in payload.model_fields_set:
            EmployeeService._replace_shift_schedule(
                db, employee, payload.shift_schedule)

        if "tasks" in payload.model_fields_set:
            changed_tasks = True
            meta = EmployeeService._load_employee_meta(employee)
            meta["tasks"] = EmployeeService._normalize_tasks(payload.tasks)
            employee.meta_json = json.dumps(meta, ensure_ascii=False)
        db.commit()
        db.refresh(employee)
        if changed_tasks:
            TaskService.sync_workspace_tasks(db, employee.workspace_id)
            db.refresh(employee)
            TaskSchedulerService.reload_jobs()
        return employee

    @staticmethod
    def delete_employee(db: Session, employee_id: int) -> None:
        employee = EmployeeService.get_employee(db, employee_id)
        db.delete(employee)
        db.commit()
        TaskSchedulerService.reload_jobs()

    @staticmethod
    def create_employee(db: Session, obj_in: EmployeeCreate, token: str) -> Employee:
        workspace_id = obj_in.workspace_id or get_settings().default_workspace_id
        WorkspaceService.get_workspace(db, workspace_id)

        existing = db.scalar(
            select(Employee).where(
                Employee.workspace_id == workspace_id,
                Employee.name == obj_in.employee_name,
            )
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="员工名称已存在")

        skills = EmployeeService._validate_and_fetch_skills(
            obj_in.skill_ids, token)

        tasks = EmployeeService._normalize_tasks(obj_in.tasks)
        shift_schedule = obj_in.shift_schedule
        meta = {
            "status": obj_in.status,
            "detail_page_url": obj_in.detail_page_url,
            "user_id": obj_in.user_id,
            "tasks": tasks,
            "employee_name": obj_in.employee_name,
        }

        employee = Employee(
            workspace_id=workspace_id,
            employee_code="0",
            name=obj_in.employee_name,
            description=obj_in.capability_desc,
            version="",
            skills_json="[]",
            meta_json=json.dumps(meta, ensure_ascii=False),
            shift_schedule_json="{}",
        )
        db.add(employee)
        db.flush()
        employee.employee_code = str(employee.id)

        EmployeeService._replace_employee_skills(db, employee, skills)
        EmployeeService._replace_shift_schedule(db, employee, shift_schedule)
        # 将skills的内容存到本地文件
        skill_dir = EmployeeService._save_skills_to_local_files(
            employee, skills)
        # 将skill_dir的格式修改为 [{"skills_dir": "D:\\project\\boban\\llm\\actus-employee-client\\local-employees\\TMR运维人员\\skills"}]格式
        skills_dir = [{"skills_dir": str(skill_dir)}]
        employee.skills_json = json.dumps(skills_dir, ensure_ascii=False)
        db.commit()
        db.refresh(employee)

        if tasks:
            TaskService.sync_workspace_tasks(db, workspace_id)
            db.refresh(employee)
            TaskSchedulerService.reload_jobs()
        return employee
