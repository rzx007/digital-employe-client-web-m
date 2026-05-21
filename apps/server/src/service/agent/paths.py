import logging
import os
from pathlib import Path

from src.core.config import get_settings

logger = logging.getLogger(__name__)

# src/service/agent — AGENTS.md 与 /agent/ 虚拟路径根目录
SERVICE_DIR = Path(__file__).resolve().parent

# apps/server — 与 src 同级的技能目录
SERVER_ROOT = Path(__file__).resolve().parents[3]
BUILD_IN_SKILLS_DIR = SERVER_ROOT / "build-in-skills"
ORCHESTRATOR_SKILLS_DIR = SERVER_ROOT / "orchestrator_skills"

_EMPLOYEE_MEMORY_TEMPLATE = """# 员工长期记忆

## 用户偏好
（暂无）

## 已知事实与约定
（暂无）

---
说明：用户明确要求「记住」的信息请更新本文件；可另建 /memories/ 下其他 .md，但本文件会在每次对话开始时自动加载，请保持简洁。
"""


def resolve_skills_root(skill_path: str) -> Path:
    raw = (skill_path or "").strip()
    if not raw:
        return SERVICE_DIR / "skills"

    p = Path(raw).resolve()
    if p.is_file() and p.name.lower() == "skill.md":
        return p.parent.parent
    if p.is_dir() and p.name.lower() == "skills":
        return p
    if p.is_dir() and (p / "SKILL.md").exists():
        return p.parent
    if p.is_dir() and (p / "skills").is_dir():
        return p / "skills"
    return p


def resolve_orchestrator_skills_root() -> Path:
    """总管助手固定技能目录（apps/server/orchestrator_skills）。"""
    root = ORCHESTRATOR_SKILLS_DIR.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_available_skills(skills_root: Path) -> list[str]:
    if not skills_root.is_dir():
        return []
    return sorted(
        child.name
        for child in skills_root.iterdir()
        if child.is_dir() and (child / "SKILL.md").is_file()
    )


def ensure_employee_memory_file(memories_dir: Path) -> None:
    """若员工记忆文件不存在则写入默认模板（不覆盖已有内容）。"""
    memory_file = memories_dir / "AGENTS.md"
    if memory_file.is_file():
        return
    memory_file.write_text(_EMPLOYEE_MEMORY_TEMPLATE, encoding="utf-8")
    logger.info("Seeded employee memory file: %s", memory_file)


def resolve_employee_memories_dir(
    *,
    employee_id: int | None = None,
    skills_root: Path | None = None,
    base_dir: Path | None = None,
) -> Path:
    """解析员工长期记忆目录（/memories/ 物理根）。"""
    if employee_id is not None and skills_root is not None:
        resolved_skills = skills_root.resolve()
        if resolved_skills.is_dir() and resolved_skills.name.lower() == "skills":
            return resolved_skills.parent / "memories"
    if employee_id is not None:
        settings = get_settings()
        skill_root = Path(os.path.expandvars(os.path.expanduser(settings.skill_path)))
        if not skill_root.is_absolute():
            skill_root = (Path.cwd() / skill_root).resolve()
        employee_root = skill_root / str(employee_id)
        employee_root.mkdir(parents=True, exist_ok=True)
        return employee_root / "memories"
    base = (base_dir or SERVICE_DIR).resolve()
    return base / "memories"
