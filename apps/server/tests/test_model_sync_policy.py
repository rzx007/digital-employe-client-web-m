from __future__ import annotations

from src.llm.registry import (
    LlmModelEntry,
    LlmProviderEntry,
    LlmRegistry,
    REMOTE_SYNC_PROVIDER_DISPLAY_NAME,
    resolve_model_sync_policy,
    should_apply_remote_model_sync,
)


def _custom_hanhai() -> LlmProviderEntry:
    return LlmProviderEntry(
        id="hanhai",
        source="custom",
        display_name="Hanhai",
        base_url="http://localhost:12345/v1",
        api_key="1",
        models=[LlmModelEntry(id="Hanhai")],
    )


def _remote_synced() -> LlmProviderEntry:
    return LlmProviderEntry(
        id="custom",
        source="custom",
        display_name=REMOTE_SYNC_PROVIDER_DISPLAY_NAME,
        base_url="https://remote.example/v1",
        api_key="remote-key",
        models=[LlmModelEntry(id="remote-model")],
    )


def test_should_sync_when_no_active_model() -> None:
    registry = LlmRegistry(providers=[_custom_hanhai()])
    assert should_apply_remote_model_sync(registry) is True


def test_should_not_sync_when_local_custom_active() -> None:
    registry = LlmRegistry(
        active_provider_id="hanhai",
        active_model_id="Hanhai",
        providers=[_custom_hanhai()],
    )
    assert resolve_model_sync_policy(registry) == "local"
    assert should_apply_remote_model_sync(registry) is False


def test_should_sync_when_remote_policy_explicit() -> None:
    registry = LlmRegistry(
        active_provider_id="hanhai",
        active_model_id="Hanhai",
        model_sync_policy="remote",
        providers=[_custom_hanhai()],
    )
    assert should_apply_remote_model_sync(registry) is True


def test_should_not_sync_when_local_policy_explicit() -> None:
    registry = LlmRegistry(
        active_provider_id="dashscope",
        active_model_id="deepseek-v4-flash",
        model_sync_policy="local",
        providers=[_custom_hanhai()],
    )
    assert should_apply_remote_model_sync(registry) is False


def test_legacy_remote_synced_custom_still_syncs() -> None:
    registry = LlmRegistry(
        active_provider_id="custom",
        active_model_id="remote-model",
        providers=[_remote_synced()],
    )
    assert resolve_model_sync_policy(registry) == "remote"
    assert should_apply_remote_model_sync(registry) is True
