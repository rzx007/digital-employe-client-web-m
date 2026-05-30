"""ActivationService 编排单测（后端计算设备码 + storage/policy 注入）。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.core.activation import license as lic
from src.service.activation_service import ActivationService

FIXED_DEVICE = "ABCDEFGH12345678ABCD"  # 20 hex，模拟本机指纹


@pytest.fixture()
def activation_env(tmp_path, monkeypatch):
    private_pem, public_pem = lic.generate_keypair()

    from src.core.activation import keys

    keys.load_public_key_pem.cache_clear()
    monkeypatch.setenv("ACTIVATION_PUBLIC_KEY_PEM", public_pem.decode("utf-8"))

    monkeypatch.setattr(
        "src.service.activation_service.policy.is_activation_enforced",
        lambda: True,
    )
    # 固定本机设备码
    monkeypatch.setattr(
        "src.service.activation_service.compute_local_device_code",
        lambda: FIXED_DEVICE,
    )

    act_path = tmp_path / "activation.json"
    monkeypatch.setattr(
        "src.core.activation.storage._activation_path", lambda: act_path
    )

    yield private_pem, act_path
    keys.load_public_key_pem.cache_clear()


def _future(days: int = 30) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def test_get_device_code(activation_env):
    assert ActivationService.get_device_code() == "ABCD-EFGH-1234-5678-ABCD"


def test_status_not_activated(activation_env):
    status = ActivationService.get_status()
    assert status.enforced is True
    assert status.activated is False
    assert status.reason == "not_activated"


def test_activate_then_status_activated(activation_env):
    private_pem, act_path = activation_env
    code = lic.sign_license(private_pem, FIXED_DEVICE, _future())

    result = ActivationService.activate(code)
    assert result.activated is True
    assert act_path.exists()

    status = ActivationService.get_status()
    assert status.activated is True
    assert status.days_remaining is not None and status.days_remaining > 0


def test_activate_rejects_license_for_other_device(activation_env):
    private_pem, _ = activation_env
    code = lic.sign_license(private_pem, "ZZZZ-ZZZZ", _future())
    with pytest.raises(lic.LicenseDeviceMismatchError):
        ActivationService.activate(code)


def test_status_device_mismatch_after_copy(activation_env, monkeypatch):
    private_pem, _ = activation_env
    code = lic.sign_license(private_pem, FIXED_DEVICE, _future())
    ActivationService.activate(code)

    # 模拟拷贝到另一台机器：本机设备码变化
    monkeypatch.setattr(
        "src.service.activation_service.compute_local_device_code",
        lambda: "FFFFFFFFFFFFFFFFFFFF",
    )
    status = ActivationService.get_status()
    assert status.activated is False
    assert status.reason == "device_mismatch"


def test_not_enforced_returns_activated(monkeypatch):
    monkeypatch.setattr(
        "src.service.activation_service.policy.is_activation_enforced",
        lambda: False,
    )
    status = ActivationService.get_status()
    assert status.enforced is False
    assert status.activated is True
