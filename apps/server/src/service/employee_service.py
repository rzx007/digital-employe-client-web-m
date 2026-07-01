from __future__ import annotations

import json
import logging
import os
import re
import shutil
import uuid
from datetime import date
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.core.request_utils import DEFAULT_USER_ID
from src.models.employee import Employee
from src.models.employee_mcp import EmployeeMcp
from src.models.employee_skill import EmployeeSkill
from src.models.workspace import Workspace
from src.schemas.employee import EmployeeCreate, EmployeeUpdate, ShiftScheduleCreateWithoutEmployee
from src.service.mcp_service import McpService
from src.service.skill_service import SkillService
from src.service.local_skill_service import LocalSkillService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService
from src.service.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)

# 技能候选 slug：小写字母数字 + 连字符（与 librarian 产出一致），用于防路径穿越校验。
_SKILL_CANDIDATE_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _growth_brain_root_for(employee_id: int) -> Path:
    from src.service.agent.paths import resolve_employee_memories_dir
    return resolve_employee_memories_dir(employee_id=employee_id).parent


def _new_pending_employee_code() -> str:
    """创建员工前的唯一占位 code，避免 (workspace_id, employee_code) 唯一约束冲突。"""
    return f"pending-{uuid.uuid4().hex}"


# (展示名称, 技能目录名元组, 简介)
_BUILTIN_SEED_EMPLOYEES: tuple[tuple[str, tuple[str, ...], str | None], ...] = (
    ("飞书助手", ("lark-base",), "内置飞书多维表格等能力。"),
    ("技能制作助手", ("skill-creator",), "协助编写与管理技能（Skills）。"),
    (
        "环境管家",
        ("env-steward",),
        "诊断并修复 Python / Node.js / Git / curl 等主机环境问题。",
    ),
    (
        "文档办公助手",
        ("docx", "pptx", "xlsx", "pdf"),
        "处理 Word、Excel、PPT、PDF 等办公文档的创建、编辑与转换。",
    ),
    (
        "浏览器助手",
        ("browser-runtime",),
        "在桌面端内嵌浏览器中打开网页、填表、点击与抽取内容。",
    ),
    (
        "问题反馈助手",
        ("bug-reporter",),
        "收集并提交 BUG 反馈到官方后台。",
    ),
)


