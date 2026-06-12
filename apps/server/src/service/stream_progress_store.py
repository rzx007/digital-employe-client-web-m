from __future__ import annotations

import json
import os
import threading
from pathlib import Path


class FileStreamProgressStore:
    """per-message 流式进度 sidecar：``{message_id}.json``，原子写
    （temp + fsync + os.replace）。

    存的是流到一半的瞬时进度（stream_state / stream_cursor / content）。
    终态结果仍落 app.db（历史永久记录），落库后调 :meth:`delete` 清理 sidecar。
    ``content=None`` 表示本次不更新 content（保留旧值）；state / cursor 同理。
    """

    def __init__(self, progress_dir: str | Path):
        self._dir = Path(progress_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _path(self, message_id: int) -> Path:
        return self._dir / f"{int(message_id)}.json"

    def write(
        self,
        *,
        message_id: int,
        conversation_id: int,
        state: str | None,
        cursor: int | None,
        content: str | None,
    ) -> None:
        with self._lock:
            prev = self._read_raw(message_id) or {}
            data = {
                "message_id": int(message_id),
                "conversation_id": int(conversation_id),
                "stream_state": state if state is not None else prev.get("stream_state"),
                "stream_cursor": (
                    cursor if cursor is not None else prev.get("stream_cursor")
                ),
                "content": content if content is not None else prev.get("content"),
            }
            path = self._path(message_id)
            tmp = path.with_suffix(".json.tmp")
            with tmp.open("w", encoding="utf-8") as f:
                f.write(json.dumps(data, ensure_ascii=False))
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)

    def _read_raw(self, message_id: int) -> dict | None:
        path = self._path(message_id)
        if not path.exists():
            return None
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.loads(f.read())
        except (json.JSONDecodeError, OSError):
            return None

    def read(self, message_id: int) -> dict | None:
        with self._lock:
            raw = self._read_raw(message_id)
            if raw is None:
                return None
            return {
                "stream_state": raw.get("stream_state"),
                "stream_cursor": raw.get("stream_cursor"),
                "content": raw.get("content"),
            }

    def delete(self, message_id: int) -> None:
        with self._lock:
            try:
                self._path(message_id).unlink()
            except FileNotFoundError:
                pass


_PROGRESS_STORE: FileStreamProgressStore | None = None


def get_progress_store() -> FileStreamProgressStore:
    """全局进度 store 单例，落盘目录 = sqlite 同级目录下的 stream_progress/。"""
    global _PROGRESS_STORE
    if _PROGRESS_STORE is None:
        from src.core.config import get_settings, resolve_sqlite_path

        base = (
            resolve_sqlite_path(get_settings().sqlite_path).parent / "stream_progress"
        )
        _PROGRESS_STORE = FileStreamProgressStore(base)
    return _PROGRESS_STORE
