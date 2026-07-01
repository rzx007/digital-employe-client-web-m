"""解析内置 skill-creator 技能源目录，供 get_agent 运行时全员注入。"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_SKILL_CREATOR_NAME = "skill-creator"


def _candidate_skill_creator_dirs() -> list[Path]:
    """候选源目录，优先已 seed 的 local-skills/builtin，回退打包源 build-in-skills。"""
    from src.service.local_skill_service import LocalSkillService

    candidates: list[Path] = []
    try:
        builtin_root = LocalSkillService._resolve_builtin_root()  # local-skills/builtin
        candidates.append(builtin_root / _SKILL_CREATOR_NAME)
    except Exception as exc:  # noqa: BLE001 - 路径解析失败不致命
        logger.warning("resolve builtin_root for skill-creator failed: %s", exc)
    try:
        packaged_root = LocalSkillService._resolve_packaged_builtin_skills_root()
        candidates.append(packaged_root / _SKILL_CREATOR_NAME)
    except Exception as exc:  # noqa: BLE001
        logger.warning("resolve packaged build-in-skills root failed: %s", exc)
    return candidates


def resolve_builtin_skill_creator_source() -> Path | None:
    """返回首个存在且含 SKILL.md 的 skill-creator 目录；都缺失返回 None（不致命）。"""
    for cand in _candidate_skill_creator_dirs():
        if cand.is_dir() and (cand / "SKILL.md").is_file():
            return cand
    logger.info("skill-creator source not found in any candidate; skip injection")
    return None
