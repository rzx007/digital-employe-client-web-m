"""activation.json 读写 —— 激活状态的唯一 IO 点。

路径与 Electron ``getDataDir()`` 一致：``~/.digital-employee/data/activation.json``。
service 层只调用本模块，不直接 open 文件。
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

from src.core.config import get_default_sqlite_path, resolve_configured_path

logger = logging.getLogger(__name__)

_FILENAME = "activation.json"


@dataclass
class ActivationRecord:
    device_code: str
    license_code: str
    expires_at: str
    activated_at: str
    last_seen_at: str | None = None


def _data_dir() -> Path:
    sqlite_path = Path(resolve_configured_path(get_default_sqlite_path()))
    return sqlite_path.parent


def _activation_path() -> Path:
    return _data_dir() / _FILENAME


def read_record() -> ActivationRecord | None:
    path = _activation_path()
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return ActivationRecord(
            device_code=str(raw["device_code"]),
            license_code=str(raw["license_code"]),
            expires_at=str(raw["expires_at"]),
            activated_at=str(raw["activated_at"]),
            last_seen_at=raw.get("last_seen_at"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("读取 activation.json 失败，视为未激活: %s", exc)
        return None


def write_record(record: ActivationRecord) -> None:
    path = _activation_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(asdict(record), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clear_record() -> None:
    path = _activation_path()
    if path.exists():
        path.unlink()
