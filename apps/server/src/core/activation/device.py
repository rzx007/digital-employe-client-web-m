"""设备码：本机指纹计算（客户端运行时）；格式函数来自 activation_core。"""

from __future__ import annotations

import hashlib
import logging
import re
import subprocess
import sys
import uuid

from activation_core.device import format_device_code, normalize_device_code

logger = logging.getLogger(__name__)

_GROUP_SIZE = 4
_DEVICE_HEX_LEN = 20

__all__ = [
    "normalize_device_code",
    "format_device_code",
    "compute_local_device_code",
]


def _read_machine_id() -> str:
    try:
        if sys.platform == "win32":
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Cryptography",
            ) as key:
                value, _ = winreg.QueryValueEx(key, "MachineGuid")
                return str(value)
        if sys.platform == "darwin":
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                text=True,
                timeout=5,
            )
            match = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', out)
            return match.group(1) if match else ""
        for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    content = fh.read().strip()
                    if content:
                        return content
            except OSError:
                continue
        return ""
    except Exception as exc:  # noqa: BLE001
        logger.debug("read machine-id failed: %s", exc)
        return ""


def compute_local_device_code() -> str:
    """计算本机规范设备码（20 位 hex）。"""
    mac = uuid.getnode()
    mac_hex = f"{mac:012x}"
    machine_id = _read_machine_id()
    raw = f"{mac_hex}|{machine_id}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return digest[:_DEVICE_HEX_LEN].upper()
