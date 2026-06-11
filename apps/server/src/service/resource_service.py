from __future__ import annotations

import logging
import shutil
import io
import zipfile
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from src.schemas.resource import (
    ResourceContent,
    ResourceEntry,
    ResourceList,
    ResourceUploadResult,
)
from src.service.basic_file_reader import (
    BasicFileCategory,
    DASHSCOPE_MAX_MULTIMODAL_BYTES,
    categorize_file,
    infer_resource_artifact_type,
    is_multimodal_payload_too_large,
    read_basic_file,
)
logger = logging.getLogger(__name__)

# 允许对外暴露/读写的桶子目录（相对会话根）。其余目录（conversation_history 等）不暴露。
_BUCKET_DIR_TO_KEY = {"artifacts": "artifacts", "uploads": "uploads", "skills-draft": "skills_draft"}


def _bucket_of(real_path: Path, conversation_dir: Path) -> str | None:
    """真实路径属于哪个桶（按相对会话根的首段目录推导）；不在允许桶内返回 None。"""
    try:
        rel = real_path.resolve().relative_to(conversation_dir.resolve())
    except (ValueError, OSError):
        return None
    first = rel.parts[0] if rel.parts else ""
    return _BUCKET_DIR_TO_KEY.get(first)

ALLOWED_UPLOAD_EXTENSIONS: set[str] = {
    ".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".conf", ".log", ".env",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss",
    ".less", ".vue", ".svelte", ".java", ".go", ".rs", ".c", ".cpp",
    ".h", ".hpp", ".cs", ".rb", ".php", ".swift", ".kt", ".scala",
    ".sh", ".bash", ".zsh", ".sql", ".r", ".m",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".geojson", ".jsonl", ".ndjson",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
}

MAX_UPLOAD_FILE_SIZE = 200 * 1024 * 1024


def _resolve_safe_path(conversation_dir: Path, real_path: str) -> Path | None:
    """校验真实绝对路径在会话根目录内（沙箱），返回 resolve 后的路径；越界返回 None。"""
    try:
        target = Path(real_path).resolve()
        target.relative_to(conversation_dir.resolve())
    except (ValueError, OSError):
        return None
    return target


def _scan_file(file_path: Path, bucket: str) -> ResourceEntry:
    real = file_path.as_posix()
    return ResourceEntry(
        name=file_path.name,
        path=real,
        bucket=bucket,
        entry_type="file",
        artifact_type=infer_resource_artifact_type(file_path.name),
        size=file_path.stat().st_size if file_path.is_file() else 0,
        modified_at=file_path.stat().st_mtime if file_path.is_file() else None,
    )


def _scan_dir_flat(
    directory: Path, bucket: str, *, skip_names: tuple[str, ...] = ()
) -> list[ResourceEntry]:
    if not directory.is_dir():
        return []
    entries: list[ResourceEntry] = []
    for item in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if item.is_dir() and item.name in skip_names:
            continue
        if item.is_dir():
            children = _scan_dir_flat(item, bucket)
            entries.append(
                ResourceEntry(
                    name=item.name,
                    path=item.as_posix(),
                    bucket=bucket,
                    entry_type="directory",
                    children=children,
                )
            )
        else:
            entries.append(_scan_file(item, bucket))
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
                sub_children = _scan_dir_flat(item, "skills_draft")
                children.append(
                    ResourceEntry(
                        name=item.name,
                        path=item.as_posix(),
                        bucket="skills_draft",
                        entry_type="directory",
                        children=sub_children,
                    )
                )
            else:
                children.append(_scan_file(item, "skills_draft"))
        entries.append(
            ResourceEntry(
                name=skill_dir.name,
                path=skill_dir.as_posix(),
                bucket="skills_draft",
                entry_type="directory",
                artifact_type="skill-draft",
                children=children,
            )
        )
    return entries


def _resolve_room_id_for_conversation(db: Session, conversation_id: int) -> int | None:
    """若会话属于群协作房间，返回 room_id；否则 None。"""
    from sqlalchemy import select

    from src.models.conversation import Conversation
    from src.models.group_room import GroupRoom, GroupRoomMember
    from src.models.task_execution_log import TaskExecutionLog

    room_id: int | None = None
    # 1) 群时间线会话（target_type="group"）→ 直接是房间
    conv = db.get(Conversation, conversation_id)
    if conv is not None and conv.target_type == "group":
        room = db.scalars(
            select(GroupRoom).where(
                GroupRoom.room_conversation_id == conversation_id
            )
        ).first()
        if room is not None:
            room_id = room.id
    # 2) 组长会话
    if room_id is None:
        room = db.scalars(
            select(GroupRoom).where(
                GroupRoom.leader_conversation_id == conversation_id
            )
        ).first()
        if room is not None:
            room_id = room.id
    # 3) @ 直接派的成员私有会话
    if room_id is None:
        member = db.scalars(
            select(GroupRoomMember).where(
                GroupRoomMember.conversation_id == conversation_id
            )
        ).first()
        if member is not None:
            room_id = member.room_id
    # 4) 组长编排派的任务会话：经 TaskExecutionLog 反查组长会话→房间
    if room_id is None:
        log = db.scalars(
            select(TaskExecutionLog)
            .where(TaskExecutionLog.conversation_id == conversation_id)
            .order_by(TaskExecutionLog.id.desc())
        ).first()
        if log is not None and log.orchestrator_conversation_id is not None:
            room = db.scalars(
                select(GroupRoom).where(
                    GroupRoom.leader_conversation_id
                    == log.orchestrator_conversation_id
                )
            ).first()
            if room is not None:
                room_id = room.id
    return room_id


