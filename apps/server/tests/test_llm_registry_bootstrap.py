from __future__ import annotations

import json

import pytest

from src.llm.registry import (
    OFFLINE_BOOTSTRAP_MODEL_ID,
    OFFLINE_BOOTSTRAP_PROVIDER_ID,
    ONLINE_BOOTSTRAP_MODEL_ID,
    ONLINE_BOOTSTRAP_PROVIDER_ID,
    LlmRegistry,
    apply_bootstrap_active_profile,
    prepare_llm_registry_seed,
)


SEED = {
    "active_provider_id": "dashscope",
    "active_model_id": "deepseek-v4-flash",
    "providers": [
        {
            "id": "dashscope",
            "source": "builtin",
            "display_name": "阿里云 DashScope",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "api_key": "test-key",
            "models": [{"id": "deepseek-v4-flash"}],
        },
        {
            "id": "hanhai",
            "source": "custom",
            "display_name": "Hanhai",
            "base_url": "http://localhost:12345/v1",
            "api_key": "",
            "models": [{"id": "Hanhai", "display_name": "Hanhai"}],
        },
    ],
}


@pytest.mark.parametrize(
    ("offline_env", "provider_id", "model_id"),
    [
        ("0", ONLINE_BOOTSTRAP_PROVIDER_ID, ONLINE_BOOTSTRAP_MODEL_ID),
        ("1", OFFLINE_BOOTSTRAP_PROVIDER_ID, OFFLINE_BOOTSTRAP_MODEL_ID),
    ],
)
def test_apply_bootstrap_active_profile(
    monkeypatch: pytest.MonkeyPatch,
    offline_env: str,
    provider_id: str,
    model_id: str,
) -> None:
    monkeypatch.setenv("OFFLINE_MODE", offline_env)
    from src.core.config import get_settings

    get_settings.cache_clear()

    raw = json.dumps(SEED, ensure_ascii=False)
    prepared = prepare_llm_registry_seed(raw)
    assert prepared is not None
    data = json.loads(prepared)
    assert data["active_provider_id"] == provider_id
    assert data["active_model_id"] == model_id
    assert data["model_sync_policy"] == "local"


def test_ensure_offline_bootstrap_active_restores_hanhai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.llm.registry import (
        LlmRegistry,
        ensure_offline_bootstrap_active,
        load_registry,
        save_registry,
    )

    monkeypatch.setenv("OFFLINE_MODE", "1")
    from src.core.config import get_settings

    get_settings.cache_clear()

    registry = LlmRegistry.model_validate(
        {
            **SEED,
            "active_provider_id": "dashscope",
            "active_model_id": "deepseek-v4-flash",
        }
    )

    class _FakeDb:
        pass

    db = _FakeDb()
    from unittest.mock import patch

    with patch("src.llm.registry.load_registry", return_value=registry), patch(
        "src.llm.registry.save_registry"
    ) as save_mock:
        assert ensure_offline_bootstrap_active(db) is True
        assert registry.active_provider_id == "hanhai"
        assert registry.active_model_id == "Hanhai"
        save_mock.assert_called_once()


def test_apply_bootstrap_active_profile_missing_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OFFLINE_MODE", "1")
    from src.core.config import get_settings

    get_settings.cache_clear()

    broken = {
        **SEED,
        "providers": [provider for provider in SEED["providers"] if provider["id"] != "hanhai"],
    }
    registry = apply_bootstrap_active_profile(LlmRegistry.model_validate(broken))
    assert registry.active_provider_id == "dashscope"
    assert registry.active_model_id == "deepseek-v4-flash"
