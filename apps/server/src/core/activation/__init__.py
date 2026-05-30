"""激活模块（设备码 + 离线授权码）。

密码学实现见 ``activation_core``；本包含运行时 policy / storage / keys。
"""

from activation_core.device import format_device_code, normalize_device_code
from src.core.activation.keys import has_public_key, load_public_key_pem
from src.core.activation.license import (
    LicenseDeviceMismatchError,
    LicenseError,
    LicenseExpiredError,
    LicensePayload,
    LicenseSignatureError,
    parse_payload,
    sign_license,
    verify_license,
)
from src.core.activation.policy import (
    EXPIRY_WARNING_DAYS,
    is_activation_bypassed,
    is_activation_enforced,
)

__all__ = [
    "format_device_code",
    "normalize_device_code",
    "has_public_key",
    "load_public_key_pem",
    "LicenseError",
    "LicenseSignatureError",
    "LicenseDeviceMismatchError",
    "LicenseExpiredError",
    "LicensePayload",
    "parse_payload",
    "sign_license",
    "verify_license",
    "EXPIRY_WARNING_DAYS",
    "is_activation_bypassed",
    "is_activation_enforced",
]
