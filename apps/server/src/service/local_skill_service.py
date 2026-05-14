from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

from fastapi import HTTPException, status

from src.core.config import get_settings

logger = logging.getLogger(__name__)


class LocalSkillService:
    META_FILE_NAME = ".skill-meta.json"
    SKILL_MD_NAME = "SKILL.md"
    SKILL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")

    @staticmethod
    def _resolve_local_root(workspace_id: int | None = None) -> Path:
        settings = get_settings()
        base_path = Path(os.path.expandvars(os.path.expanduser(settings.local_skills_path)))
        if workspace_id is None:
            # workspace_id=None 表示访问共享的 builtin 目录
            return base_path / "builtin"
        return base_path / str(workspace_id)

    @staticmethod
    def _resolve_builtin_root() -> Path:
        return LocalSkillService._resolve_local_root(None)

    @staticmethod
    def _resolve_packaged_builtin_skills_root() -> Path:
        settings = get_settings()
        configured_root = Path(
            os.path.expandvars(os.path.expanduser(settings.builtin_skills_path))
        )
        source_relative_root = Path(__file__).resolve().parents[1] / "build-in-skills"
        executable_relative_root = Path(sys.executable).resolve().parent / "build-in-skills"

        candidates: list[Path] = [
            configured_root,
            executable_relative_root,
            source_relative_root,
        ]
        # PyInstaller onefile 兜底：资源被展开到 _MEIPASS 临时目录。
        if hasattr(sys, "_MEIPASS"):
            meipass_root = Path(getattr(sys, "_MEIPASS")) / "src" / "build-in-skills"
            candidates.append(meipass_root)

        for candidate in candidates:
            if candidate.is_dir():
                return candidate

        # 返回配置路径，调用方会记录日志并跳过同步。
        return configured_root

    @staticmethod
    def _normalize_skill_name(skill_name: str) -> str:
        normalized = (skill_name or "").strip()
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="skillName 不能为空。",
            )
        if not LocalSkillService.SKILL_NAME_PATTERN.match(normalized):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "skillName 格式非法，仅允许字母、数字、下划线、短横线，且不能以符号开头。"
                ),
            )
        return normalized

    @staticmethod
    def _skill_dir(skill_name: str, workspace_id: int | None = None) -> Path:
        return LocalSkillService._resolve_local_root(workspace_id) / skill_name

    @staticmethod
    def _safe_member_path(base: Path, member: str) -> Path:
        target = (base / member).resolve()
        if not target.is_relative_to(base.resolve()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ZIP 包含非法路径: {member}",
            )
        return target

    @staticmethod
    def _read_meta(skill_dir: Path) -> dict:
        meta_file = skill_dir / LocalSkillService.META_FILE_NAME
        if not meta_file.exists():
            return {}
        try:
            loaded = json.loads(meta_file.read_text(encoding="utf-8"))
            return loaded if isinstance(loaded, dict) else {}
        except (OSError, json.JSONDecodeError):
            logger.warning("读取技能元数据失败: %s", meta_file)
            return {}

    @staticmethod
    def _write_meta(skill_dir: Path, meta: dict) -> None:
        meta_file = skill_dir / LocalSkillService.META_FILE_NAME
        meta_file.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _parse_local_id(raw: object) -> int | None:
        try:
            value = int(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if value >= 0:
            return None
        return value

    @staticmethod
    def _next_local_id(local_root: Path) -> int:
        existing_ids: list[int] = []
        if local_root.exists():
            for skill_dir in local_root.iterdir():
                if not skill_dir.is_dir():
                    continue
                meta = LocalSkillService._read_meta(skill_dir)
                local_id = LocalSkillService._parse_local_id(meta.get("localId"))
                if local_id is not None:
                    existing_ids.append(local_id)
        if not existing_ids:
            return -1
        return min(existing_ids) - 1

    @staticmethod
    def _decode_zip_member_name(raw_name: str, is_utf8: bool) -> str:
        if not raw_name:
            return raw_name
        if is_utf8:
            return raw_name
        try:
            # 一些 Windows 压缩工具会把 GBK 文件名写入 ZIP，
            # 但未设置 UTF-8 标志，Python 会按 cp437 解码后出现乱码。
            return raw_name.encode("cp437").decode("gbk")
        except UnicodeError:
            return raw_name

    @staticmethod
    def _extract_zip_to_temp(file_bytes: bytes) -> Path:
        temp_dir = Path(tempfile.mkdtemp(prefix="local-skill-import-"))
        try:
            with ZipFile(io.BytesIO(file_bytes), "r") as zip_file:
                members = [
                    info for info in zip_file.infolist() if info.filename and not info.is_dir()
                ]
                if not members:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="ZIP 文件为空或不包含有效文件。",
                    )
                for member in members:
                    is_utf8 = bool(member.flag_bits & 0x800)
                    member_name = LocalSkillService._decode_zip_member_name(
                        member.filename,
                        is_utf8,
                    )
                    if member_name.startswith("__MACOSX/"):
                        continue
                    target = LocalSkillService._safe_member_path(temp_dir, member_name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zip_file.open(member, "r") as src, target.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
        except BadZipFile as exc:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="上传文件不是有效 ZIP。",
            ) from exc
        return temp_dir

    @staticmethod
    def _detect_skill_source_root(temp_dir: Path) -> Path:
        direct_skill_md = temp_dir / LocalSkillService.SKILL_MD_NAME
        if direct_skill_md.exists():
            return temp_dir

        skill_md_files = list(temp_dir.rglob(LocalSkillService.SKILL_MD_NAME))
        if len(skill_md_files) == 1:
            return skill_md_files[0].parent
        if len(skill_md_files) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ZIP 中包含多个 SKILL.md，无法确定唯一技能目录。",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ZIP 中未找到 SKILL.md，非标准技能包。",
        )

    @staticmethod
    def _extract_description_from_skill_md(skill_md_path: Path) -> str:
        try:
            content = skill_md_path.read_text(encoding="utf-8")
        except OSError:
            return ""

        frontmatter = re.match(r"^\s*---\s*\r?\n(.*?)\r?\n---\s*", content, re.DOTALL)
        if not frontmatter:
            return ""

        match = re.search(
            r"(?im)^\s*description\s*[:：]\s*(.+?)\s*$",
            frontmatter.group(1),
        )
        if not match:
            return ""

        description = match.group(1).strip().strip("\"'")
        return description

    @staticmethod
    def seed_builtin_skills() -> dict[str, int]:
        """
        将包内 build-in-skills 同步到 LOCAL_SKILLS_PATH/builtin（共享目录）。
        内置技能对所有 workspace 共享，用户自定义技能放在各自的 workspace 子目录。
        """
        source_root = LocalSkillService._resolve_packaged_builtin_skills_root().resolve()
        local_root = LocalSkillService._resolve_builtin_root().resolve()
        logger.info("source_root: %s", source_root)
        logger.info("local_root: %s", local_root)
        if not source_root.is_dir():
            logger.info("Skip builtin skill seed: packaged source missing %s", source_root)
            return {"copied_items": 0}

        local_root.mkdir(parents=True, exist_ok=True)
        copied_items = 0
        for item in sorted(source_root.iterdir(), key=lambda p: p.name.lower()):
            if not item.is_dir():
                continue
            if not LocalSkillService.SKILL_NAME_PATTERN.match(item.name):
                logger.warning(
                    "Skip non-skill directory in build-in-skills: %s", item.name
                )
                continue
            skill_md = item / LocalSkillService.SKILL_MD_NAME
            if not skill_md.is_file():
                logger.warning(
                    "Skip packaged skill without SKILL.md: %s", item
                )
                continue

            normalized = item.name
            target_dir = local_root / normalized
            existing_meta = LocalSkillService._read_meta(target_dir)
            existing_local_id = LocalSkillService._parse_local_id(
                existing_meta.get("localId")
            )

            shutil.copytree(item, target_dir, dirs_exist_ok=True)

            local_id = (
                existing_local_id
                if existing_local_id is not None
                else LocalSkillService._next_local_id(local_root)
            )
            description = LocalSkillService._extract_description_from_skill_md(
                target_dir / LocalSkillService.SKILL_MD_NAME
            )
            meta = {
                "skillName": normalized,
                "localId": local_id,
                "sourceFileName": "builtin:build-in-skills",
                "importedAt": datetime.now().isoformat(timespec="seconds"),
                "overwrite": True,
                "description": description,
            }
            LocalSkillService._write_meta(target_dir, meta)
            copied_items += 1

        logger.info(
            "Seeded builtin skills into local-skills: source=%s target=%s copied_items=%s",
            source_root,
            local_root,
            copied_items,
        )
        return {"copied_items": copied_items}

    @staticmethod
    def local_skill_exists(skill_name: str, workspace_id: int | None = None) -> bool:
        normalized = LocalSkillService._normalize_skill_name(skill_name)
        return LocalSkillService._skill_dir(normalized, workspace_id).is_dir()

    @staticmethod
    def import_local_skill_zip(
        skill_name: str,
        file_name: str,
        file_bytes: bytes,
        overwrite: bool = False,
        workspace_id: int | None = None,
    ) -> dict:
        settings = get_settings()
        normalized = LocalSkillService._normalize_skill_name(skill_name)
        if len(file_bytes) > settings.client_skill_import_max_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"上传文件超过大小限制: {settings.client_skill_import_max_bytes} 字节。"
                ),
            )
        already_exists = LocalSkillService.local_skill_exists(normalized, workspace_id)
        if already_exists and not overwrite:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"本地已存在同名技能: {normalized}",
            )

        temp_dir = LocalSkillService._extract_zip_to_temp(file_bytes)
        try:
            source_root = LocalSkillService._detect_skill_source_root(temp_dir)
            description = LocalSkillService._extract_description_from_skill_md(
                source_root / LocalSkillService.SKILL_MD_NAME
            )
            local_root = LocalSkillService._resolve_local_root(workspace_id)
            local_root.mkdir(parents=True, exist_ok=True)
            target_dir = local_root / normalized
            existing_local_id: int | None = None
            if target_dir.exists():
                existing_meta = LocalSkillService._read_meta(target_dir)
                existing_local_id = LocalSkillService._parse_local_id(
                    existing_meta.get("localId")
                )
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
            shutil.copytree(source_root, target_dir, dirs_exist_ok=False)
            local_id = (
                existing_local_id
                if existing_local_id is not None
                else LocalSkillService._next_local_id(local_root)
            )
            meta = {
                "skillName": normalized,
                "localId": local_id,
                "sourceFileName": file_name,
                "importedAt": datetime.now().isoformat(timespec="seconds"),
                "overwrite": overwrite,
                "description": description,
            }
            LocalSkillService._write_meta(target_dir, meta)
            return {
                "skillName": normalized,
                "localId": local_id,
                "path": str(target_dir),
                "overwritten": already_exists and overwrite,
            }
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @staticmethod
    def list_local_skills(workspace_id: int | None = None) -> list[dict]:
        """
        列出本地技能，返回 builtin（共享）+ workspace 自定义技能的合并列表。
        workspace_id=None 时仅返回 builtin 技能。
        """
        items: list[dict] = []
        builtin_root = LocalSkillService._resolve_builtin_root()

        def _load_skills_from_dir(root: Path) -> list[dict]:
            if not root.exists():
                return []
            dir_items: list[dict] = []
            next_id = LocalSkillService._next_local_id(root)
            for skill_dir in sorted(root.iterdir(), key=lambda p: p.name.lower()):
                if not skill_dir.is_dir():
                    continue
                meta = LocalSkillService._read_meta(skill_dir)
                local_id = LocalSkillService._parse_local_id(meta.get("localId"))
                if local_id is None:
                    local_id = next_id
                    next_id -= 1
                    meta["localId"] = local_id
                    meta["skillName"] = meta.get("skillName") or skill_dir.name
                    LocalSkillService._write_meta(skill_dir, meta)
                dir_items.append(
                    {
                        "skillName": skill_dir.name,
                        "localId": local_id,
                        "path": str(skill_dir),
                        "hasSkillMd": (skill_dir / LocalSkillService.SKILL_MD_NAME).exists(),
                        "importedAt": meta.get("importedAt"),
                    }
                )
            return dir_items

        # 总是包含 builtin 技能
        items.extend(_load_skills_from_dir(builtin_root))

        # 如果指定了 workspace_id，再添加该 workspace 的自定义技能
        # 同名技能会被 workspace 自定义版本覆盖
        if workspace_id is not None:
            workspace_root = LocalSkillService._resolve_local_root(workspace_id)
            workspace_skills = _load_skills_from_dir(workspace_root)
            skill_map = {item["skillName"]: item for item in items}
            for skill in workspace_skills:
                skill_map[skill["skillName"]] = skill
            items = list(skill_map.values())

        return items

    @staticmethod
    def get_local_skill_detail(skill_name: str, workspace_id: int | None = None) -> dict:
        normalized = LocalSkillService._normalize_skill_name(skill_name)

        # 先查找 workspace 自定义版本，如果找不到则用 builtin 版本
        if workspace_id is not None:
            skill_dir = LocalSkillService._skill_dir(normalized, workspace_id)
            if skill_dir.is_dir():
                return LocalSkillService._build_skill_detail(normalized, skill_dir)

        # 使用 builtin 版本
        skill_dir = LocalSkillService._skill_dir(normalized, None)
        if not skill_dir.is_dir():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"未找到本地技能: {normalized}",
            )
        return LocalSkillService._build_skill_detail(normalized, skill_dir)

    @staticmethod
    def _build_skill_detail(skill_name: str, skill_dir: Path) -> dict:
        meta = LocalSkillService._read_meta(skill_dir)
        skill_md = skill_dir / LocalSkillService.SKILL_MD_NAME
        skill_md_content = (
            skill_md.read_text(encoding="utf-8") if skill_md.exists() else None
        )
        files: list[str] = []
        for path in sorted(skill_dir.rglob("*")):
            if path.is_file():
                files.append(path.relative_to(skill_dir).as_posix())
        return {
            "skillName": skill_name,
            "localId": LocalSkillService._parse_local_id(meta.get("localId")),
            "path": str(skill_dir),
            "importedAt": meta.get("importedAt"),
            "skillMdContent": skill_md_content,
            "files": files,
        }

    @staticmethod
    def build_local_skill_zip(skill_name: str, workspace_id: int | None = None) -> tuple[str, bytes]:
        normalized = LocalSkillService._normalize_skill_name(skill_name)

        if workspace_id is not None:
            skill_dir = LocalSkillService._skill_dir(normalized, workspace_id)
            if skill_dir.is_dir():
                return LocalSkillService._build_skill_zip(normalized, skill_dir)

        skill_dir = LocalSkillService._skill_dir(normalized, None)
        if not skill_dir.is_dir():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"未找到本地技能: {normalized}",
            )
        if not (skill_dir / LocalSkillService.SKILL_MD_NAME).exists():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"本地技能目录缺少 {LocalSkillService.SKILL_MD_NAME}: {normalized}",
            )
        return LocalSkillService._build_skill_zip(normalized, skill_dir)

    @staticmethod
    def _build_skill_zip(skill_name: str, skill_dir: Path) -> tuple[str, bytes]:
        buffer = io.BytesIO()
        with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as zip_file:
            for path in sorted(skill_dir.rglob("*")):
                if not path.is_file():
                    continue
                arcname = path.relative_to(skill_dir).as_posix()
                zip_file.write(path, arcname)
        return f"{skill_name}.zip", buffer.getvalue()
