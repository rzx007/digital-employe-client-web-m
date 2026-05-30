"""离线激活授权码核心库。"""

from activation_core.device import format_device_code, normalize_device_code
from activation_core.expiry import parse_expires
from activation_core.license import (
    LICENSE_VERSION,
    LicenseDeviceMismatchError,
    LicenseError,
    LicenseExpiredError,
    LicensePayload,
    LicenseSignatureError,
    generate_keypair,
    load_private_key,
    load_public_key,
    parse_payload,
    sign_license,
    verify_license,
)

__all__ = [
    "LICENSE_VERSION",
    "LicenseError",
    "LicenseSignatureError",
    "LicenseDeviceMismatchError",
    "LicenseExpiredError",
    "LicensePayload",
    "format_device_code",
    "normalize_device_code",
    "parse_expires",
    "generate_keypair",
    "load_private_key",
    "load_public_key",
    "sign_license",
    "parse_payload",
    "verify_license",
]
