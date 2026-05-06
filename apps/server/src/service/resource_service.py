from __future__ import annotations

import logging
from pathlib import Path

from src.schemas.resource import (
    ResourceContent,
    ResourceEntry,
    ResourceList,
    ResourceUploadResult,
)
from src.service.agent import infer_artifact_language, infer_artifact_type

logger = logging.getLogger(__name__)

_ALLOWED_PREFIXES = ("/artifacts/", "/skills-draft/", "/uploads/")

ALLOWED_UPLOAD_EXTENSIONS: set[str] = {
    ".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".conf", ".log", ".env",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss",
    ".less", ".vue", ".svelte", ".java", ".go", ".rs", ".c", ".cpp",
    ".h", ".hpp", ".cs", ".rb", ".php", ".swift", ".kt", ".scala",
    ".sh", ".bash", ".zsh", ".sql", ".r", ".m",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".geojson", ".jsonl", ".ndjson",
}

MAX_UPLOAD_FILE_SIZE = 200 * 1024 * 1024


def _resolve_safe_path(conversation_dir: Path, virtual_path: str) -> Path | None:
    rel = virtual_path.lstrip("/")
    target = (conversation_dir / rel).resolve()
    try:
        target.relative_to(conversation_dir.resolve())
    except ValueError:
        return None
    return target


def _scan_file(file_path: Path, virtual_prefix: str) -> ResourceEntry:
    ext = file_path.suffix.lstrip(".")
    vpath = virtual_prefix + file_path.name
    return ResourceEntry(
        name=file_path.name,
        path=vpath,
        entry_type="file",
        artifact_type=infer_artifact_type(vpath),
        size=file_path.stat().st_size if file_path.is_file() else 0,
        modified_at=file_path.stat().st_mtime if file_path.is_file() else None,
    )


def _scan_dir_flat(directory: Path, virtual_prefix: str) -> list[ResourceEntry]:
    if not directory.is_dir():
        return []
    entries: list[ResourceEntry] = []
    for item in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if item.is_dir():
            children = _scan_dir_flat(item, virtual_prefix + item.name + "/")
            entries.append(
                ResourceEntry(
                    name=item.name,
                    path=virtual_prefix + item.name,
                    entry_type="directory",
                    children=children,
                )
            )
        else:
            entries.append(_scan_file(item, virtual_prefix))
    return entries


def _scan_skills_draft(directory: Path) -> list[ResourceEntry]:
    if not directory.is_dir():
        return []
    entries: list[ResourceEntry] = []
    for skill_dir in sorted(directory.iterdir(), key=lambda p: p.name.lower()):
        if not skill_dir.is_dir():
            continue
        children: list[ResourceEntry] = []
        for item in sorted(skill_dir.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if item.is_dir():
                sub_children = _scan_dir_flat(item, f"/skills-draft/{skill_dir.name}/{item.name}/")
                children.append(
                    ResourceEntry(
                        name=item.name,
                        path=f"/skills-draft/{skill_dir.name}/{item.name}",
                        entry_type="directory",
                        children=sub_children,
                    )
                )
            else:
                children.append(_scan_file(item, f"/skills-draft/{skill_dir.name}/"))
        entries.append(
            ResourceEntry(
                name=skill_dir.name,
                path=f"/skills-draft/{skill_dir.name}",
                entry_type="directory",
                artifact_type="skill-draft",
                children=children,
            )
        )
    return entries


class ResourceService:
    @staticmethod
    def list_resources(root_path: str, conversation_id: int) -> ResourceList:
        conversation_dir = Path(root_path) / str(conversation_id)
        artifacts_dir = conversation_dir / "artifacts"
        skills_draft_dir = conversation_dir / "skills-draft"
        uploads_dir = conversation_dir / "uploads"

        return ResourceList(
            artifacts=_scan_dir_flat(artifacts_dir, "/artifacts/"),
            uploads=_scan_dir_flat(uploads_dir, "/uploads/"),
            skills_draft=_scan_skills_draft(skills_draft_dir),
        )

    @staticmethod
    def read_content(root_path: str, conversation_id: int, path: str) -> ResourceContent | None:
        if not any(path.startswith(prefix) for prefix in _ALLOWED_PREFIXES):
            return None

        conversation_dir = Path(root_path) / str(conversation_id)
        resolved = _resolve_safe_path(conversation_dir, path)
        if resolved is None or not resolved.is_file():
            return None

        try:
            content = resolved.read_text(encoding="utf-8")
        except Exception as exc:
            logger.error("读取资源文件失败 path=%s: %s", path, exc, exc_info=True)
            return None

        return ResourceContent(
            path=path,
            content=content,
            artifact_type=infer_artifact_type(path),
            language=infer_artifact_language(path),
        )

    @staticmethod
    def upload_file(
        root_path: str,
        conversation_id: int,
        filename: str,
        file_bytes: bytes,
    ) -> ResourceUploadResult | str:
        if len(file_bytes) > MAX_UPLOAD_FILE_SIZE:
            return f"文件大小超过限制（最大 {MAX_UPLOAD_FILE_SIZE // (1024*1024)}MB）"

        ext = Path(filename).suffix.lower()
        if ext and ext not in ALLOWED_UPLOAD_EXTENSIONS:
            return f"不支持的文件类型：{ext}"

        safe_name = Path(filename).name
        if not safe_name or safe_name.startswith("."):
            return "文件名不合法"

        conversation_dir = Path(root_path) / str(conversation_id)
        uploads_dir = conversation_dir / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)

        target_path = uploads_dir / safe_name
        if target_path.exists():
            stem = target_path.stem
            suffix = target_path.suffix
            counter = 1
            while target_path.exists():
                target_path = uploads_dir / f"{stem}_{counter}{suffix}"
                counter += 1

        try:
            target_path.resolve().relative_to(uploads_dir.resolve())
        except ValueError:
            return "文件路径不合法"

        target_path.write_bytes(file_bytes)

        virtual_path = "/uploads/" + target_path.name

        return ResourceUploadResult(
            name=target_path.name,
            path=virtual_path,
            size=len(file_bytes),
        )

    @staticmethod
    def delete_upload_file(
        root_path: str, conversation_id: int, virtual_path: str
    ) -> bool:
        if not virtual_path.startswith("/uploads/"):
            return False

        conversation_dir = Path(root_path) / str(conversation_id)
        resolved = _resolve_safe_path(conversation_dir, virtual_path)
        if resolved is None or not resolved.is_file():
            return False

        try:
            resolved.resolve().relative_to(
                (conversation_dir / "uploads").resolve()
            )
        except ValueError:
            return False

        resolved.unlink()
        logger.info("已删除上传文件: %s", virtual_path)
        return True
