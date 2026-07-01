"""端到端：B 服务签出的激活码，用对应公钥按 A 客户端的验签方式校验通过。

A 客户端 ActivationService.activate 内部即 verify_license(code, public_pem,
device_code=本机设备码)。此处用同一对密钥与同一设备码复现，证明 B→A 链路自洽。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from activation_core import generate_keypair, verify_license

TOKEN = "e2e-token"
DEVICE = "ABCDEFGH12345678ABCD"


@pytest.fixture()
def issuer(tmp_path, monkeypatch):
    private_pem, public_pem = generate_keypair()
    priv = tmp_path / "private_key.pem"
    priv.write_bytes(private_pem)
    monkeypatch.setenv("DE_LICENSE_PRIVATE_KEY", str(priv))
    monkeypatch.setenv("ISSUER_API_TOKEN", TOKEN)
    from license_issuer_server.app import create_app

    return TestClient(create_app()), public_pem


def test_issued_code_activates_on_matching_device(issuer):
    client, public_pem = issuer
    resp = client.post(
        "/license/issue",
        json={"device_code": DEVICE, "expires": "+90d"},
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    code = resp.json()["data"]["license_code"]

    # 模拟 A 客户端：用内嵌公钥 + 本机设备码验签（活动设备匹配）
    payload = verify_license(code, public_pem, device_code=DEVICE)
    assert payload.device_code == DEVICE


def test_issued_code_rejected_on_other_device(issuer):
    client, public_pem = issuer
    resp = client.post(
        "/license/issue",
        json={"device_code": DEVICE},
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    code = resp.json()["data"]["license_code"]

    from activation_core import LicenseDeviceMismatchError

    with pytest.raises(LicenseDeviceMismatchError):
        verify_license(code, public_pem, device_code="ZZZZZZZZ99999999ZZZZ")
