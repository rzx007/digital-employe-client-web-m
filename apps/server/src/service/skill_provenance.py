"""员工私有技能副本的来源标记（provenance）：复用 .skill-meta.json，
不引入新文件约定。磁盘是唯一真相，本模块只负责读写标记 + 扫描。"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# TODO(债): 复用 LocalSkillService 的私有 _read_meta/_write_meta（计划已采纳此复用）。
# 待 LocalSkillService 拆分时，改为它暴露的公共 read_skill_meta/write_skill_meta。
from src.service.local_skill_service import LocalSkillService

SKILL_MD = LocalSkillService.SKILL_MD_NAME


@dataclass
class SkillOrigin:
    name: str
    origin: str | None            # "assigned" | "grown:adopted" | None(未标记)
    skill_id: int | None
    locally_modified: bool
    display_name_zh: str | None
    description: str | None
    prompt: str | None


def _is_skill_dir(p: Path) -> bool:
    return p.is_dir() and (p / SKILL_MD).is_file()


def read_origin(skill_dir: Path) -> SkillOrigin:
    meta = LocalSkillService._read_meta(skill_dir)
    sid = meta.get("skillId")
    try:
        sid = int(sid) if sid is not None else None
    except (TypeError, ValueError):
        sid = None
    return SkillOrigin(
        name=skill_dir.name,
        origin=(meta.get("origin") or None),
        skill_id=sid,
        locally_modified=bool(meta.get("locallyModified", False)),
        display_name_zh=(meta.get("displayNameZh") or None),
        description=(meta.get("description") or None),
        prompt=(meta.get("prompt") or None),
    )


def write_origin(
    skill_dir: Path,
    *,
    origin: str,
    skill_id: int,
    locally_modified: bool | None = None,
    prompt: str | None = None,
    display_name_zh: str | None = None,
    description: str | None = None,
) -> None:
    """合并写入标记到 .skill-meta.json（保留已有键）。"""
    meta = LocalSkillService._read_meta(skill_dir)
    meta["origin"] = origin
    meta["skillId"] = skill_id
    if locally_modified is not None:
        meta["locallyModified"] = bool(locally_modified)
    elif "locallyModified" not in meta:
        meta["locallyModified"] = False
    if prompt is not None:
        meta["prompt"] = prompt
    if display_name_zh is not None:
        meta["displayNameZh"] = display_name_zh
    if description is not None:
        meta["description"] = description
    LocalSkillService._write_meta(skill_dir, meta)


def set_locally_modified(skill_dir: Path, value: bool = True) -> None:
    meta = LocalSkillService._read_meta(skill_dir)
    meta["locallyModified"] = bool(value)
    LocalSkillService._write_meta(skill_dir, meta)


def scan_employee_skills(skills_root: Path) -> list[SkillOrigin]:
    if not skills_root.is_dir():
        return []
    return [
        read_origin(child)
        for child in sorted(skills_root.iterdir())
        if _is_skill_dir(child)
    ]


def next_grown_skill_id(skills_root: Path) -> int:
    """返回当前扫描时刻该员工目录内唯一的负数合成 id（grown 技能用）。

    调用方须立即 write_origin 写入该 id 以声明占用。并发对同一员工采纳多个技能时
    存在 TOCTOU 窗口，最终由 EmployeeSkill 的 (employee_id, skill_id) 唯一约束兜底。
    """
    existing = [s.skill_id for s in scan_employee_skills(skills_root) if s.skill_id is not None]
    return min([*existing, 0]) - 1
