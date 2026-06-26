"""activation.json 读写 —— 激活状态的唯一 IO 点。

路径与 Electron ``getDataDir()`` 一致：``~/.boban-staff-next/data/activation.json``。
service 层只调用本模块，不直接 open 文件。

升级迁移：BobanStaffNext 分叉把数据目录从 ``.boban-staff`` / ``.digital-employee``
迁到 ``.boban-staff-next``。激活是设备绑定（同机迁移后 device_code 不变、license 仍有效），
故启动时若新目录无 activation.json，从旧目录拷一份过来，免老用户升级后重新激活。
见 ``migrate_legacy_activation()``。
"""

from __future__ import annotations

import json
import logging
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

from src.core.config import get_default_sqlite_path, resolve_configured_path

logger = logging.getLogger(__name__)

_FILENAME = "activation.json"

# 旧版本（改名前）数据目录名，按「由新到旧」优先级排列。升级迁移时取第一个命中者。
_LEGACY_DIR_NAMES = (".boban-staff", ".digital-employee")


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


def _legacy_activation_candidates() -> list[Path]:
    """旧版本数据目录下的 activation.json 候选路径（按优先级）。"""
    home = Path.home()
    return [home / name / "data" / _FILENAME for name in _LEGACY_DIR_NAMES]


def migrate_legacy_activation() -> bool:
    """升级迁移：新目录无 activation.json 时，从旧版本数据目录拷一份过来。

    非破坏性（拷贝，保留旧文件）、幂等（新文件已存在即跳过）、失败不抛
    （迁移失败绝不能阻断启动，最坏退化为需重新激活）。返回是否实际迁移了文件。
    """
    try:
        dest = _activation_path()
        if dest.exists():
            return False
        for src in _legacy_activation_candidates():
            if src.is_file():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                logger.info("已从旧版本目录迁移激活文件: %s -> %s", src, dest)
                return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("迁移旧版本激活文件失败（忽略，按未激活处理）: %s", exc)
    return False
