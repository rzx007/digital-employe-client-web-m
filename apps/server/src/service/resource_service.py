from __future__ import annotations

import logging
from pathlib import Path

from src.schemas.resource import ResourceContent, ResourceEntry, ResourceList
from src.service.agent import infer_artifact_language, infer_artifact_type

logger = logging.getLogger(__name__)

_ALLOWED_PREFIXES = ("/artifacts/", "/skills-draft/")


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
        conversation_dir = Path(root_path) / "conversations" / str(conversation_id)
        artifacts_dir = conversation_dir / "artifacts"
        skills_draft_dir = conversation_dir / "skills-draft"

        return ResourceList(
            artifacts=_scan_dir_flat(artifacts_dir, "/artifacts/"),
            skills_draft=_scan_skills_draft(skills_draft_dir),
        )

    @staticmethod
    def read_content(root_path: str, conversation_id: int, path: str) -> ResourceContent | None:
        if not any(path.startswith(prefix) for prefix in _ALLOWED_PREFIXES):
            return None

        conversation_dir = Path(root_path) / "conversations" / str(conversation_id)
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