class EmployeeService:
    LONG_TERM_SHIFT_END_DATE = "9999-12-31"

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
    def ensure_curator_employee(
        db: Session, user_id: str | None, workspace_id: int
    ) -> Employee:
        """确保总管员工存在（每用户唯一），不存在则自动创建。

        存在性按 user_id 判定；创建时同时盖 user_id 与 workspace_id（后者为
        过渡期的装饰性列）。
        """
        existing = db.scalar(
            select(Employee).where(
                Employee.user_id == user_id,
                Employee.is_curator.is_(True),
            )
        )
        if existing:
            return existing

        curator = Employee(
            user_id=user_id,
            workspace_id=workspace_id,
            employee_code="curator",
            name="总管助手",
            description="数字员工统筹",
            version="",
            is_curator=True,
            skills_json="[]",
            meta_json=json.dumps({
                "employee_name": "总管助手",
                "status": 1,
                "capability_desc": "任务分派、会话路由与协作编排",
            }, ensure_ascii=False),
            shift_schedule_json="{}",
        )
        db.add(curator)
        db.commit()
        db.refresh(curator)
        logger.info("Created curator employee: id=%s", curator.id)
        return curator

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
            "is_curator": bool(employee.is_curator),
            # 自定义头像：有则给「带版本号的相对 URL」(前端拼后端 base 加载、版本号防缓存)，
            # 无则 None → 前端回落到「名字前两个字」文本头像。
            "avatar": (
                f"/employees/{employee.id}/avatar?v={int(employee.updated_at.timestamp())}"
                if getattr(employee, "avatar_url", None)
                else None
            ),
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
                    # 能进 employee_skills 表即代表已分配=已启用；表无禁用态，固定 status=1。
                    "status": 1,
                }
                for r in rows
            ]
        meta = EmployeeService._load_employee_meta(employee)
        nested = meta.get("skills")
        if isinstance(nested, list):
            return [x for x in nested if isinstance(x, dict)]
        return []

    @staticmethod
    def get_employee_local_skill_ids(db, employee) -> list[int]:
        """该员工现有的本地/工作区技能 localId（负数）列表。"""
        snapshot = EmployeeService._employee_skills_snapshot(db, employee)
        ids: list[int] = []
        for row in snapshot:
            sid = row.get("skill_id")
            if isinstance(sid, int) and sid < 0:
                ids.append(sid)
        return ids

    @staticmethod
    def _assigned_skill_rows(
        db: Session, user_id: str | None, skill_name: str, local_id: int | None = None
    ) -> list[EmployeeSkill]:
        """查某用户名下已分配某本地/工作区技能的 EmployeeSkill 行（按 employee 所有者 user_id 收口）。

        user_id 为 None 时返回空列表——避免 `Employee.user_id == None` 退化成 IS NULL、
        跨用户误匹配 user_id 为空的历史员工。
        """
        if user_id is None:
            return []
        normalized = LocalSkillService._normalize_skill_name(skill_name)
        conds = [EmployeeSkill.skill_name == normalized]
        if local_id is not None:
            conds.append(EmployeeSkill.skill_id == local_id)
        return list(
            db.scalars(
                select(EmployeeSkill)
                .join(Employee, EmployeeSkill.employee_id == Employee.id)
                .where(Employee.user_id == user_id, or_(*conds))
            ).all()
        )

    @staticmethod
    def list_skill_assignees(
        db: Session,
        *,
        user_id: str,
        skill_name: str,
        local_id: int | None = None,
    ) -> list[dict[str, int | str]]:
        """返回已分配该本地/工作区技能的员工（查 employee_skills 表，按 user 过滤）。"""
        rows = EmployeeService._assigned_skill_rows(
            db, user_id, skill_name, local_id
        )
        if not rows:
            return []

        employee_ids = sorted({row.employee_id for row in rows})
        employees = {
            emp.id: emp
            for emp in db.scalars(
                select(Employee).where(Employee.id.in_(employee_ids))
            ).all()
        }

        assignees: list[dict[str, int | str]] = []
        seen: set[int] = set()
        for eid in employee_ids:
            if eid in seen:
                continue
            seen.add(eid)
            emp = employees.get(eid)
            if emp is None:
                continue
            assignees.append(
                {
                    "employee_id": emp.id,
                    "employee_name": emp.name or f"员工#{emp.id}",
                }
            )
        return assignees

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
        """员工详情：在 metadata 中附加 skills、mcps、tasks 快照。"""
        data = EmployeeService._employee_to_dict(employee)
        meta = data.get("metadata")
        if isinstance(meta, dict):
            meta = dict(meta)
        else:
            meta = {}
        meta["skills"] = EmployeeService._employee_skills_snapshot(db, employee)
        meta["mcps"] = EmployeeService._employee_mcps_snapshot(db, employee)
        meta["tasks"] = TaskService.list_employee_tasks_as_dict(db, employee.id)
        data["metadata"] = meta
        data["mcps"] = meta["mcps"]
        # 技能候选计数：联系人列表/卡片用来显示「✨N 个新技能待确认」角标。
        data["skill_candidate_count"] = EmployeeService._skill_candidate_count(employee.id)
        return data

    @staticmethod
    def _skill_candidate_count(employee_id: int) -> int:
        """该员工待确认的技能候选数（<brain>/skill_candidates/*.md）。容错→0。"""
        try:
            cand_dir = _growth_brain_root_for(employee_id) / "skill_candidates"
            if not cand_dir.is_dir():
                return 0
            return sum(1 for p in cand_dir.glob("*.md") if p.is_file())
        except Exception:
            return 0

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
    def _load_employee_meta(employee: Employee) -> dict:
        try:
            meta = json.loads(employee.meta_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        return meta

    @staticmethod
    def _sync_employee_meta_from_update(
        db: Session,
        employee: Employee,
        payload: EmployeeUpdate,
    ) -> None:
        """将员工表字段与关联数据同步到 meta_json，与 create_employee 写入结构一致。"""
        meta = EmployeeService._load_employee_meta(employee)

        if payload.employee_name is not None:
            meta["employee_name"] = payload.employee_name
        if payload.capability_desc is not None:
            meta["capability_desc"] = payload.capability_desc
        if "status" in payload.model_fields_set:
            meta["status"] = payload.status
        if "detail_page_url" in payload.model_fields_set:
            meta["detail_page_url"] = payload.detail_page_url

        if "shift_schedule" in payload.model_fields_set:
            try:
                shift = json.loads(employee.shift_schedule_json or "{}")
            except json.JSONDecodeError:
                shift = {}
            if isinstance(shift, dict):
                meta["shift_schedule"] = shift

        if "skill_ids" in payload.model_fields_set:
            meta["skills"] = EmployeeService._employee_skills_snapshot(
                db, employee
            )
        if "mcp_ids" in payload.model_fields_set:
            meta["mcps"] = EmployeeService._employee_mcps_snapshot(db, employee)
        if "tasks" in payload.model_fields_set:
            meta["tasks"] = TaskService.list_employee_tasks_as_dict(
                db, employee.id
            )

        employee.meta_json = json.dumps(meta, ensure_ascii=False)

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
                    user_id=employee.user_id,
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
    def _validate_and_fetch_local_skills(
        skill_ids: list[int] | None,
        workspace_id: int | None = None,
    ) -> list[dict]:
        if not skill_ids:
            return []
        local_skill_ids = [int(v) for v in skill_ids if int(v) < 0]
        if not local_skill_ids:
            return []

        # 必须带 workspace_id，否则会只扫 builtin/，导入到 workspace 的负向 localId 无法命中
        local_skills = LocalSkillService.list_local_skills(workspace_id)
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
            display_name_zh = LocalSkillService.resolve_display_name_zh(
                skill_name,
                {"displayNameZh": item.get("displayNameZh")},
            )
            details.append(
                {
                    "id": local_id,
                    "skillName": skill_name,
                    "displayNameZh": display_name_zh,
                    "description": f"本地技能：{skill_name}",
                    "prompt": None,
                    "skillContent": None,
                    "path": skill_path,
                    "source": "local",
                }
            )
        return details

    @staticmethod
    def _remote_skill_detail_to_payload(skill_id: int, raw: dict) -> dict:
        skill_name = raw.get("skillName") or raw.get("skill_name")
        if not skill_name or not str(skill_name).strip():
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="远程技能详情缺少 skillName。",
            )
        display_zh = raw.get("displayNameZh") or raw.get("display_name_zh")
        return {
            "id": skill_id,
            "skillName": str(skill_name).strip(),
            "displayNameZh": (
                str(display_zh).strip()
                if isinstance(display_zh, str) and display_zh.strip()
                else str(skill_name).strip()
            ),
            "description": raw.get("description"),
            "prompt": raw.get("prompt"),
            "skillContent": raw.get("skillContent"),
            "source": "remote",
        }

    @staticmethod
    def _validate_and_fetch_remote_skills(
        skill_ids: list[int] | None,
        token: str,
    ) -> list[dict]:
        if not skill_ids:
            return []
        remote_ids = sorted({int(v) for v in skill_ids if int(v) > 0})
        if not remote_ids:
            return []
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="未登录，无法分配远程技能（正整数 skill_id）。",
            )

        details: list[dict] = []
        for skill_id in remote_ids:
            raw = SkillService.get_remote_skill(skill_id, token)
            if int(raw.get("status") or 0) != 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"远程技能未启用，无法分配: skill_id={skill_id}",
                )
            payload = EmployeeService._remote_skill_detail_to_payload(skill_id, raw)
            details.append(payload)
        return details

    @staticmethod
    def _resolve_skills_for_assignment(
        skill_ids: list[int] | None,
        *,
        workspace_id: int,
        token: str,
    ) -> tuple[list[dict], list[dict]]:
        """拆分为远程技能与本地技能详情（供落盘与 EmployeeSkill 写入）。"""
        ids = skill_ids or []
        remote_skills = EmployeeService._validate_and_fetch_remote_skills(ids, token)
        local_skills = EmployeeService._validate_and_fetch_local_skills(
            ids, workspace_id
        )
        return remote_skills, local_skills

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
    def _materialize_one_skill(employee_root: Path, skill: dict) -> Path | None:
        """把单个技能(本地 copytree / 远程 file_map)落盘到 employee_root/<skillName>/。
        返回技能目录；无有效内容则 None。"""
        skill_name = skill.get("skillName")
        if not isinstance(skill_name, str) or not skill_name.strip():
            return None
        skill_dir = employee_root / skill_name.strip()

        if str(skill.get("source") or "").strip().lower() == "local":
            local_path = Path(str(skill.get("path") or "").strip())
            if local_path.is_dir():
                shutil.copytree(local_path, skill_dir, dirs_exist_ok=True,
                                ignore=shutil.ignore_patterns(".history"))
                return skill_dir
            return None

        file_map = EmployeeService._skill_content_to_file_map(skill.get("skillContent"))
        if not file_map:
            return None
        skill_dir.mkdir(parents=True, exist_ok=True)
        for relative_path, content in file_map.items():
            target = EmployeeService._safe_skill_file_path(skill_dir, relative_path)
            if target is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        return skill_dir

    @staticmethod
    def _save_skills_to_skill_path(employee: Employee, skills: list[dict]) -> Path:
        """增量落盘员工私有技能：只增删 assigned 技能，绝不碰 grown:*（采纳/自改进）。"""
        from src.service import skill_provenance
        employee_root = (
            EmployeeService._resolve_skill_root() / str(employee.id) / "skills"
        )
        employee_root.mkdir(parents=True, exist_ok=True)

        desired = {
            str(s.get("skillName")).strip(): s
            for s in skills
            if isinstance(s, dict) and str(s.get("skillName") or "").strip()
        }

        current_assigned = {
            info.name
            for info in skill_provenance.scan_employee_skills(employee_root)
            if info.origin == "assigned"
        }

        # 删：被取消勾选的 assigned（grown:* 不在 current_assigned，天然保留）
        for name in current_assigned - set(desired):
            shutil.rmtree(employee_root / name, ignore_errors=True)

        # 增：新勾选的库/远程技能。已存在的 assigned 跳过重 copy（保住 locallyModified 改进版）
        for name, skill in desired.items():
            if name in current_assigned:
                continue
            # 不用库版本覆盖同名的 grown 技能（采纳/自改进的成果优先）
            existing_dir = employee_root / name
            if existing_dir.is_dir():
                existing_origin = skill_provenance.read_origin(existing_dir).origin or ""
                if existing_origin.startswith("grown"):
                    # 该员工已有同名成长技能，库版本不覆盖——分配对此技能静默无效，记日志可诊断
                    logger.info(
                        "assign: 技能 %r 被同名成长技能遮蔽，库版本未应用(employee=%s)",
                        name, employee.id,
                    )
                    continue
            # assigned 技能必须带真实 id；缺 id 跳过（不写 skill_id=0）
            sid = skill.get("id")
            if not sid:
                logger.warning("assign: 技能 %r 缺 id，跳过落盘", name)
                continue
            target = EmployeeService._materialize_one_skill(employee_root, skill)
            if target is not None:
                skill_provenance.write_origin(
                    target,
                    origin="assigned",
                    skill_id=int(sid),
                    prompt=EmployeeService._skill_detail_prompt_to_text(skill.get("prompt")),
                    display_name_zh=str(skill.get("displayNameZh") or "") or None,
                    description=skill.get("description"),
                )
        return employee_root

    @staticmethod
    def _skill_detail_prompt_to_text(prompt: object) -> str | None:
        if prompt is None:
            return None
        prompt_str = prompt if isinstance(prompt, str) else str(prompt)
        prompt_str = prompt_str.strip()
        return prompt_str or None

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
    def list_employees(db: Session, user_id: str) -> list[Employee]:
        return list(
            db.scalars(
                select(Employee).where(Employee.user_id ==
                                       user_id).order_by(Employee.id.desc())
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

        if employee.is_curator:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不能修改总管助手。",
            )

        if payload.employee_name is not None:
            existing_employee = db.scalar(
                select(Employee).where(
                    Employee.user_id == employee.user_id,
                    Employee.name == payload.employee_name,
                    Employee.id != employee.id,
                )
            )
            if existing_employee:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="员工名称已存在",
                )
            employee.name = payload.employee_name
        if payload.capability_desc is not None:
            employee.description = payload.capability_desc

        if "skill_ids" in payload.model_fields_set:
            skill_ids = payload.skill_ids or []
            remote_skills, local_skills = EmployeeService._resolve_skills_for_assignment(
                skill_ids,
                workspace_id=employee.workspace_id,
                token=token,
            )
            employee.skills_json = EmployeeService._build_skills_json_payload(
                employee,
                remote_skills,
                local_skills,
            )
            EmployeeService.reconcile_employee_skills(db, employee)

        if "mcp_ids" in payload.model_fields_set:
            mcp_details = EmployeeService._validate_and_fetch_mcps(payload.mcp_ids, token)
            EmployeeService._replace_employee_mcps(db, employee, mcp_details)

        if "shift_schedule" in payload.model_fields_set:
            EmployeeService._replace_shift_schedule(
                db, employee, payload.shift_schedule)

        if "tasks" in payload.model_fields_set:
            changed_tasks = True
            normalized = EmployeeService._normalize_tasks(payload.tasks)
            TaskService.upsert_employee_tasks(
                db, employee.workspace_id, employee.id, normalized
            )

        EmployeeService._sync_employee_meta_from_update(db, employee, payload)
        db.commit()
        db.refresh(employee)
        if changed_tasks:
            db.refresh(employee)
            TaskSchedulerService.reload_jobs()
        return employee

    @staticmethod
    def delete_employee(db: Session, employee_id: int) -> None:
        # 注意（SP2）：不要在此清理产物。产物现为「项目共享」——同项目所有员工与
        # 总管共用 <product_root>/{artifacts,uploads,skills-draft}。删单个员工只删
        # DB 行 / 最近联系人 / 重排定时任务；产物清理只在删工作空间时发生
        # （WorkspaceService.delete_workspace）。请勿在此恢复任何产物 rmtree。
        employee = EmployeeService.get_employee(db, employee_id)
        if employee.is_curator:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不能删除总管助手。",
            )
        workspace_id = employee.workspace_id
        db.delete(employee)
        db.commit()
        from src.service.recent_contact_service import RecentContactService

        RecentContactService.delete_by_target(
            db, workspace_id, "employee", employee_id
        )
        TaskSchedulerService.reload_jobs()

    @staticmethod
    def _builtin_seed_skill_payloads(
        local_root: Path, skill_names: tuple[str, ...]
    ) -> list[dict] | None:
        out: list[dict] = []
        for sn in skill_names:
            skill_dir = (local_root / sn).resolve()
            skill_md = skill_dir / LocalSkillService.SKILL_MD_NAME
            if not skill_dir.is_dir() or not skill_md.is_file():
                logger.warning(
                    "Builtin seed: skill missing or invalid: %s (expected %s)",
                    sn,
                    skill_md,
                )
                return None
            meta = LocalSkillService._read_meta(skill_dir)
            local_id = LocalSkillService._parse_local_id(meta.get("localId"))
            if local_id is None:
                logger.warning(
                    "Builtin seed: skill %r has no localId in .skill-meta.json", sn
                )
                return None
            desc_raw = meta.get("description")
            description = (
                str(desc_raw).strip()
                if desc_raw is not None and str(desc_raw).strip()
                else f"本地技能：{sn}"
            )
            display_name_zh = LocalSkillService.resolve_display_name_zh(sn, meta)
            out.append(
                {
                    "id": local_id,
                    "skillName": sn,
                    "displayNameZh": display_name_zh,
                    "description": description,
                    "prompt": None,
                    "skillContent": None,
                    "path": str(skill_dir),
                    "source": "local",
                }
            )
        return out

    @staticmethod
    def _patch_employee_skills_json_for_local_skill(
        employee: Employee,
        skill_name: str,
        *,
        display_name_zh: str | None,
        description: str | None,
        skill_md_content: str | None,
    ) -> None:
        """兼容旧版 skills_json（技能对象列表）中的展示字段与 SKILL.md 内容。"""
        try:
            data = json.loads(employee.skills_json or "[]")
        except json.JSONDecodeError:
            return
        if not isinstance(data, list) or not data:
            return
        if (
            len(data) == 1
            and isinstance(data[0], dict)
            and isinstance(data[0].get("skills_dir"), str)
        ):
            return

        changed = False
        for item in data:
            if not isinstance(item, dict):
                continue
            if str(item.get("skillName") or "").strip() != skill_name:
                continue
            changed = True
            item["displayNameZh"] = display_name_zh or skill_name
            if description is not None:
                item["description"] = description
            if skill_md_content is not None:
                item["skillContent"] = json.dumps(
                    {LocalSkillService.SKILL_MD_NAME: skill_md_content},
                    ensure_ascii=False,
                )
        if changed:
            employee.skills_json = json.dumps(data, ensure_ascii=False)

    @staticmethod
    def _refresh_employee_meta_skills(db: Session, employee: Employee) -> None:
        meta = EmployeeService._load_employee_meta(employee)
        meta["skills"] = EmployeeService._employee_skills_snapshot(db, employee)
        employee.meta_json = json.dumps(meta, ensure_ascii=False)

    @staticmethod
    def reconcile_employee_skills(db: Session, employee: Employee) -> None:
        """唯一的「磁盘 → EmployeeSkill」投影。幂等。改动磁盘技能集后必调。"""
        from src.service import skill_provenance
        from src.service.basic_file_reader import read_text_with_encoding_fallback

        skills_root = (
            EmployeeService._resolve_skill_root() / str(employee.id) / "skills"
        )
        disk = skill_provenance.scan_employee_skills(skills_root)

        for info in disk:
            if info.origin is None:
                d = skills_root / info.name
                row = db.scalars(
                    select(EmployeeSkill).where(
                        EmployeeSkill.employee_id == employee.id,
                        EmployeeSkill.skill_name == info.name,
                    )
                ).first()
                try:
                    # legacy 行皆为 assigned（grown 是本次新增、必带标记，故无标记目录必非 grown）。
                    # 库技能 localId 为负，不能用 >0 判定，否则会把库分配技能误标为 grown。
                    if row is not None and row.skill_id is not None:
                        skill_provenance.write_origin(d, origin="assigned", skill_id=row.skill_id)
                    else:
                        skill_provenance.write_origin(
                            d, origin="grown:adopted",
                            skill_id=skill_provenance.next_grown_skill_id(skills_root))
                except OSError:
                    logger.warning("reconcile: backfill write_origin failed: %s", d, exc_info=True)
        disk = skill_provenance.scan_employee_skills(skills_root)

        disk_by_name = {info.name: info for info in disk}
        existing = {
            r.skill_name: r
            for r in db.scalars(
                select(EmployeeSkill).where(EmployeeSkill.employee_id == employee.id)
            ).all()
        }

        for name, row in existing.items():
            if name not in disk_by_name:
                db.delete(row)

        for name, info in disk_by_name.items():
            skill_md = skills_root / name / skill_provenance.SKILL_MD
            try:
                content = (
                    read_text_with_encoding_fallback(skill_md)
                    if skill_md.is_file() else None
                )
            except OSError:
                logger.warning("reconcile: read SKILL.md failed: %s", skill_md, exc_info=True)
                content = None
            row = existing.get(name)
            if row is None:
                skill_id = info.skill_id
                if skill_id is None:
                    # 兜底（标记损坏极少触发）：生成并立即落盘，保证下次 reconcile 复用同一 id
                    skill_id = skill_provenance.next_grown_skill_id(skills_root)
                    skill_provenance.write_origin(
                        skills_root / name,
                        origin=(info.origin or "grown:adopted"),
                        skill_id=skill_id,
                    )
                row = EmployeeSkill(
                    workspace_id=employee.workspace_id,
                    user_id=employee.user_id,
                    employee_id=employee.id,
                    skill_id=skill_id,
                    skill_name=name,
                )
                db.add(row)
            row.skill_name_zh = info.display_name_zh or ""
            row.skill_description = info.description
            row.prompt = info.prompt
            row.skill_content = content

        db.flush()
        EmployeeService._refresh_employee_meta_skills(db, employee)

    @staticmethod
    def sync_local_skill_to_assignees(
        db: Session,
        *,
        user_id: str,
        workspace_id: int,
        skill_name: str,
    ) -> int:
        """
        本地技能保存后，同步已分配该技能的员工：
        employee_skills 表、员工私有 skills 目录、skills_json / meta_json 快照。
        """
        normalized = LocalSkillService._normalize_skill_name(skill_name)
        skill_dir = LocalSkillService._resolve_editable_skill_dir(
            normalized, workspace_id
        )
        meta = LocalSkillService._read_meta(skill_dir)
        local_id = LocalSkillService._parse_local_id(meta.get("localId"))

        zh_raw = meta.get("displayNameZh")
        display_name_zh = (
            zh_raw.strip()
            if isinstance(zh_raw, str) and zh_raw.strip()
            else None
        )
        desc_raw = meta.get("description")
        description = (
            desc_raw.strip()
            if isinstance(desc_raw, str) and desc_raw.strip()
            else None
        )

        skill_md_path = skill_dir / LocalSkillService.SKILL_MD_NAME
        skill_md_content = (
            skill_md_path.read_text(encoding="utf-8")
            if skill_md_path.is_file()
            else None
        )

        rows = EmployeeService._assigned_skill_rows(
            db, user_id, skill_name, local_id
        )
        if not rows:
            return 0

        employee_ids = {row.employee_id for row in rows}
        employees = {
            emp.id: emp
            for emp in db.scalars(
                select(Employee).where(Employee.id.in_(employee_ids))
            ).all()
        }

        # 先无条件把全部 assignee 行写成库版本（含 skill_content）。这对「已私改」的
        # assignee 是暂时性错值——会在下方循环里被无条件的 reconcile 从其私有磁盘纠回。
        # 安全：db.commit() 延后到所有 reconcile 之后，中途任一 reconcile 抛错则整体回滚，
        # 不会把这里的暂时错值落库。
        for row in rows:
            row.skill_name_zh = display_name_zh or ""
            if description is not None:
                row.skill_description = description
            if skill_md_content is not None:
                row.skill_content = skill_md_content

        from src.service import skill_provenance
        for employee_id in employee_ids:
            employee = employees.get(employee_id)
            if employee is None:
                continue

            target_dir = (
                EmployeeService._resolve_skill_root()
                / str(employee.id)
                / "skills"
                / normalized
            )

            # (b) 私有改进优先：已私改(locallyModified)或 grown 的私有副本，不被库版本覆盖。
            # 跳过者也不调 _patch_employee_skills_json（库的显示名/描述不灌给已分叉的副本）——
            # reconcile 会从其私有 meta 派生行，保留员工自己那一整份（含元数据）。
            skip_overwrite = False
            if target_dir.is_dir():
                info = skill_provenance.read_origin(target_dir)
                if info.locally_modified or (info.origin or "").startswith("grown"):
                    skip_overwrite = True

            if not skip_overwrite:
                target_dir.parent.mkdir(parents=True, exist_ok=True)
                if target_dir.exists():
                    shutil.rmtree(target_dir, ignore_errors=True)
                shutil.copytree(skill_dir, target_dir, dirs_exist_ok=False,
                                ignore=shutil.ignore_patterns(".history"))
                EmployeeService._patch_employee_skills_json_for_local_skill(
                    employee,
                    normalized,
                    display_name_zh=display_name_zh,
                    description=description,
                    skill_md_content=skill_md_content,
                )

            # 不论是否覆盖都重投影：被跳过者借此把上方行内写纠回其私有磁盘内容
            EmployeeService.reconcile_employee_skills(db, employee)

        db.commit()
        logger.info(
            "Synced local skill %r to %s employee(s) for user %s (source workspace %s)",
            normalized,
            len(employee_ids),
            user_id,
            workspace_id,
        )
        return len(employee_ids)

    @staticmethod
    def unassign_local_skill_from_assignees(
        db: Session,
        *,
        user_id: str,
        skill_name: str,
        local_id: int | None = None,
    ) -> int:
        """删除本地技能时，同步解除已分配员工的绑定与私有目录副本（按 user 过滤）。"""
        normalized = LocalSkillService._normalize_skill_name(skill_name)
        rows = EmployeeService._assigned_skill_rows(
            db, user_id, skill_name, local_id
        )
        if not rows:
            return 0

        employee_ids = {row.employee_id for row in rows}
        employees = {
            emp.id: emp
            for emp in db.scalars(
                select(Employee).where(Employee.id.in_(employee_ids))
            ).all()
        }

        for row in rows:
            db.delete(row)

        for employee_id in employee_ids:
            employee = employees.get(employee_id)
            if employee is None:
                continue

            target_dir = (
                EmployeeService._resolve_skill_root()
                / str(employee.id)
                / "skills"
                / normalized
            )
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)

            try:
                data = json.loads(employee.skills_json or "[]")
            except json.JSONDecodeError:
                data = []
            if isinstance(data, list) and data:
                first = data[0]
                if isinstance(first, dict) and "skills_dir" not in first:
                    filtered = [
                        item
                        for item in data
                        if isinstance(item, dict)
                        and str(item.get("skillName") or "").strip() != normalized
                    ]
                    employee.skills_json = json.dumps(
                        filtered, ensure_ascii=False
                    )

            # 收口走 reconcile：rmtree 已移除该技能磁盘目录，投影据此收敛 EmployeeSkill 行。
            EmployeeService.reconcile_employee_skills(db, employee)

        db.commit()
        logger.info(
            "Unassigned local skill %r from %s employee(s) for user %s",
            normalized,
            len(employee_ids),
            user_id,
        )
        return len(employee_ids)

    @staticmethod
    def _employee_skill_name_set(db: Session, employee: Employee) -> set[str]:
        names: set[str] = set()
        for row in EmployeeService._employee_skills_snapshot(db, employee):
            n = str(row.get("skillName") or row.get("skill_name") or "").strip()
            if n:
                names.add(n)
        return names

    @staticmethod
    def ensure_builtin_seed_employees(
        db: Session, user_id: str | None, workspace_id: int
    ) -> None:
        """将本地技能目录（含启动时同步的内置技能）绑定到默认种子员工；按用户+名称幂等。

        存在性按 (user_id, name) 判定；创建时同时盖 user_id 与 workspace_id
        （后者为过渡期的装饰性列）。
        """
        # 防御式同步：避免调用方未先执行 seed_builtin_skills 时找不到新增内置技能。
        LocalSkillService.seed_builtin_skills()
        local_root = LocalSkillService._resolve_local_root().resolve()
        logger.info(local_root)
        for name, skill_names, description in _BUILTIN_SEED_EMPLOYEES:
            expected = frozenset(skill_names)
            existing = db.scalar(
                select(Employee).where(
                    Employee.user_id == user_id,
                    Employee.name == name,
                )
            )
            if existing is not None:
                got = EmployeeService._employee_skill_name_set(db, existing)
                if got == expected:
                    logger.info(
                        "Builtin seed: skip employee (already satisfied): name=%s",
                        name,
                    )
                    continue
                logger.warning(
                    "Builtin seed: skip employee (name exists, skills differ): "
                    "name=%s expected=%s got=%s",
                    name,
                    sorted(expected),
                    sorted(got),
                )
                continue

            payloads = EmployeeService._builtin_seed_skill_payloads(
                local_root, skill_names
            )
            if payloads is None:
                logger.warning(
                    "Builtin seed: skip employee (skill check failed): name=%s",
                    name,
                )
                continue

            meta = {"employee_name": name, "status": 1}
            employee = Employee(
                user_id=user_id,
                workspace_id=workspace_id,
                employee_code=_new_pending_employee_code(),
                name=name,
                description=description,
                version="",
                skills_json="[]",
                meta_json=json.dumps(meta, ensure_ascii=False),
                shift_schedule_json="{}",
            )
            db.add(employee)
            db.flush()
            employee.employee_code = str(employee.id)

            EmployeeService._replace_employee_mcps(db, employee, [])
            EmployeeService._replace_shift_schedule(db, employee, None)
            employee.skills_json = EmployeeService._build_skills_json_payload(
                employee,
                [],
                payloads,
            )
            EmployeeService.reconcile_employee_skills(db, employee)
            db.commit()
            db.refresh(employee)
            logger.info(
                "Builtin seed: created employee id=%s name=%s skills=%s",
                employee.id,
                name,
                list(skill_names),
            )

    @staticmethod
    def create_employee(db: Session, obj_in: EmployeeCreate, token: str) -> Employee:
        workspace_id = obj_in.workspace_id or get_settings().default_workspace_id
        workspace = WorkspaceService.get_workspace(db, workspace_id)
        # 员工为用户级：归属以 workspace owner 为权威，未认领（owner=None）的
        # 工作空间回落到招聘侧传入的 obj_in.user_id（运行时用户）。
        owner_user_id = workspace.user_id or obj_in.user_id or DEFAULT_USER_ID

        existing = db.scalar(
            select(Employee).where(
                Employee.user_id == owner_user_id,
                Employee.name == obj_in.employee_name,
            )
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="员工名称已存在")

        skill_ids = obj_in.skill_ids or []
        remote_skills, local_skills = EmployeeService._resolve_skills_for_assignment(
            skill_ids,
            workspace_id=workspace_id,
            token=token,
        )
        mcp_details = EmployeeService._validate_and_fetch_mcps(obj_in.mcp_ids, token)

        tasks = EmployeeService._normalize_tasks(obj_in.tasks)
        shift_schedule = obj_in.shift_schedule
        meta = {
            "status": obj_in.status,
            "detail_page_url": obj_in.detail_page_url,
            "user_id": obj_in.user_id,
            "employee_name": obj_in.employee_name,
        }

        employee = Employee(
            user_id=owner_user_id,
            workspace_id=workspace_id,
            employee_code=_new_pending_employee_code(),
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

        EmployeeService._replace_employee_mcps(db, employee, mcp_details)
        EmployeeService._replace_shift_schedule(db, employee, shift_schedule)
        employee.skills_json = EmployeeService._build_skills_json_payload(
            employee,
            remote_skills,
            local_skills,
        )
        EmployeeService.reconcile_employee_skills(db, employee)
        db.commit()
        db.refresh(employee)

        if tasks:
            TaskService.upsert_employee_tasks(db, workspace_id, employee.id, tasks)
            db.refresh(employee)
            TaskSchedulerService.reload_jobs()
        return employee

    @staticmethod
    def build_employee_growth_brain(db: Session, employee_id: int) -> dict:
        """聚合员工大脑(profile/技能/记忆/journal)只读展示数据。缺失给空。容错。"""
        import json as _json
        from src.service.agent.paths import list_available_skills
        from src.service.basic_file_reader import read_text_with_encoding_fallback

        brain = _growth_brain_root_for(employee_id)

        def _read(p: Path) -> str:
            try:
                return read_text_with_encoding_fallback(p) if p.is_file() else ""
            except Exception:
                return ""

        profile_md = _read(brain / "profile.md")
        memories_md = _read(brain / "memories" / "AGENTS.md")
        skills_dir = brain / "skills"
        try:
            skills_list = list_available_skills(skills_dir) if skills_dir.is_dir() else []
        except Exception:
            skills_list = []
        journal_entries: list[dict] = []
        jdir = brain / "journal"
        if jdir.is_dir():
            for fp in sorted(jdir.glob("*.jsonl")):
                try:
                    for line in fp.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            e = _json.loads(line)
                        except ValueError:
                            continue
                        journal_entries.append({
                            "ts": e.get("ts", ""),
                            "task_name": e.get("task_name", ""),
                            "status": e.get("status", ""),
                            "duration_ms": e.get("duration_ms"),
                        })
                except OSError:
                    continue
        journal_entries = journal_entries[-30:]

        # 技能候选（librarian 从重复成功打法自动晋升出的候选，待人确认才转正式技能）
        skill_candidates: list[dict] = []
        cand_dir = brain / "skill_candidates"
        if cand_dir.is_dir():
            for fp in sorted(cand_dir.glob("*.md")):
                meta = EmployeeService._parse_skill_candidate_meta(_read(fp))
                if meta:
                    skill_candidates.append(meta)

        # 技能编辑审计（employee 改过技能时写入，供成长面板消费）
        recent_skill_edits: list[dict] = []
        audit_file = brain / "skill_edits.jsonl"
        if audit_file.is_file():
            try:
                for line in audit_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = _json.loads(line)
                    except ValueError:
                        continue
                    recent_skill_edits.append({
                        "ts": e.get("ts", ""),
                        "skill_name": e.get("skill_name", ""),
                        "reason": e.get("reason", ""),
                        "backup_version": e.get("backup_version"),
                    })
            except OSError:
                pass
        recent_skill_edits = recent_skill_edits[-20:]

        # 技能生命周期（归档/置顶状态），best-effort
        skill_lifecycle: dict = {}
        try:
            from src.service.learning import curator as _curator
            skill_lifecycle = _curator.get_lifecycle_snapshot(brain)
        except Exception:
            skill_lifecycle = {}

        # 员工闲置归档建议（只提示，不自动归档），best-effort
        archive_suggestion = None
        try:
            from src.service.learning import curator as _curator
            archive_suggestion = _curator.employee_archive_suggestion(db, employee_id)
        except Exception:
            archive_suggestion = None

        return {
            "profile_md": profile_md,
            "skills_list": skills_list,
            "memories_md": memories_md,
            "journal_entries": journal_entries,
            "skill_candidates": skill_candidates,
            "recent_skill_edits": recent_skill_edits,
            "skill_lifecycle": skill_lifecycle,
            "archive_suggestion": archive_suggestion,
        }

    @staticmethod
    def _parse_skill_candidate_meta(text: str) -> dict | None:
        """从技能候选 md 的 frontmatter 解析 name/zh/description。无 name 则忽略。"""
        if not text or not text.lstrip().startswith("---"):
            return None
        body = text.lstrip()[3:]
        end = body.find("\n---")
        if end == -1:
            return None
        meta: dict[str, str] = {}
        for line in body[:end].splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        name = meta.get("name", "")
        if not name:
            return None
        return {
            "name": name,
            "zh": meta.get("zh", name),
            "description": meta.get("description", ""),
        }

    @staticmethod
    def _validate_skill_slug(slug: str) -> str:
        """技能候选 slug 必须是小写连字符（防路径穿越）；非法 → 400。"""
        if not slug or not _SKILL_CANDIDATE_SLUG_RE.match(slug):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="非法技能标识（仅允许小写字母、数字、连字符）。",
            )
        return slug

    @staticmethod
    def adopt_skill_candidate(db: Session, employee_id: int, slug: str) -> dict:
        """采纳技能候选 → 转为该员工的正式技能 skills/<slug>/SKILL.md，并消费掉候选。

        人确认动作：候选只有经此才转正。已存在同名 active 技能 → 409 不覆盖。
        """
        EmployeeService.get_employee(db, employee_id)  # 不存在 → 404
        slug = EmployeeService._validate_skill_slug(slug)
        from src.service.basic_file_reader import read_text_with_encoding_fallback

        brain = _growth_brain_root_for(employee_id)
        cand = brain / "skill_candidates" / f"{slug}.md"
        if not cand.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"未找到技能候选「{slug}」。",
            )
        target_dir = brain / "skills" / slug
        if (target_dir / "SKILL.md").is_file():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"已存在同名技能「{slug}」，未覆盖。",
            )
        content = read_text_with_encoding_fallback(cand)
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "SKILL.md").write_text(content, encoding="utf-8")
        # 写标记 + 投影为 best-effort：即便此处失败（如磁盘异常），技能文件已落盘，
        # 下次任一 reconcile 的迁移自愈会把这个无标记目录回填为 grown:adopted 并补 DB 行，
        # 故不因投影失败让整个采纳 500。与下方 cand.unlink() 的容错哲学一致。
        try:
            from src.service import skill_provenance
            skills_root = brain / "skills"
            skill_provenance.write_origin(
                target_dir,
                origin="grown:adopted",
                skill_id=skill_provenance.next_grown_skill_id(skills_root),
            )
            emp = db.get(Employee, employee_id)
            if emp is not None:
                EmployeeService.reconcile_employee_skills(db, emp)
        except Exception:  # noqa: BLE001 - 投影失败不致命，reconcile 自愈兜底
            logger.warning(
                "adopt: provenance/reconcile failed for eid=%s slug=%s (将由后续 reconcile 自愈)",
                employee_id, slug, exc_info=True,
            )
        try:
            cand.unlink()
        except OSError:
            logger.warning("adopt: failed to remove candidate %s", cand, exc_info=True)
        logger.info("adopt_skill_candidate eid=%s slug=%s", employee_id, slug)
        return {"adopted": slug}

    @staticmethod
    def dismiss_skill_candidate(db: Session, employee_id: int, slug: str) -> dict:
        """忽略技能候选 → 删除候选文件（幂等：不存在也算成功）。"""
        EmployeeService.get_employee(db, employee_id)  # 不存在 → 404
        slug = EmployeeService._validate_skill_slug(slug)
        brain = _growth_brain_root_for(employee_id)
        cand = brain / "skill_candidates" / f"{slug}.md"
        if cand.is_file():
            cand.unlink()
        logger.info("dismiss_skill_candidate eid=%s slug=%s", employee_id, slug)
        return {"dismissed": slug}

    @staticmethod
    def restore_skill_lifecycle(db: Session, employee_id: int, skill_name: str) -> dict:
        """手动恢复已归档技能的生命周期状态 → status=active。

        employee_id 不存在 → 404。
        校验 skill_name 防路径穿越（与 _normalize_skill_name 同规则）。
        操作是 best-effort 文件写入。
        """
        EmployeeService.get_employee(db, employee_id)  # 不存在 → 404
        from src.service.local_skill_service import LocalSkillService
        from src.service.learning import curator as _curator

        name = LocalSkillService._normalize_skill_name(skill_name)
        brain = _growth_brain_root_for(employee_id)
        _curator.restore_skill(brain, name)
        logger.info("restore_skill_lifecycle eid=%s skill=%s", employee_id, name)
        return {"skillName": name, "status": "active"}

    @staticmethod
    def set_skill_pinned(db: Session, employee_id: int, skill_name: str, pinned: bool) -> dict:
        """设置技能置顶（pinned=True 永不老化）或取消置顶。

        employee_id 不存在 → 404。
        校验 skill_name 防路径穿越。
        """
        EmployeeService.get_employee(db, employee_id)  # 不存在 → 404
        from src.service.local_skill_service import LocalSkillService
        from src.service.learning import curator as _curator

        name = LocalSkillService._normalize_skill_name(skill_name)
        brain = _growth_brain_root_for(employee_id)
        _curator.set_pinned(brain, name, pinned)
        logger.info("set_skill_pinned eid=%s skill=%s pinned=%s", employee_id, name, pinned)
        return {"skillName": name, "pinned": pinned}
