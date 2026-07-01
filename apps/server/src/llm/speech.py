"""Speech-to-text (ASR) configuration and transcription proxy."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.llm.providers.url import normalize_openai_base_url
from src.llm.registry import find_provider, load_registry, mask_api_key
from src.models.config_kv import ConfigKv
from src.service.config_kv_service import ConfigKvService

logger = logging.getLogger(__name__)

# 内置默认（与原 transcribe.ts 硬编码一致）；KV / 环境变量 / apps/web/.env 可覆盖。
DEFAULT_TRANSCRIPTION_URL = (
    "http://192.168.2.125:8082/finch/v1/audio/transcriptions"
)
DEFAULT_TRANSCRIPTION_LANGUAGE = "zh"
DEFAULT_USE_ACTIVE_PROVIDER = False

KV_USE_ACTIVE_PROVIDER = "SPEECH_USE_ACTIVE_PROVIDER"
KV_TRANSCRIPTION_URL = "SPEECH_TRANSCRIPTION_URL"
KV_TRANSCRIPTION_MODEL = "SPEECH_TRANSCRIPTION_MODEL"
KV_TRANSCRIPTION_API_KEY = "SPEECH_TRANSCRIPTION_API_KEY"
KV_TRANSCRIPTION_LANGUAGE = "SPEECH_TRANSCRIPTION_LANGUAGE"

SPEECH_KV_KEYS = (
    KV_USE_ACTIVE_PROVIDER,
    KV_TRANSCRIPTION_URL,
    KV_TRANSCRIPTION_MODEL,
    KV_TRANSCRIPTION_API_KEY,
    KV_TRANSCRIPTION_LANGUAGE,
)


def _kv_bool(raw: str | None) -> bool:
    return (raw or "").strip().lower() in ("1", "true", "yes", "on")


def _parse_dotenv(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'\"")
        if key:
            out[key] = value
    return out


@lru_cache(maxsize=1)
def _web_dotenv_finch() -> dict[str, str]:
    server_root = Path(__file__).resolve().parents[2]
    candidates = [
        server_root.parent / "web" / ".env",
        Path.cwd().parent / "web" / ".env",
    ]
    merged: dict[str, str] = {}
    for path in candidates:
        merged.update(_parse_dotenv(path))
    return merged


def _env_value(*names: str) -> str:
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


def _fallback_finch_value(kind: str) -> str:
    dotenv = _web_dotenv_finch()
    if kind == "url":
        return (
            _env_value("SPEECH_TRANSCRIPTION_URL", "VITE_FINCH_TRANSCRIPTION_URL")
            or dotenv.get("VITE_FINCH_TRANSCRIPTION_URL", "").strip()
            or DEFAULT_TRANSCRIPTION_URL
        )
    if kind == "key":
        return _env_value(
            "SPEECH_TRANSCRIPTION_API_KEY",
            "VITE_FINCH_TRANSCRIPTION_KEY",
            "FINCH_TRANSCRIPTION_KEY",
        ) or dotenv.get("VITE_FINCH_TRANSCRIPTION_KEY", "").strip()
    if kind == "model":
        return _env_value(
            "SPEECH_TRANSCRIPTION_MODEL",
            "VITE_FINCH_TRANSCRIPTION_MODEL",
        ) or dotenv.get("VITE_FINCH_TRANSCRIPTION_MODEL", "").strip()
    if kind == "language":
        return (
            _env_value(
                "SPEECH_TRANSCRIPTION_LANGUAGE",
                "VITE_FINCH_TRANSCRIPTION_LANGUAGE",
            )
            or dotenv.get("VITE_FINCH_TRANSCRIPTION_LANGUAGE", "").strip()
            or DEFAULT_TRANSCRIPTION_LANGUAGE
        )
    raise ValueError(f"unknown finch fallback kind: {kind}")


def _effective_speech_settings(kv: dict[str, str]) -> dict[str, Any]:
    """KV 未写入的项回退到 apps/web/.env / 进程环境 / 内置默认。"""
    use_active = (
        _kv_bool(kv[KV_USE_ACTIVE_PROVIDER])
        if KV_USE_ACTIVE_PROVIDER in kv
        else DEFAULT_USE_ACTIVE_PROVIDER
    )
    transcription_url = (
        (kv.get(KV_TRANSCRIPTION_URL) or "").strip()
        if KV_TRANSCRIPTION_URL in kv
        else _fallback_finch_value("url")
    )
    transcription_model = (
        (kv.get(KV_TRANSCRIPTION_MODEL) or "").strip()
        if KV_TRANSCRIPTION_MODEL in kv
        else _fallback_finch_value("model")
    )
    if not transcription_model:
        transcription_model = _fallback_finch_value("model")
    transcription_language = (
        (kv.get(KV_TRANSCRIPTION_LANGUAGE) or "").strip()
        if KV_TRANSCRIPTION_LANGUAGE in kv
        else _fallback_finch_value("language")
    ) or DEFAULT_TRANSCRIPTION_LANGUAGE
    api_key = (
        (kv.get(KV_TRANSCRIPTION_API_KEY) or "").strip()
        if KV_TRANSCRIPTION_API_KEY in kv
        else _fallback_finch_value("key")
    )
    if not api_key:
        api_key = _fallback_finch_value("key")
    return {
        "use_active_provider": use_active,
        "transcription_url": transcription_url,
        "transcription_model": transcription_model,
        "transcription_language": transcription_language,
        "api_key": api_key,
    }


def _read_speech_kv(db: Session) -> dict[str, str]:
    data: dict[str, str] = {}
    rows = db.scalars(
        select(ConfigKv).where(ConfigKv.config_key.in_(SPEECH_KV_KEYS))
    ).all()
    for row in rows:
        if row.config_value is not None:
            data[row.config_key] = row.config_value
    return data


def ensure_speech_config_bootstrap(db: Session) -> bool:
    """首次使用时把 Finch 默认（含 .env 中的 Key）写入 config_kvs，便于设置页展示与修改。"""
    kv = _read_speech_kv(db)
    if kv:
        return False
    effective = _effective_speech_settings({})
    save_speech_config(
        db,
        use_active_provider=effective["use_active_provider"],
        transcription_url=effective["transcription_url"],
        transcription_model=effective["transcription_model"],
        transcription_language=effective["transcription_language"],
        transcription_api_key=effective["api_key"],
        api_key_unchanged=False,
    )
    logger.info("Speech transcription defaults bootstrapped into config_kvs")
    return True


def _maybe_fix_misconfigured_speech(db: Session, kv: dict[str, str]) -> None:
    """历史误开「复用 LLM 供应商」但 URL 仍是 Finch 时，自动改回独立转写。"""
    if not _kv_bool(kv.get(KV_USE_ACTIVE_PROVIDER)):
        return
    url = (kv.get(KV_TRANSCRIPTION_URL) or "").strip()
    if not url or "/finch/" not in url.lower():
        return
    ConfigKvService.upsert(db, KV_USE_ACTIVE_PROVIDER, "0")
    logger.info("Speech config auto-fix: disabled use_active_provider for Finch URL")


def speech_config_for_api(db: Session) -> dict[str, Any]:
    ensure_speech_config_bootstrap(db)
    kv = _read_speech_kv(db)
    _maybe_fix_misconfigured_speech(db, kv)
    kv = _read_speech_kv(db)
    effective = _effective_speech_settings(kv)
    api_key = effective["api_key"]
    return {
        "use_active_provider": effective["use_active_provider"],
        "transcription_url": effective["transcription_url"],
        "transcription_model": effective["transcription_model"],
        "transcription_language": effective["transcription_language"],
        "api_key_masked": mask_api_key(api_key),
        "api_key_present": bool(api_key),
        "is_default": not kv,
    }


def save_speech_config(
    db: Session,
    *,
    use_active_provider: bool,
    transcription_url: str,
    transcription_model: str,
    transcription_language: str,
    transcription_api_key: str | None = None,
    api_key_unchanged: bool = False,
) -> dict[str, Any]:
    entries: list[tuple[str, str]] = [
        (KV_USE_ACTIVE_PROVIDER, "1" if use_active_provider else "0"),
        (KV_TRANSCRIPTION_URL, transcription_url.strip()),
        (KV_TRANSCRIPTION_MODEL, transcription_model.strip()),
        (KV_TRANSCRIPTION_LANGUAGE, (transcription_language.strip() or "zh")),
    ]
    for key, value in entries:
        ConfigKvService.upsert(db, key, value)
    key_trimmed = (transcription_api_key or "").strip()
    if key_trimmed:
        ConfigKvService.upsert(db, KV_TRANSCRIPTION_API_KEY, key_trimmed)
    elif not api_key_unchanged and transcription_api_key is not None:
        ConfigKvService.upsert(db, KV_TRANSCRIPTION_API_KEY, "")
    return speech_config_for_api(db)


def _join_transcription_url(base_url: str) -> str:
    normalized = normalize_openai_base_url(base_url.rstrip("/"))
    return f"{normalized.rstrip('/')}/audio/transcriptions"


def resolve_transcription_runtime(db: Session) -> tuple[str, str, str, str]:
    """Return (endpoint_url, api_key, model, language). Raises ValueError if misconfigured."""
    ensure_speech_config_bootstrap(db)
    kv = _read_speech_kv(db)
    _maybe_fix_misconfigured_speech(db, kv)
    kv = _read_speech_kv(db)
    effective = _effective_speech_settings(kv)
    language = effective["transcription_language"]
    model = effective["transcription_model"]
    use_active = effective["use_active_provider"]

    if use_active:
        registry = load_registry(db)
        if not registry.active_provider_id:
            raise ValueError("未选择当前使用的 LLM 供应商，无法复用其凭证做语音转写")
        provider = find_provider(registry, registry.active_provider_id)
        if provider is None:
            raise ValueError("当前 LLM 供应商不存在，请重新选择模型")
        if not model:
            raise ValueError("请配置语音转写模型（SPEECH_TRANSCRIPTION_MODEL）")
        endpoint = _join_transcription_url(provider.base_url)
        api_key = (provider.api_key or "").strip()
        if not api_key:
            raise ValueError("当前 LLM 供应商未配置 API Key，无法用于语音转写")
        return endpoint, api_key, model, language

    endpoint = effective["transcription_url"]
    if not endpoint:
        raise ValueError(
            "未配置语音转写接口，请在设置 → 模型 → 语音转写中填写转写地址"
        )
    return endpoint, effective["api_key"], model, language


def extract_transcript(payload: Any) -> str:
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload.strip()

    if not isinstance(payload, dict):
        return ""

    if isinstance(payload.get("text"), str):
        return payload["text"].strip()
    if isinstance(payload.get("transcript"), str):
        return payload["transcript"].strip()

    data = payload.get("data")
    if isinstance(data, dict):
        if isinstance(data.get("text"), str):
            return data["text"].strip()
        if isinstance(data.get("transcript"), str):
            return data["transcript"].strip()

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"].strip()

    return ""


async def transcribe_audio_bytes(
    db: Session,
    *,
    file_bytes: bytes,
    filename: str = "recording.webm",
) -> str:
    if not file_bytes:
        raise ValueError("音频为空")
    endpoint, api_key, model, language = resolve_transcription_runtime(db)

    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    files = {"file": (filename, file_bytes, "audio/webm")}
    data: dict[str, str] = {"language": language}
    if model:
        data["model"] = model

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            endpoint,
            files=files,
            data=data,
            headers=headers,
        )

    if response.status_code >= 400:
        body = response.text[:240]
        raise ValueError(f"转写失败 ({response.status_code}): {body}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise ValueError("转写服务返回非 JSON 响应") from exc

    text = extract_transcript(payload)
    if not text:
        raise ValueError("转写返回格式无法解析")
    return text
