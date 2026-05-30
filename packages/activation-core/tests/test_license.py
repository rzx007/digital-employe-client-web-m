"""激活授权码签名 / 验签纯函数单测。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from activation_core import device
from activation_core import license as lic


@pytest.fixture()
def keypair() -> tuple[bytes, bytes]:
    return lic.generate_keypair()


def _future(days: int = 30) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def test_normalize_and_format_device_code():
    assert device.normalize_device_code("abcd-EFGH-12 34") == "ABCDEFGH1234"
    assert device.format_device_code("abcdefgh1234") == "ABCD-EFGH-1234"
    assert device.normalize_device_code("") == ""


def test_sign_and_verify_roundtrip(keypair):
    private_pem, public_pem = keypair
    code = lic.sign_license(private_pem, "ABCD-EFGH-IJKL", _future())
    payload = lic.verify_license(code, public_pem, device_code="abcdefghijkl")
    assert payload.device_code == "ABCDEFGHIJKL"
    assert payload.version == lic.LICENSE_VERSION


def test_verify_rejects_wrong_device(keypair):
    private_pem, public_pem = keypair
    code = lic.sign_license(private_pem, "ABCD-EFGH-IJKL", _future())
    with pytest.raises(lic.LicenseDeviceMismatchError):
        lic.verify_license(code, public_pem, device_code="ZZZZ-ZZZZ")


def test_verify_rejects_expired(keypair):
    private_pem, public_pem = keypair
    expired = datetime.now(timezone.utc) - timedelta(days=1)
    code = lic.sign_license(private_pem, "ABCD", expired)
    with pytest.raises(lic.LicenseExpiredError):
        lic.verify_license(code, public_pem, device_code="ABCD")


def test_verify_rejects_tampered_signature(keypair):
    private_pem, public_pem = keypair
    other_private, _ = lic.generate_keypair()
    code = lic.sign_license(other_private, "ABCD", _future())
    with pytest.raises(lic.LicenseSignatureError):
        lic.verify_license(code, public_pem, device_code="ABCD")


def test_verify_rejects_malformed(keypair):
    _, public_pem = keypair
    with pytest.raises(lic.LicenseError):
        lic.verify_license("not-a-valid-code", public_pem)


def test_parse_payload_without_verification(keypair):
    private_pem, _ = keypair
    exp = _future(10)
    code = lic.sign_license(private_pem, "ABCD-EFGH", exp)
    payload = lic.parse_payload(code)
    assert payload.device_code == "ABCDEFGH"
    assert abs((payload.expires_at - exp).total_seconds()) < 2
