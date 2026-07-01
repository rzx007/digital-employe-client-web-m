"""语音转写配置解析与响应解析。"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from src.llm.registry import LlmModelEntry, LlmProviderEntry, LlmRegistry, save_registry
from src.llm.speech import (
    DEFAULT_TRANSCRIPTION_URL,
    KV_TRANSCRIPTION_MODEL,
    KV_USE_ACTIVE_PROVIDER,
    _effective_speech_settings,
    _web_dotenv_finch,
    ensure_speech_config_bootstrap,
    extract_transcript,
    resolve_transcription_runtime,
    save_speech_config,
    speech_config_for_api,
)
from src.service.config_kv_service import ConfigKvService


def test_extract_transcript_variants():
    assert extract_transcript({"text": " 你好 "}) == "你好"
    assert extract_transcript({"transcript": "ok"}) == "ok"
    assert extract_transcript({"data": {"text": "nested"}}) == "nested"
    assert extract_transcript({"choices": [{"message": {"content": "c"}}]}) == "c"
    assert extract_transcript({}) == ""


def test_effective_settings_use_builtin_defaults(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SPEECH_TRANSCRIPTION_API_KEY", raising=False)
    monkeypatch.delenv("VITE_FINCH_TRANSCRIPTION_KEY", raising=False)
    _web_dotenv_finch.cache_clear()
    effective = _effective_speech_settings({})
    assert effective["transcription_url"] == DEFAULT_TRANSCRIPTION_URL
    assert effective["transcription_language"] == "zh"
    assert effective["use_active_provider"] is False


def test_effective_settings_read_env_key(monkeypatch: pytest.MonkeyPatch):
    _web_dotenv_finch.cache_clear()
    monkeypatch.setenv("VITE_FINCH_TRANSCRIPTION_KEY", "audio_test_key")
    effective = _effective_speech_settings({})
    assert effective["api_key"] == "audio_test_key"


def test_speech_config_roundtrip(db_session: Session):
    save_speech_config(
        db_session,
        use_active_provider=False,
        transcription_url="http://asr.example/v1/audio/transcriptions",
        transcription_model="whisper-1",
        transcription_language="zh",
        transcription_api_key="sk-test-key-long",
        api_key_unchanged=False,
    )
    api = speech_config_for_api(db_session)
    assert api["transcription_url"].endswith("/audio/transcriptions")
    assert api["transcription_model"] == "whisper-1"
    assert api["api_key_present"] is True
    assert "sk-t" in api["api_key_masked"]
    assert api["is_default"] is False


def test_resolve_with_active_provider(db_session: Session):
    registry = LlmRegistry(
        active_provider_id="hanhai",
        active_model_id="Hanhai",
        providers=[
            LlmProviderEntry(
                id="hanhai",
                source="custom",
                display_name="Hanhai",
                base_url="http://localhost:12345/v1",
                api_key="secret-key",
                models=[LlmModelEntry(id="Hanhai")],
            )
        ],
    )
    save_registry(db_session, registry)
    ConfigKvService.upsert(db_session, KV_USE_ACTIVE_PROVIDER, "1")
    ConfigKvService.upsert(db_session, KV_TRANSCRIPTION_MODEL, "whisper-1")

    url, key, model, language = resolve_transcription_runtime(db_session)
    assert url == "http://localhost:12345/v1/audio/transcriptions"
    assert key == "secret-key"
    assert model == "whisper-1"
    assert language == "zh"


def test_bootstrap_seeds_from_env(monkeypatch: pytest.MonkeyPatch, db_session: Session):
    _web_dotenv_finch.cache_clear()
    monkeypatch.setenv("VITE_FINCH_TRANSCRIPTION_KEY", "audio_bootstrapped")
    monkeypatch.setenv("VITE_FINCH_TRANSCRIPTION_MODEL", "finch-model-x")

    seeded = ensure_speech_config_bootstrap(db_session)
    assert seeded is True
    api = speech_config_for_api(db_session)
    assert api["api_key_present"] is True
    assert api["transcription_model"] == "finch-model-x"
    assert api["transcription_url"] == DEFAULT_TRANSCRIPTION_URL


def test_auto_fix_use_active_with_finch_url(db_session: Session):
    ConfigKvService.upsert(db_session, KV_USE_ACTIVE_PROVIDER, "1")
    ConfigKvService.upsert(
        db_session,
        "SPEECH_TRANSCRIPTION_URL",
        "http://192.168.2.125:8082/finch/v1/audio/transcriptions",
    )
    url, _, _, _ = resolve_transcription_runtime(db_session)
    assert url.endswith("/finch/v1/audio/transcriptions")
    api = speech_config_for_api(db_session)
    assert api["use_active_provider"] is False


def test_resolve_active_without_model_raises(db_session: Session):
    registry = LlmRegistry(
        active_provider_id="hanhai",
        active_model_id="Hanhai",
        providers=[
            LlmProviderEntry(
                id="hanhai",
                source="custom",
                display_name="Hanhai",
                base_url="http://localhost:12345/v1",
                api_key="secret-key",
                models=[LlmModelEntry(id="Hanhai")],
            )
        ],
    )
    save_registry(db_session, registry)
    ConfigKvService.upsert(db_session, KV_USE_ACTIVE_PROVIDER, "1")
    with pytest.raises(ValueError, match="语音转写模型"):
        resolve_transcription_runtime(db_session)
