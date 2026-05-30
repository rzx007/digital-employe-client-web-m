"""薄 re-export：实现位于 ``digital-employee-activation-core``。"""

from activation_core.license import (  # noqa: F401
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
    "generate_keypair",
    "load_private_key",
    "load_public_key",
    "sign_license",
    "parse_payload",
    "verify_license",
]
