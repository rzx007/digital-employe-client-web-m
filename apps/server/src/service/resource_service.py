from __future__ import annotations

import logging
import shutil
import io
import zipfile
import uuid
from pathlib import Path

from src.schemas.resource import (
    ResourceContent,
    ResourceEntry,
    ResourceList,
    ResourceUploadResult,
    VoiceUploadResult,
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
MAX_VOICE_FILE_SIZE = 10 * 1024 * 1024


def _is_relative_to(path: Path, base: Path) -> bool:
    try:
        return path.is_relative_to(base)
    except (ValueError, OSError):
        return False


def _resolve_safe_path(product_root: Path, real_path: str) -> Path | None:
    """校验真实绝对路径在产物根内（沙箱），返回 resolve 后的路径；越界返回 None。"""
    try:
        target = Path(real_path).resolve()
        target.relative_to(product_root.resolve())
    except (ValueError, OSError):
        return None
    return target


def _rel_to(path: Path, product_root: Path | None) -> str | None:
    """相对产物根的正斜杠路径；无根或越界返回 None。"""
    if product_root is None:
        return None
    try:
        return path.relative_to(product_root).as_posix()
    except (ValueError, OSError):
        return None


def _scan_file(
    file_path: Path, bucket: str, product_root: Path | None = None
) -> ResourceEntry:
    real = file_path.as_posix()
    return ResourceEntry(
        name=file_path.name,
        path=real,
        rel_path=_rel_to(file_path, product_root),
        bucket=bucket,
        entry_type="file",
        artifact_type=infer_resource_artifact_type(file_path.name),
        size=file_path.stat().st_size if file_path.is_file() else 0,
        modified_at=file_path.stat().st_mtime if file_path.is_file() else None,
    )


# 内部 scratch 临时文件——不展示在资源管理器（也不算入文件数）。
# 如 Windows 多行 python -c 落盘的执行脚本 `_agent_exec_*`。A 方案已把新脚本写进系统
# 临时目录、跑完即删；此过滤兜底历史残留与未来其它内部临时文件。只匹配确定的内部前缀，
# 不滥过滤所有 `_` 前缀，以免误伤用户命名的产物（如 `_notes.md`）。
_INTERNAL_SCRATCH_PREFIXES = ("_agent_exec_",)


def _is_internal_scratch(name: str) -> bool:
    return name.startswith(_INTERNAL_SCRATCH_PREFIXES)


# 外部 flat 工作空间扫描 artifacts 时跳过的目录：
# ① 其它桶的子目录（uploads/voice/skills-draft 各自成桶，physical 写入仍在子目录，避免重复/串桶）；
# ② 工具/构建噪音目录。
# 另外隐藏目录（'.' 开头，如 .git/.venv/.idea）一律跳过；隐藏文件（.env/.gitignore）保留。
_EXTERNAL_NOISE_DIRS = frozenset(
    {
        # 其它桶
        "uploads",
        "voice",
        "skills-draft",
        # 噪音
        "node_modules",
        "__pycache__",
        "dist",
        "build",
        "out",
        "target",
    }
)


def _scan_dir_flat(
    directory: Path,
    bucket: str,
    *,
    exclude_dir_names: frozenset[str] = frozenset(),
    skip_hidden_dirs: bool = False,
    product_root: Path | None = None,
) -> list[ResourceEntry]:
    if not directory.is_dir():
        return []
    entries: list[ResourceEntry] = []
    for item in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if _is_internal_scratch(item.name):
            continue
        if item.is_dir():
            if item.name in exclude_dir_names:
                continue
            if skip_hidden_dirs and item.name.startswith("."):
                continue
            children = _scan_dir_flat(
                item,
                bucket,
                exclude_dir_names=exclude_dir_names,
                skip_hidden_dirs=skip_hidden_dirs,
                product_root=product_root,
            )
            entries.append(
                ResourceEntry(
                    name=item.name,
                    path=item.as_posix(),
                    rel_path=_rel_to(item, product_root),
                    bucket=bucket,
                    entry_type="directory",
                    children=children,
                )
            )
        else:
            entries.append(_scan_file(item, bucket, product_root))
    return entries


def _scan_skills_draft(
    directory: Path, product_root: Path | None = None
) -> list[ResourceEntry]:
    if not directory.is_dir():
        return []
    entries: list[ResourceEntry] = []
    for skill_dir in sorted(directory.iterdir(), key=lambda p: p.name.lower()):
        if not skill_dir.is_dir():
            continue
        children: list[ResourceEntry] = []
        for item in sorted(skill_dir.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if item.is_dir():
                sub_children = _scan_dir_flat(
                    item, "skills_draft", product_root=product_root
                )
                children.append(
                    ResourceEntry(
                        name=item.name,
                        path=item.as_posix(),
                        rel_path=_rel_to(item, product_root),
                        bucket="skills_draft",
                        entry_type="directory",
                        children=sub_children,
                    )
                )
            else:
                children.append(_scan_file(item, "skills_draft", product_root))
        entries.append(
            ResourceEntry(
                name=skill_dir.name,
                path=skill_dir.as_posix(),
                rel_path=_rel_to(skill_dir, product_root),
                bucket="skills_draft",
                entry_type="directory",
                artifact_type="skill-draft",
                children=children,
            )
        )
    return entries


class ResourceService:
    """产物资源服务。

    SP2：所有路径相对项目产物根 `product_root`（由
    `resolve_conversation_product_root(db, conv)` 解析）。三个桶
    （artifacts/uploads/skills-draft）直接挂在 product_root 下，沙箱根即
    product_root，conversation_id 不再参与磁盘路径。
    """

    @staticmethod
    def list_resources(product_root: Path) -> ResourceList:
        from src.service.agent.workspace_paths import APP_PROJECTS_BASE

        is_external = not _is_relative_to(product_root, APP_PROJECTS_BASE)
        if is_external:
            # 外部 flat 工作空间：文件夹本身即产物根，AI 产物平铺写在其下（含用户已有文件），
            # 故 artifacts 桶 = 平铺扫描 product_root 本身；跳过噪音/隐藏目录及其它桶子目录
            # （uploads/voice/skills-draft 物理仍在子目录、各自成桶）。
            artifacts = _scan_dir_flat(
                product_root,
                "artifacts",
                exclude_dir_names=_EXTERNAL_NOISE_DIRS,
                skip_hidden_dirs=True,
                product_root=product_root,
            )
        else:
            # app 托管：artifacts 为 product_root 下的子目录
            artifacts = _scan_dir_flat(
                product_root / "artifacts", "artifacts", product_root=product_root
            )
        # uploads/skills-draft 两桶物理路径在 product_root 下子目录，外部/托管一致
        uploads = _scan_dir_flat(
            product_root / "uploads", "uploads", product_root=product_root
        )
        skills_draft = _scan_skills_draft(product_root / "skills-draft", product_root)

        return ResourceList(
            artifacts=artifacts,
            uploads=uploads,
            skills_draft=skills_draft,
            # Phase 3: workspace/public 桶随目录拍平消解;暂返回空保持前端 ResourceList 契约
            workspace=[],
            public=[],
        )

    @staticmethod
    def read_content(product_root: Path, path: str) -> ResourceContent | None:
        resolved = _resolve_safe_path(product_root, path)
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
        product_root: Path,
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

        # 上传落到项目产物根的 uploads 子目录（项目共享）
        uploads_dir = product_root / "uploads"
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
    def delete_upload_file(product_root: Path, path: str) -> bool:
        uploads_dir = (product_root / "uploads").resolve()
        try:
            resolved = Path(path).resolve()
            resolved.relative_to(uploads_dir)
        except (ValueError, OSError):
            return False  # 仅允许删 uploads 内文件
        if not resolved.is_file():
            return False
        resolved.unlink()
        logger.info("已删除上传文件: %s", resolved)
        return True

    @staticmethod
    def resolve_download_path(
        product_root: Path, path: str
    ) -> tuple[Path, bool] | None:
        resolved = _resolve_safe_path(product_root, path)
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
    def delete_resource(product_root: Path, path: str) -> bool:
        resolved = _resolve_safe_path(product_root, path)
        if resolved is None or not resolved.exists():
            return False
        # 不允许删产物根自身（须严格在其内：相对至少 1 段）
        try:
            rel = resolved.relative_to(product_root.resolve())
        except (ValueError, OSError):
            return False
        if len(rel.parts) < 1:
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
    def save_voice_file(
        product_root: Path, file_bytes: bytes
    ) -> VoiceUploadResult | str:
        """保存语音消息音频到 <product_root>/voice/。

        语音目录独立于 uploads/，不进资源面板列举。
        """
        if not file_bytes:
            return "语音文件为空"
        if len(file_bytes) > MAX_VOICE_FILE_SIZE:
            return f"语音文件过大（最大 {MAX_VOICE_FILE_SIZE // (1024 * 1024)}MB）"

        voice_dir = product_root / "voice"
        voice_dir.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}.webm"
        (voice_dir / name).write_bytes(file_bytes)
        return VoiceUploadResult(audio_path=f"voice/{name}")

    @staticmethod
    def resolve_voice_path(
        product_root: Path, audio_path: str
    ) -> Path | None:
        """解析语音音频物理路径；非 voice/ 前缀或越出目录返回 None。"""
        if not audio_path.startswith("voice/"):
            return None
        voice_dir = (product_root / "voice").resolve()
        target = (product_root / audio_path).resolve()
        try:
            target.relative_to(voice_dir)
        except ValueError:
            return None
        if not target.is_file():
            return None
        return target

    @staticmethod
    def batch_delete(
        product_root: Path, paths: list[str]
    ) -> dict[str, list[str]]:
        """批量删产物：逐条沙箱校验，合法删、非法跳过。返回 {deleted, skipped}。"""
        deleted: list[str] = []
        skipped: list[str] = []
        for p in paths:
            if ResourceService.delete_resource(product_root, p):
                deleted.append(p)
            else:
                skipped.append(p)
        return {"deleted": deleted, "skipped": skipped}