def resolve_shared_artifacts_dir(
    db: Session, root_path: str, conversation_id: int
) -> str | None:
    """群协作会话返回 room 共享 artifacts 物理目录；普通会话返回 None。"""
    room_id = _resolve_room_id_for_conversation(db, conversation_id)
    if room_id is None:
        return None
    shared = Path(root_path) / f"room-{room_id}" / "artifacts"
    shared.mkdir(parents=True, exist_ok=True)
    return str(shared)


def _resolve_conversation_dir(root_path: str, conversation_id: int) -> Path:
    """解析会话的产物根目录。

    普通会话：<root>/<conversation_id>/（含 artifacts/uploads/skills-draft）。
    群协作会话（成员/组长任务会话或群时间线会话）：产物写在房间共享目录
    <root>/room-<room_id>/，需要据此读取，否则按 conversation_id 找会扑空。
    """
    default_dir = Path(root_path) / str(conversation_id)
    try:
        from src.db.session import get_session_local

        db = get_session_local()()
        try:
            room_id = _resolve_room_id_for_conversation(db, conversation_id)
            if room_id is not None:
                return Path(root_path) / f"room-{room_id}"
        finally:
            db.close()
    except Exception:
        pass
    return default_dir


def _resolve_employee_id_for_conversation(conversation_id: int) -> int | str | None:
    """会话→员工 owner：target_type=employee→target_id；curator→orchestrator；群→None。"""
    from src.db.session import get_session_local
    from src.models.conversation import Conversation

    db = get_session_local()()
    try:
        conv = db.get(Conversation, conversation_id)
        if conv is None:
            return None
        if conv.target_type == "employee":
            return conv.target_id
        if conv.target_type == "curator":
            return "orchestrator"
        return None
    finally:
        db.close()


def _resolve_room_dir(root_path: str, conversation_id: int) -> Path | None:
    from src.db.session import get_session_local

    db = get_session_local()()
    try:
        room_id = _resolve_room_id_for_conversation(db, conversation_id)
    finally:
        db.close()
    if room_id is None:
        return None
    return Path(root_path) / f"room-{room_id}" / "artifacts"


def resolve_workspace_context(root_path: str, conversation_id: int):
    """返回该会话的 (workspace_dir, public_root, conv_artifacts_dir, room_dir|None)。"""
    from src.service.agent.workspace_paths import resolve_workspace_dirs

    room_dir = _resolve_room_dir(root_path, conversation_id)
    employee_id = _resolve_employee_id_for_conversation(conversation_id)
    ws = resolve_workspace_dirs(
        root_path=root_path,
        employee_id=employee_id,
        conversation_id=conversation_id,
        shared_artifacts_dir=str(room_dir) if room_dir else None,
        base_dir=Path(root_path),
    )
    conv_artifacts = ws.workspace_dir / f"conv-{conversation_id}"
    return ws.workspace_dir, ws.public_root, conv_artifacts, room_dir


def _read_roots(root_path: str, conversation_id: int) -> list[Path]:
    """资源读取允许的根：员工工作空间 + 整个公共区(+ 房间)。"""
    workspace_dir, public_root, _conv, room_dir = resolve_workspace_context(
        root_path, conversation_id
    )
    roots = [workspace_dir.resolve(), public_root.resolve()]
    if room_dir is not None:
        roots.append(room_dir.resolve())
    return roots


def _is_strictly_inside(target: Path, root: Path) -> bool:
    """target 严格在 root 内部（不等于 root 自身）。"""
    try:
        rel = target.resolve().relative_to(root.resolve())
    except (ValueError, OSError):
        return False
    return len(rel.parts) >= 1


def _resolve_safe_in_roots(roots: list[Path], real_path: str) -> Path | None:
    """真实路径落在任一允许根内则返回 resolve 后路径，否则 None（沙箱）。"""
    try:
        target = Path(real_path).resolve()
    except OSError:
        return None
    for root in roots:
        try:
            target.relative_to(root)
            return target
        except ValueError:
            continue
    return None


