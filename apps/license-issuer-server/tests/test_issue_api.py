"""签发接口单测：Bearer 鉴权 + 设备码签发 + 错误分支。

用临时密钥对：通过 DE_LICENSE_PRIVATE_KEY 指向临时私钥，签出的码用对应公钥
verify_license 验证（证明端到端可用）。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from activation_core import generate_keypair, verify_license

TOKEN = "test-token-123"
DEVICE = "3E5677F8E9179E207A30"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    private_pem, public_pem = generate_keypair()
    priv_path = tmp_path / "private_key.pem"
    priv_path.write_bytes(private_pem)
    monkeypatch.setenv("DE_LICENSE_PRIVATE_KEY", str(priv_path))
    monkeypatch.setenv("ISSUER_API_TOKEN", TOKEN)

    from license_issuer_server.app import create_app

    app = create_app()
    return TestClient(app), public_pem


def _auth(token: str = TOKEN) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_issue_success_returns_verifiable_license(client):
    c, public_pem = client
    resp = c.post(
        "/license/issue",
        json={"device_code": DEVICE, "expires": "+90d"},
        headers=_auth(),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    code = body["data"]["license_code"]
    # 签出的码能被对应公钥 + 同设备码验过
    payload = verify_license(code, public_pem, device_code=DEVICE)
    assert payload.device_code == DEVICE


def test_issue_uses_default_expires_when_omitted(client):
    c, public_pem = client
    resp = c.post("/license/issue", json={"device_code": DEVICE}, headers=_auth())
    assert resp.status_code == 200
    code = resp.json()["data"]["license_code"]
    verify_license(code, public_pem, device_code=DEVICE)  # 不抛即有效


def test_issue_missing_token_rejected(client):
    c, _ = client
    resp = c.post("/license/issue", json={"device_code": DEVICE})
    assert resp.status_code == 401


def test_issue_wrong_token_rejected(client):
    c, _ = client
    resp = c.post(
        "/license/issue", json={"device_code": DEVICE}, headers=_auth("bad")
    )
    assert resp.status_code == 401


def test_issue_bad_expires_rejected(client):
    c, _ = client
    resp = c.post(
        "/license/issue",
        json={"device_code": DEVICE, "expires": "not-a-date"},
        headers=_auth(),
    )
    assert resp.status_code == 400
