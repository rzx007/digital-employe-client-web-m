from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path
from zipfile import ZipFile

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.employee import Employee
from src.models.workspace import Workspace

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
        shift_schedule = json.loads(getattr(employee, "shift_schedule_json", "{}") or "{}")
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
    def _download_zip() -> Path:
        settings = get_settings()
        if not settings.employee_zip_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未配置员工ZIP下载地址（EMPLOYEE_ZIP_URL）。")

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
            has_employee_payload = (candidate / "skills").is_dir() or any(candidate.glob("*.json"))
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
        has_employee_payload = (wrapper / "skills").is_dir() or any(wrapper.glob("*.json"))
        if has_employee_payload:
            return extract_dir

        children = [p for p in wrapper.iterdir()]
        if not children:
            return extract_dir

        for child in children:
            shutil.move(str(child), extract_dir / child.name)
        wrapper.rmdir()
        logger.warning("Flattened wrapped employee extract dir: wrapper=%s target=%s", wrapper, extract_dir)
        return extract_dir

    @staticmethod
    def _load_json_file(path: Path) -> dict:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    @staticmethod
    def materialize_embedded_skills(employee_dir: Path) -> None:
        metadata = EmployeeService._load_json_file(employee_dir / "metadata.json")
        skills = metadata.get("skills")
        if not isinstance(skills, list):
            return

        for skill in skills:
            if not isinstance(skill, dict):
                continue
            skill_name = skill.get("skillName")
            skill_content = skill.get("skillContent")
            if not isinstance(skill_name, str) or not skill_name.strip():
                continue
            if not skill_content:
                continue

            if isinstance(skill_content, str):
                try:
                    file_map = json.loads(skill_content)
                except json.JSONDecodeError:
                    continue
            elif isinstance(skill_content, dict):
                file_map = skill_content
            else:
                continue

            if not isinstance(file_map, dict):
                continue

            skill_dir = employee_dir / "skills" / skill_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            for relative_path, content in file_map.items():
                if not isinstance(relative_path, str) or not isinstance(content, str):
                    continue
                target = EmployeeService._safe_skill_file_path(skill_dir, relative_path)
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
            meta_file = next((p for p in json_files if p.name.lower() in priority_names), json_files[0])
            meta = EmployeeService._load_json_file(meta_file)

        skills_dir = employee_dir / "skills"
        if not skills_dir.exists():
            candidates = [p for p in employee_dir.rglob("*") if p.is_dir() and "skill" in p.name.lower()]
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
            extract_dir = EmployeeService._flatten_wrapped_extract_dir(extract_dir)
            employee_dirs = EmployeeService._resolve_employee_dirs(extract_dir)

            synced: list[Employee] = []
            for employee_dir in employee_dirs:
                employee_code = employee_dir.name
                meta, skills_paths = EmployeeService._extract_employee_payload(employee_dir)
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
                    employee = Employee(workspace_id=workspace.id, employee_code=employee_code)
                    db.add(employee)

                employee.name = str(meta.get("name") or meta.get("employee_name") or employee_code)
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
                employee.shift_schedule_json = json.dumps(EmployeeService._extract_shift_schedule(meta), ensure_ascii=False)
                synced.append(employee)

            db.commit()
            for employee in synced:
                db.refresh(employee)
            return synced
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"获取员工ZIP失败：{exc}") from exc
        finally:
            if should_cleanup_zip and zip_path and zip_path.exists():
                zip_path.unlink(missing_ok=True)

    @staticmethod
    def list_employees(db: Session, workspace_id: int) -> list[Employee]:
        return list(
            db.scalars(
                select(Employee).where(Employee.workspace_id == workspace_id).order_by(Employee.id.desc())
            ).all()
        )

    @staticmethod
    def get_employee(db: Session, employee_id: int) -> Employee:
        employee = db.get(Employee, employee_id)
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到员工。")
        return employee

    @staticmethod
    def update_employee(
        db: Session,
        employee_id: int,
        name: str | None,
        description: str | None,
        version: str | None,
    ) -> Employee:
        employee = EmployeeService.get_employee(db, employee_id)
        if name is not None:
            employee.name = name
        if description is not None:
            employee.description = description
        if version is not None:
            employee.version = version
        db.commit()
        db.refresh(employee)
        return employee

    @staticmethod
    def delete_employee(db: Session, employee_id: int) -> None:
        employee = EmployeeService.get_employee(db, employee_id)
        db.delete(employee)
        db.commit()

    @staticmethod
    def get_local_employee_skills(employee_name: str) -> list[dict]:
        """从本地目录获取员工的技能列表。

        Args:
            employee_name: 员工名称（对应 local-employees 目录下的文件夹名称）

        Returns:
            技能列表
        """
        root = EmployeeService._resolve_local_employees_root()
        employee_dir = root / employee_name
        if not employee_dir.exists():
            logger.warning(f"Local employee directory not found: {employee_dir}")
            return []

        metadata_file = employee_dir / "metadata.json"
        if not metadata_file.exists():
            logger.warning(f"Metadata file not found: {metadata_file}")
            return []

        metadata = EmployeeService._load_json_file(metadata_file)
        skills = metadata.get("skills", [])
        if not isinstance(skills, list):
            return []
        return skills