class ResourceService:
    @staticmethod
    def list_resources(root_path: str, conversation_id: int) -> ResourceList:
        workspace_dir, public_root, conv_artifacts, room_dir = resolve_workspace_context(
            root_path, conversation_id
        )
        # 当前会话产物（排除 uploads/skills-draft 子目录，它们单列）
        current = (room_dir or conv_artifacts)
        artifacts = _scan_dir_flat(
            current, "artifacts", skip_names=("uploads", "skills-draft")
        )
        uploads = _scan_dir_flat(conv_artifacts / "uploads", "uploads")
        skills_draft = _scan_skills_draft(conv_artifacts / "skills-draft")
        # 员工工作空间全树（按 conv-* 分）+ 公共区全树（按来源分）
        workspace = _scan_dir_flat(workspace_dir, "workspace")
        public = _scan_dir_flat(public_root, "public")

        return ResourceList(
            artifacts=artifacts,
            uploads=uploads,
            skills_draft=skills_draft,
            workspace=workspace,
            public=public,
        )

    @staticmethod
    def read_content(root_path: str, conversation_id: int, path: str) -> ResourceContent | None:
        resolved = _resolve_safe_in_roots(_read_roots(root_path, conversation_id), path)
        if resolved is None or not resolved.is_file():
            return None  # 越界或非文件

        category = categorize_file(resolved)
        try:
            if category == BasicFileCategory.IMAGE:
                payload = read_basic_file(resolved)
                mime = payload.mime_type or "application/octet-stream"
                content = f"data:{mime};base64,{payload.base64_data}"
                artifact_type = "image"
            elif category == BasicFileCategory.DOCUMENT:
                payload = read_basic_file(resolved)
                content = payload.text or ""
                artifact_type = infer_resource_artifact_type(path)
            else:
                content = resolved.read_text(encoding="utf-8")
                artifact_type = infer_resource_artifact_type(path)
        except Exception as exc:
            logger.error("读取资源文件失败 path=%s: %s", path, exc, exc_info=True)
            return None

        from src.service.agent import infer_artifact_language

        return ResourceContent(
            path=path,
            content=content,
            artifact_type=artifact_type,
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

        if categorize_file(filename) == BasicFileCategory.IMAGE and (
            is_multimodal_payload_too_large(raw_bytes=len(file_bytes))
        ):
            limit_mb = DASHSCOPE_MAX_MULTIMODAL_BYTES // (1024 * 1024)
            return f"图片大小超过多模态模型上限（最大 {limit_mb}MB），请压缩后上传"

        safe_name = Path(filename).name
        if not safe_name or safe_name.startswith("."):
            return "文件名不合法"

        # 上传落到员工工作空间的当前会话 uploads 子目录
        _ws, _pub, conv_artifacts, _room = resolve_workspace_context(
            root_path, conversation_id
        )
        uploads_dir = conv_artifacts / "uploads"
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

        return ResourceUploadResult(
            name=target_path.name,
            path=target_path.as_posix(),
            bucket="uploads",
            size=len(file_bytes),
        )

    @staticmethod
    def delete_upload_file(
        root_path: str, conversation_id: int, path: str
    ) -> bool:
        _ws, _pub, conv_artifacts, _room = resolve_workspace_context(
            root_path, conversation_id
        )
        uploads_dir = (conv_artifacts / "uploads").resolve()
        try:
            resolved = Path(path).resolve()
            resolved.relative_to(uploads_dir)
        except (ValueError, OSError):
            return False  # 仅允许删当前会话 uploads 内文件
        if not resolved.is_file():
            return False
        resolved.unlink()
        logger.info("已删除上传文件: %s", resolved)
        return True

    @staticmethod
    def resolve_download_path(
        root_path: str, conversation_id: int, path: str
    ) -> tuple[Path, bool] | None:
        resolved = _resolve_safe_in_roots(_read_roots(root_path, conversation_id), path)
        if resolved is None or not resolved.exists():
            return None
        return resolved, resolved.is_dir()

    @staticmethod
    def create_zip(directory: Path) -> io.BytesIO:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_path in sorted(directory.rglob("*")):
                if file_path.is_file():
                    arcname = file_path.relative_to(directory).as_posix()
                    zf.write(file_path, arcname)
        buf.seek(0)
        return buf

    @staticmethod
    def delete_resource(
        root_path: str, conversation_id: int, path: str
    ) -> bool:
        roots = _read_roots(root_path, conversation_id)
        resolved = _resolve_safe_in_roots(roots, path)
        if resolved is None or not resolved.exists():
            return False
        # 不允许删某个允许根自身（须严格在其内：相对至少 1 段）
        if not any(
            _is_strictly_inside(resolved, root) for root in roots
        ):
            return False
        try:
            if resolved.is_dir():
                shutil.rmtree(resolved)
            else:
                resolved.unlink()
        except Exception as exc:
            logger.error("删除资源失败 path=%s: %s", path, exc)
            return False
        logger.info("已删除资源: %s", resolved)
        return True

    @staticmethod
    def batch_delete(
        root_path: str, conversation_id: int, paths: list[str]
    ) -> dict[str, list[str]]:
        """批量删产物：逐条沙箱校验，合法删、非法跳过。返回 {deleted, skipped}。"""
        deleted: list[str] = []
        skipped: list[str] = []
        for p in paths:
            if ResourceService.delete_resource(root_path, conversation_id, p):
                deleted.append(p)
            else:
                skipped.append(p)
        return {"deleted": deleted, "skipped": skipped}
