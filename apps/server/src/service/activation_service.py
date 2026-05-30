"""激活编排：状态查询、激活、持久化校验。

业务逻辑全部集中于此；API / Middleware / Gateway 只调用本 service，业务 service
（chat / agent / skill）不感知激活。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from src.core.activation import keys, license as license_mod, policy
from src.core.activation.device import (
    compute_local_device_code,
    format_device_code,
    normalize_device_code,
)
from src.core.activation.storage import (
    ActivationRecord,
    clear_record,
    read_record,
    write_record,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ActivationStatus:
    enforced: bool
    activated: bool
    expires_at: str | None = None
    days_remaining: int | None = None
    reason: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _days_remaining(expires_at: datetime) -> int:
    delta = expires_at - _now()
    return max(0, delta.days)


class ActivationService:
    @staticmethod
    def get_device_code() -> str:
        """本机设备码（展示格式 XXXX-XXXX-...）。"""
        return format_device_code(compute_local_device_code())

    @staticmethod
    def get_status() -> ActivationStatus:
        enforced = policy.is_activation_enforced()
        if not enforced:
            return ActivationStatus(enforced=False, activated=True)

        if not keys.has_public_key():
            return ActivationStatus(
                enforced=True,
                activated=False,
                reason="missing_public_key",
            )

        record = read_record()
        if record is None:
            return ActivationStatus(
                enforced=True, activated=False, reason="not_activated"
            )

        # 绑定到本机：拷贝到其它机器后 live 设备码不同 -> 失配
        live_device = compute_local_device_code()
        if normalize_device_code(record.device_code) != live_device:
            logger.warning("激活记录设备码与本机不一致（疑似拷贝）")
            return ActivationStatus(
                enforced=True, activated=False, reason="device_mismatch"
            )

        try:
            payload = license_mod.verify_license(
                record.license_code,
                keys.load_public_key_pem(),
                device_code=live_device,
            )
        except license_mod.LicenseExpiredError:
            return ActivationStatus(
                enforced=True,
                activated=False,
                expires_at=record.expires_at,
                days_remaining=0,
                reason="expired",
            )
        except license_mod.LicenseError as exc:
            logger.warning("已存激活记录校验失败: %s", exc)
            return ActivationStatus(
                enforced=True, activated=False, reason="invalid"
            )

        ActivationService._touch_last_seen(record)

        return ActivationStatus(
            enforced=True,
            activated=True,
            expires_at=payload.expires_at.isoformat().replace("+00:00", "Z"),
            days_remaining=_days_remaining(payload.expires_at),
        )

    @staticmethod
    def _touch_last_seen(record: ActivationRecord) -> None:
        """记录 last_seen 以便检测时钟回拨；写失败不影响激活判定。"""
        try:
            now = _now()
            if record.last_seen_at:
                last_seen = datetime.fromisoformat(
                    record.last_seen_at.replace("Z", "+00:00")
                )
                rollback_hours = (last_seen - now).total_seconds() / 3600
                if rollback_hours > policy.CLOCK_ROLLBACK_TOLERANCE_HOURS:
                    logger.warning(
                        "检测到系统时钟回拨 %.1f 小时", rollback_hours
                    )
            record.last_seen_at = now.isoformat().replace("+00:00", "Z")
            write_record(record)
        except Exception as exc:  # noqa: BLE001
            logger.debug("更新 last_seen_at 失败: %s", exc)

    @staticmethod
    def activate(license_code: str) -> ActivationStatus:
        """校验授权码并持久化；设备码以本机计算为准。失败抛 LicenseError。"""
        public_pem = keys.load_public_key_pem()
        live_device = compute_local_device_code()
        payload = license_mod.verify_license(
            license_code,
            public_pem,
            device_code=live_device,
        )

        now = _now()
        record = ActivationRecord(
            device_code=live_device,
            license_code=license_code.strip(),
            expires_at=payload.expires_at.isoformat().replace("+00:00", "Z"),
            activated_at=now.isoformat().replace("+00:00", "Z"),
            last_seen_at=now.isoformat().replace("+00:00", "Z"),
        )
        write_record(record)
        logger.info(
            "激活成功 device=%s expires=%s",
            record.device_code,
            record.expires_at,
        )

        return ActivationStatus(
            enforced=True,
            activated=True,
            expires_at=record.expires_at,
            days_remaining=_days_remaining(payload.expires_at),
        )

    @staticmethod
    def deactivate() -> None:
        clear_record()
