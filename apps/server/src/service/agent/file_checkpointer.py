from __future__ import annotations

import base64
import json
import os
import threading
from pathlib import Path
from typing import Any, AsyncIterator, Iterator

from langgraph.checkpoint.base import BaseCheckpointSaver, CheckpointTuple
from langgraph.checkpoint.memory import InMemorySaver


class FileCheckpointSaver(BaseCheckpointSaver):
    """文件 checkpointer：单个全局 InMemorySaver 委托（内部按 thread_id 分键）
    + per-thread ``{thread_id}.jsonl`` journal。

    - 写（put/put_writes）：先更新内存委托，再把这次操作序列化成一行 append 到
      journal 并 fsync。追加写天然不破坏已有行，崩溃最多丢正在写的那一行。
    - 读（get_tuple/list）：懒加载——首次访问某 thread 时读 journal 逐行重放重建，
      之后走内存缓存。
    - 删（delete_thread）：丢委托内该 thread 状态 + unlink journal 文件。

    只依赖 langgraph-checkpoint 公共 API（InMemorySaver 的 put/put_writes/
    get_tuple/list/delete_thread + serde），不触碰其内部字段，降低版本碎裂风险。
    """

    # journal 行数超此阈值触发压实（长会话兜底；正常会话终态即删，基本触不到）。
    COMPACT_THRESHOLD = 200

    def __init__(self, checkpoints_dir: str | Path):
        super().__init__()
        self._dir = Path(checkpoints_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._delegate = InMemorySaver()
        self._loaded: set[str] = set()
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ utils
    def _journal_path(self, thread_id: str) -> Path:
        safe = thread_id.replace("/", "_").replace("\\", "_")
        return self._dir / f"{safe}.jsonl"

    @staticmethod
    def _thread_id(config: dict) -> str:
        return str(config["configurable"]["thread_id"])

    @staticmethod
    def _clean_config(config: dict) -> dict:
        """只保留可 JSON 化的 configurable 标量键（thread_id / checkpoint_ns /
        checkpoint_id 等），剔除 callbacks 等不可序列化对象。checkpoint_id 必须
        保留以维持 parent 链。"""
        cfg = config.get("configurable", {})
        keep = {
            k: v
            for k, v in cfg.items()
            if isinstance(v, (str, int, float, bool)) or v is None
        }
        return {"configurable": keep}

    def _enc(self, obj: Any) -> list:
        type_, blob = self.serde.dumps_typed(obj)
        return [type_, base64.b64encode(blob).decode("ascii")]

    def _dec(self, pair: list) -> Any:
        type_, b64 = pair
        return self.serde.loads_typed((type_, base64.b64decode(b64)))

    def _ensure_loaded(self, thread_id: str) -> None:
        if thread_id in self._loaded:
            return
        path = self._journal_path(thread_id)
        if path.exists():
            with path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self._replay(json.loads(line))
                    except Exception:
                        # 损坏的尾行（崩溃中途）跳过，已落盘的完整行仍可重放
                        continue
        self._loaded.add(thread_id)

    def _replay(self, rec: dict) -> None:
        config = rec["config"]
        if rec["op"] == "put":
            self._delegate.put(
                config,
                self._dec(rec["checkpoint"]),
                self._dec(rec["metadata"]),
                rec["new_versions"],
            )
        elif rec["op"] == "writes":
            writes = [(ch, self._dec(val)) for ch, val in rec["writes"]]
            self._delegate.put_writes(
                config, writes, rec["task_id"], rec.get("task_path", "")
            )

    def _append(self, thread_id: str, rec: dict) -> None:
        path = self._journal_path(thread_id)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    # --------------------------------------------------------------- sync API
    def put(self, config, checkpoint, metadata, new_versions):
        thread_id = self._thread_id(config)
        with self._lock:
            self._ensure_loaded(thread_id)
            out = self._delegate.put(config, checkpoint, metadata, new_versions)
            self._append(
                thread_id,
                {
                    "op": "put",
                    "config": self._clean_config(config),
                    "checkpoint": self._enc(checkpoint),
                    "metadata": self._enc(metadata),
                    "new_versions": new_versions,
                },
            )
            return out

    def put_writes(self, config, writes, task_id, task_path=""):
        thread_id = self._thread_id(config)
        with self._lock:
            self._ensure_loaded(thread_id)
            self._delegate.put_writes(config, writes, task_id, task_path)
            self._append(
                thread_id,
                {
                    "op": "writes",
                    "config": self._clean_config(config),
                    "task_id": task_id,
                    "task_path": task_path,
                    "writes": [[ch, self._enc(val)] for ch, val in writes],
                },
            )

    def get_tuple(self, config) -> CheckpointTuple | None:
        thread_id = self._thread_id(config)
        with self._lock:
            self._ensure_loaded(thread_id)
            return self._delegate.get_tuple(config)

    def list(
        self, config, *, filter=None, before=None, limit=None
    ) -> Iterator[CheckpointTuple]:
        with self._lock:
            if config is not None:
                self._ensure_loaded(self._thread_id(config))
            return iter(
                list(
                    self._delegate.list(
                        config, filter=filter, before=before, limit=limit
                    )
                )
            )

    def delete_thread(self, thread_id: str) -> None:
        with self._lock:
            self._delegate.delete_thread(thread_id)
            self._loaded.discard(thread_id)
            try:
                self._journal_path(thread_id).unlink()
            except FileNotFoundError:
                pass

    # -------------------------------------------------------------- async API
    async def aput(self, config, checkpoint, metadata, new_versions):
        return self.put(config, checkpoint, metadata, new_versions)

    async def aput_writes(self, config, writes, task_id, task_path=""):
        self.put_writes(config, writes, task_id, task_path)

    async def aget_tuple(self, config) -> CheckpointTuple | None:
        return self.get_tuple(config)

    async def alist(
        self, config, *, filter=None, before=None, limit=None
    ) -> AsyncIterator[CheckpointTuple]:
        for item in self.list(config, filter=filter, before=before, limit=limit):
            yield item

    async def adelete_thread(self, thread_id: str) -> None:
        self.delete_thread(thread_id)
