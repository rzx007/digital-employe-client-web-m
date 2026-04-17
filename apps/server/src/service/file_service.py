from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

from src.schemas.workspace import FileEntry


class FileService:
    @staticmethod
    def list_entries(workspace_root: str, recursive: bool = False) -> list[FileEntry]:
        root = Path(workspace_root)
        if not root.exists() or not root.is_dir():
            return []

        iterator = root.rglob("*") if recursive else root.iterdir()
        entries: list[FileEntry] = []
        for item in iterator:
            try:
                stat = item.stat()
            except OSError as exc:
                logger.error("文件项 stat 失败 path=%s: %s", item, exc, exc_info=True)
                continue
            entries.append(
                FileEntry(
                    name=item.name,
                    path=str(item),
                    entry_type="文件夹" if item.is_dir() else "文件",
                    size=0 if item.is_dir() else stat.st_size,
                    modified_at=stat.st_mtime,
                )
            )
        return entries

