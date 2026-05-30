"""授权码签名 / 验签纯函数。

授权码格式：``base64url(payload_json) + "." + base64url(signature)``
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from activation_core.device import normalize_device_code

LICENSE_VERSION = 1


class LicenseError(Exception):
    """授权码解析或验签失败。"""


class LicenseSignatureError(LicenseError):
    """签名无效。"""


class LicenseDeviceMismatchError(LicenseError):
    """授权码绑定的设备码与当前设备不一致。"""


class LicenseExpiredError(LicenseError):
    """授权码已过期。"""


@dataclass(frozen=True)
class LicensePayload:
    device_code: str
    expires_at: datetime
    issued_at: datetime | None
    version: int


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _parse_iso(value: str) -> datetime:
    raw = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def generate_keypair() -> tuple[bytes, bytes]:
    """生成 Ed25519 密钥对，返回 ``(private_pem, public_pem)``。"""
    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


def load_private_key(private_pem: bytes) -> Ed25519PrivateKey:
    key = serialization.load_pem_private_key(private_pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise LicenseError("私钥不是 Ed25519 类型")
    return key


def load_public_key(public_pem: bytes) -> Ed25519PublicKey:
    key = serialization.load_pem_public_key(public_pem)
    if not isinstance(key, Ed25519PublicKey):
        raise LicenseError("公钥不是 Ed25519 类型")
    return key


def sign_license(
    private_pem: bytes,
    device_code: str,
    expires_at: datetime,
    issued_at: datetime | None = None,
) -> str:
    """用私钥签发授权码。"""
    private_key = load_private_key(private_pem)
    issued = issued_at or datetime.now(timezone.utc)
    payload = {
        "d": normalize_device_code(device_code),
        "exp": expires_at.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "iat": issued.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "v": LICENSE_VERSION,
    }
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    payload_b64 = _b64url_encode(payload_json.encode("utf-8"))
    signature = private_key.sign(payload_b64.encode("ascii"))
    return f"{payload_b64}.{_b64url_encode(signature)}"


def parse_payload(license_code: str) -> LicensePayload:
    """仅解析 payload，不验签。"""
    parts = license_code.strip().split(".")
    if len(parts) != 2:
        raise LicenseError("授权码格式不正确")
    try:
        payload_raw = json.loads(_b64url_decode(parts[0]).decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise LicenseError("授权码 payload 解析失败") from exc
    try:
        return LicensePayload(
            device_code=normalize_device_code(str(payload_raw["d"])),
            expires_at=_parse_iso(str(payload_raw["exp"])),
            issued_at=_parse_iso(str(payload_raw["iat"]))
            if payload_raw.get("iat")
            else None,
            version=int(payload_raw.get("v", LICENSE_VERSION)),
        )
    except (KeyError, ValueError) as exc:
        raise LicenseError("授权码字段缺失或非法") from exc


def verify_license(
    license_code: str,
    public_pem: bytes,
    device_code: str | None = None,
    now: datetime | None = None,
) -> LicensePayload:
    """完整校验：验签 -> 设备匹配（可选）-> 过期检查。"""
    parts = license_code.strip().split(".")
    if len(parts) != 2:
        raise LicenseError("授权码格式不正确")
    payload_b64, signature_b64 = parts

    public_key = load_public_key(public_pem)
    try:
        public_key.verify(_b64url_decode(signature_b64), payload_b64.encode("ascii"))
    except InvalidSignature as exc:
        raise LicenseSignatureError("授权码签名无效") from exc
    except Exception as exc:  # noqa: BLE001
        raise LicenseSignatureError("授权码签名校验失败") from exc

    payload = parse_payload(license_code)

    if device_code is not None:
        if payload.device_code != normalize_device_code(device_code):
            raise LicenseDeviceMismatchError("授权码与当前设备不匹配")

    current = now or datetime.now(timezone.utc)
    if current >= payload.expires_at:
        raise LicenseExpiredError("授权码已过期")

    return payload
