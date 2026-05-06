from __future__ import annotations

import json
import logging
import os
import shutil
import uuid
from datetime import date
from pathlib import Path
from zipfile import ZipFile

import httpx
from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.models.employee import Employee
from src.models.employee_mcp import EmployeeMcp
from src.models.employee_skill import EmployeeSkill
from src.models.workspace import Workspace
from src.schemas.employee import EmployeeCreate, EmployeeUpdate, ShiftScheduleCreateWithoutEmployee
from src.service.mcp_service import McpService
from src.service.local_skill_service import LocalSkillService
from src.service.skill_service import SkillService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService
from src.service.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)


class EmployeeService:
    LONG_TERM_SHIFT_END_DATE = "9999-12-31"

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
    def _resolve_skill_root() -> Path:
        settings = get_settings()
        path = Path(os.path.expandvars(os.path.expanduser(settings.skill_path)))
        if not path.is_absolute():
            path = Path.cwd() / path
        return path.resolve()

    @staticmethod
    def migrate_local_employees_to_skill_path() -> None:
        source_root = EmployeeService._resolve_local_employees_root().resolve()
        if not source_root.is_dir():
            return

        target_root = EmployeeService._resolve_skill_root()
        if source_root == target_root:
            logger.info(
                "Skip migration because local-employees and SKILL_PATH are same: %s",
                source_root,
            )
            return
        if target_root.is_relative_to(source_root):
            logger.info(
                "Skip migration because SKILL_PATH is inside local-employees: source=%s target=%s",
                source_root,
                target_root,
            )
            return

        target_root.mkdir(parents=True, exist_ok=True)
        copied_count = 0
        for item in source_root.iterdir():
            dest = target_root / item.name
            if item.is_dir():
                shutil.copytree(item, dest, dirs_exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dest)
            copied_count += 1

        logger.info(
            "Copied local-employees content into SKILL_PATH: source=%s target=%s items=%s",
            source_root,
            target_root,
            copied_count,
        )

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
                    "skillName": r.skill_name,
                    "skill_name_zh": r.skill_name_zh,
                    "skill_description": r.skill_description,
                    "description": r.skill_description,
                    "prompt": r.prompt,
                    "skillContent": r.skill_content,
                    "skill_content": r.skill_content,
                }
                for r in rows
            ]
        meta = EmployeeService._load_employee_meta(employee)
        nested = meta.get("skills")
        if isinstance(nested, list):
            return [x for x in nested if isinstance(x, dict)]
        return []

    @staticmethod
    def _employee_mcps_snapshot(db: Session, employee: Employee) -> list[dict]:
        """返回该员工已绑定的 MCP 列表（与 /mcp/list、远程详情字段一致，id 为远程能力 ID）。"""
        rows = list(
            db.scalars(
                select(EmployeeMcp)
                .where(EmployeeMcp.employee_id == employee.id)
                .order_by(EmployeeMcp.id.asc())
            ).all()
        )
        out: list[dict] = []
        for r in rows:
            out.append(
                {
                    "id": r.mcp_id,
                    "mcp_server_name": r.mcp_server_name,
                    "mcp_tool_name": r.mcp_tool_name,
                    "capability_name": r.capability_name,
                    "capability_desc": r.capability_desc,
                    "creator_id": r.creator_id,
                    "created_at": r.api_created_at,
                    "updated_at": r.api_updated_at,
                }
            )
        return out

    @staticmethod
    def employee_detail_dict(db: Session, employee: Employee) -> dict:
        """员工详情：在 metadata 中附加 skills 和 mcps 快照。"""
        data = EmployeeService._employee_to_dict(employee)
        meta = data.get("metadata")
        if isinstance(meta, dict):
            meta = dict(meta)
        else:
            meta = {}
        meta["skills"] = EmployeeService._employee_skills_snapshot(db, employee)
        meta["mcps"] = EmployeeService._employee_mcps_snapshot(db, employee)
        data["metadata"] = meta
        data["mcps"] = meta["mcps"]
        return data

    @staticmethod
    def _download_zip(token: str | None = None) -> Path:
        settings = get_settings()
        if not settings.employee_zip_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="未配置员工ZIP下载地址（REMOTE_API_BASE_URL + EMPLOYEE_ZIP_PATH）。")

        tmp_dir = Path(settings.employee_tmp_dir)
        if not tmp_dir.is_absolute():
            tmp_dir = Path.cwd() / tmp_dir
        tmp_dir.mkdir(parents=True, exist_ok=True)

        zip_path = tmp_dir / f"employees-{uuid.uuid4().hex}.zip"
        headers = {"token": token or ""}
        with httpx.stream(
            "GET",
            settings.employee_zip_url,
            timeout=120.0,
            headers=headers,
        ) as resp:
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
        logger.info(
            "Flattened wrapped employee extract dir: wrapper=%s target=%s",
            wrapper,
            extract_dir,
        )
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

            raw_dispatch = str(task.get("dispatch_type") or "").strip()
            if raw_dispatch:
                dispatch_type = raw_dispatch
            else:
                trt = task.get("task_resource_type")
                if trt is not None and str(trt).strip():
                    tlow = str(trt).strip().lower()
                    dispatch_type = "mcp" if tlow == "mcp" else "skill"
                else:
                    dispatch_type = "skill"

            mtp = task.get("mcp_tool_name")
            if mtp is not None and str(mtp).strip():
                input_payload["mcp_tool_name"] = str(mtp).strip()

            if dispatch_type == "mcp":
                skill_id = None
                cap_id = TaskService._to_int(task.get("capability_id"))
            else:
                skill_id = TaskService._to_int(task.get("skill_id"))
                cap_id = None

            normalized_task = {
                "task_name": task_name,
                "dispatch_type": dispatch_type,
                "skill_id": skill_id,
                "capability_id": cap_id,
                "priority": int(task.get("priority") or 0),
                "task_type": task.get("task_type"),
                "cron_expression": cron_expression,
                "cron_expression_type": str(task.get("cron_expression_type") or "custom"),
                "confirm_execution_result": TaskService._to_bool(
                    task.get("confirm_execution_result"), default=False
                ),
                "config": {"input": input_payload},
                "user_prompt": user_prompt,
            }
            if "is_active" in task:
                normalized_task["is_active"] = TaskService._to_bool(
                    task.get("is_active"),
                    default=True,
                )
            normalized.append(normalized_task)
        return normalized

    @staticmethod
    def _validate_and_fetch_mcps(mcp_ids: list[int] | None, token: str) -> list[dict]:
        """去重后逐个拉取远程 MCP 详情，任何一个失败直接抛出异常。"""
        if not mcp_ids:
            return []
        details: list[dict] = []
        seen: set[int] = set()
        for raw_id in mcp_ids:
            mcp_id = int(raw_id)
            if mcp_id in seen:
                continue
            seen.add(mcp_id)
            detail = McpService.get_remote_mcp_detail(mcp_id, token)
            details.append(detail)
        return details

    @staticmethod
    def _replace_employee_mcps(db: Session, employee: Employee, mcp_details: list[dict]) -> None:
        """全量覆盖：先删除该员工全部 MCP 关联，再按最新详情重建。"""
        db.execute(delete(EmployeeMcp).where(EmployeeMcp.employee_id == employee.id))

        def _pick_str(d: dict, *keys: str) -> str | None:
            for k in keys:
                if k not in d:
                    continue
                v = d[k]
                if v is None:
                    continue
                s = str(v).strip()
                if s:
                    return s
            return None

        def _opt_creator_id(d: dict) -> int | None:
            v = d.get("creator_id")
            if v is None:
                return None
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        for item in mcp_details:
            raw_id = item.get("id")
            if raw_id is None:
                continue
            mcp_id = int(raw_id)
            mcp_server_name = _pick_str(item, "mcp_server_name")
            mcp_tool_name = _pick_str(item, "mcp_tool_name")
            capability_name = _pick_str(item, "capability_name")
            capability_desc: str | None = None
            if "capability_desc" in item and item["capability_desc"] is not None:
                capability_desc = str(item["capability_desc"])
            creator_id = _opt_creator_id(item)
            api_created_at = _pick_str(item, "created_at")
            api_updated_at = _pick_str(item, "updated_at")

            db.add(
                EmployeeMcp(
                    workspace_id=employee.workspace_id,
                    employee_id=employee.id,
                    mcp_id=mcp_id,
                    mcp_server_name=mcp_server_name,
                    mcp_tool_name=mcp_tool_name,
                    capability_name=capability_name,
                    capability_desc=capability_desc,
                    creator_id=creator_id,
                    api_created_at=api_created_at,
                    api_updated_at=api_updated_at,
                )
            )

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
                logger.error(
                    "技能 skillContent 解析失败 skill_id=%s: %s",
                    skill_id,
                    exc,
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"技能内容格式不合法，skill_id={skill_id}",
                ) from exc
            details.append(detail)
        return details

    @staticmethod
    def _validate_and_fetch_local_skills(skill_ids: list[int] | None) -> list[dict]:
        if not skill_ids:
            return []
        local_skill_ids = [int(v) for v in skill_ids if int(v) < 0]
        if not local_skill_ids:
            return []

        local_skills = LocalSkillService.list_local_skills()
        local_skill_map: dict[int, dict] = {}
        for item in local_skills:
            raw_local_id = item.get("localId")
            if isinstance(raw_local_id, int) and raw_local_id < 0:
                local_skill_map[raw_local_id] = item

        details: list[dict] = []
        for local_id in local_skill_ids:
            item = local_skill_map.get(local_id)
            if item is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"本地技能不存在或已变化，skill_id={local_id}",
                )
            skill_name = str(item.get("skillName") or "").strip()
            skill_path = str(item.get("path") or "").strip()
            if not skill_name or not skill_path:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"本地技能信息不完整，skill_id={local_id}",
                )
            details.append(
                {
                    "id": local_id,
                    "skillName": skill_name,
                    "displayNameZh": skill_name,
                    "description": f"本地技能：{skill_name}",
                    "prompt": None,
                    "skillContent": None,
                    "path": skill_path,
                    "source": "local",
                }
            )
        return details

    @staticmethod
    def _build_skills_json_payload(
        employee: Employee,
        remote_skills: list[dict],
        local_skills: list[dict],
    ) -> str:
        # 统一行为：无论远程/本地技能，都复制到员工私有 skills 目录
        skill_dir = EmployeeService._save_skills_to_skill_path(
            employee, [*remote_skills, *local_skills]
        )
        return json.dumps([{"skills_dir": str(skill_dir)}], ensure_ascii=False)

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
    def _save_skills_to_skill_path(employee: Employee, skills: list[dict]) -> Path:
        """将技能全量覆盖落盘到 local-employees/<员工ID>/skills/。"""
        employee_root = (
            EmployeeService._resolve_skill_root() / str(employee.id) / "skills"
        )
        if employee_root.exists():
            shutil.rmtree(employee_root, ignore_errors=True)
        employee_root.mkdir(parents=True, exist_ok=True)
        for skill in skills:
            if not isinstance(skill, dict):
                continue
            skill_name = skill.get("skillName")
            if not isinstance(skill_name, str) or not skill_name.strip():
                continue
            skill_dir = employee_root / skill_name.strip()

            # 本地技能：直接复制本地技能目录到员工私有目录
            if str(skill.get("source") or "").strip().lower() == "local":
                local_path = Path(str(skill.get("path") or "").strip())
                if local_path.is_dir():
                    shutil.copytree(local_path, skill_dir, dirs_exist_ok=True)
                continue

            file_map = EmployeeService._skill_content_to_file_map(
                skill.get("skillContent"))
            if not file_map:
                continue
            skill_dir.mkdir(parents=True, exist_ok=True)
            for relative_path, content in file_map.items():
                target = EmployeeService._safe_skill_file_path(
                    skill_dir, relative_path)
                if target is None:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
        # 返回 skill 根目录
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
        shift_payload = EmployeeService._normalize_shift_schedule(shift_schedule)
        employee.shift_schedule_json = json.dumps(
            shift_payload, ensure_ascii=False)

    @staticmethod
    def _normalize_shift_schedule(
        shift_schedule: ShiftScheduleCreateWithoutEmployee | None,
    ) -> dict:
        if shift_schedule is None:
            return {}

        start_date = (shift_schedule.start_date or "").strip()
        end_date = (shift_schedule.end_date or "").strip()
        if not start_date:
            start_date = date.today().isoformat()
        if not end_date:
            end_date = EmployeeService.LONG_TERM_SHIFT_END_DATE

        payload = {
            "start_date": start_date,
            "end_date": end_date,
            "status": shift_schedule.status,
        }
        if shift_schedule.notes is not None:
            payload["notes"] = shift_schedule.notes
        return payload

    @staticmethod
    def sync_workspace_employees(
        db: Session,
        workspace: Workspace,
        token: str | None = None,
    ) -> list[Employee]:
        zip_path: Path | None = None
        extract_dir: Path | None = None
        should_cleanup_zip = False
        try:
            zip_path = EmployeeService._download_zip(token=token)
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
            logger.error("同步员工 ZIP 下载失败: %s", exc, exc_info=True)
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
        if payload.employee_name is not None:
            employee.name = payload.employee_name
        if payload.capability_desc is not None:
            employee.description = payload.capability_desc
        # if payload.version is not None:
        #     employee.version = payload.version

        # 这里需要加一个判断条件，新的员工姓名不能与其他员工姓名相同
        existing_employee = db.scalar(
            select(Employee).where(
                Employee.workspace_id == employee.workspace_id,
                Employee.name == payload.employee_name,
                Employee.id != employee.id,
            )
        )
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="员工名称已存在")
        else:
            employee.name = payload.employee_name

        if "skill_ids" in payload.model_fields_set:
            skill_ids = payload.skill_ids or []
            remote_skill_ids = [int(v) for v in skill_ids if int(v) > 0]
            remote_skills = EmployeeService._validate_and_fetch_skills(
                remote_skill_ids, token
            )
            local_skills = EmployeeService._validate_and_fetch_local_skills(skill_ids)
            merged_skills = [*remote_skills, *local_skills]
            EmployeeService._replace_employee_skills(db, employee, merged_skills)
            employee.skills_json = EmployeeService._build_skills_json_payload(
                employee,
                remote_skills,
                local_skills,
            )

        if "mcp_ids" in payload.model_fields_set:
            mcp_details = EmployeeService._validate_and_fetch_mcps(payload.mcp_ids, token)
            EmployeeService._replace_employee_mcps(db, employee, mcp_details)

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

        skill_ids = obj_in.skill_ids or []
        remote_skill_ids = [int(v) for v in skill_ids if int(v) > 0]
        remote_skills = EmployeeService._validate_and_fetch_skills(
            remote_skill_ids, token
        )
        local_skills = EmployeeService._validate_and_fetch_local_skills(skill_ids)
        mcp_details = EmployeeService._validate_and_fetch_mcps(obj_in.mcp_ids, token)

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

        EmployeeService._replace_employee_skills(
            db, employee, [*remote_skills, *local_skills]
        )
        EmployeeService._replace_employee_mcps(db, employee, mcp_details)
        EmployeeService._replace_shift_schedule(db, employee, shift_schedule)
        employee.skills_json = EmployeeService._build_skills_json_payload(
            employee,
            remote_skills,
            local_skills,
        )
        db.commit()
        db.refresh(employee)

        if tasks:
            TaskService.sync_workspace_tasks(db, workspace_id)
            db.refresh(employee)
            TaskSchedulerService.reload_jobs()
        return employee
