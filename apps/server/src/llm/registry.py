"""LLM multi-provider registry persisted in config_kvs as LLM_REGISTRY JSON."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

logger = logging.getLogger(__name__)

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from src.llm.providers import get_provider, list_providers, resolve_provider_id
from src.llm.providers.url import normalize_openai_base_url

REGISTRY_KV_KEY = "LLM_REGISTRY"
LEGACY_KEYS = ("LLM_PROVIDER", "BASE_URL", "OPENAI_API_KEY", "DEEPAGENT_MODEL")

ONLINE_BOOTSTRAP_PROVIDER_ID = "dashscope"
ONLINE_BOOTSTRAP_MODEL_ID = "deepseek-v4-flash"
OFFLINE_BOOTSTRAP_PROVIDER_ID = "hanhai"
OFFLINE_BOOTSTRAP_MODEL_ID = "Hanhai"

REMOTE_SYNC_PROVIDER_DISPLAY_NAME = "远程同步供应商"
ModelSyncPolicy = Literal["remote", "local"]

CUSTOM_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*$")

class LlmModelEntry(BaseModel):
    id: str
    display_name: str | None = None

    @field_validator("id")
    @classmethod
    def _strip_id(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("model id 不能为空")
        return trimmed


class LlmProviderEntry(BaseModel):
    id: str
    source: Literal["builtin", "custom"]
    display_name: str
    base_url: str
    api_key: str = ""
    models: list[LlmModelEntry] = Field(min_length=1)

    @field_validator("id")
    @classmethod
    def _strip_id(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("provider id 不能为空")
        return trimmed

    @field_validator("display_name", "base_url")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("字段不能为空")
        return trimmed


class LlmRegistry(BaseModel):
    active_provider_id: str | None = None
    active_model_id: str | None = None
    """remote=登录时允许平台覆盖；local=用户已在设置中手动选定，跳过远程同步。"""
    model_sync_policy: ModelSyncPolicy | None = None
    providers: list[LlmProviderEntry] = Field(default_factory=list)


def default_registry_seed(
    *,
    api_key: str = "",
    active_model_id: str = "deepseek-v4-flash",
) -> LlmRegistry:
    """Default LLM registry for fresh installs (dashscope preset)."""
    profile = get_provider("dashscope")
    if profile is None:
        raise RuntimeError("dashscope provider missing from catalog")
    models = _models_from_ids(list(profile.default_models))
    if not any(m.id == active_model_id for m in models):
        models.insert(0, LlmModelEntry(id=active_model_id))
    provider = LlmProviderEntry(
        id=profile.id,
        source="builtin",
        display_name=profile.display_name,
        base_url=profile.base_url,
        api_key=api_key,
        models=models,
    )
    return LlmRegistry(
        active_provider_id=profile.id,
        active_model_id=active_model_id,
        providers=[provider],
    )


def mask_api_key(api_key: str | None) -> str:
    if not api_key or not api_key.strip():
        return ""
    key = api_key.strip()
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def _models_from_ids(model_ids: list[str]) -> list[LlmModelEntry]:
    return [LlmModelEntry(id=m) for m in model_ids if m.strip()]


def _registry_to_json(registry: LlmRegistry) -> str:
    return json.dumps(registry.model_dump(), ensure_ascii=False)


def _parse_registry_raw(raw: str | None) -> LlmRegistry | None:
    if not raw or not raw.strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    try:
        return LlmRegistry.model_validate(data)
    except ValueError:
        return None


def apply_bootstrap_active_profile(registry: LlmRegistry) -> LlmRegistry:
    """Pick active provider/model for first-time seed based on offline mode."""
    from src.core.config import is_offline_mode

    if is_offline_mode():
        provider_id = OFFLINE_BOOTSTRAP_PROVIDER_ID
        model_id = OFFLINE_BOOTSTRAP_MODEL_ID
    else:
        provider_id = ONLINE_BOOTSTRAP_PROVIDER_ID
        model_id = ONLINE_BOOTSTRAP_MODEL_ID

    provider = find_provider(registry, provider_id)
    if provider is None:
        logger.warning(
            "LLM registry seed missing bootstrap provider %s (offline=%s)",
            provider_id,
            is_offline_mode(),
        )
        return registry

    if not any(model.id == model_id for model in provider.models):
        logger.warning(
            "LLM registry seed missing bootstrap model %s/%s (offline=%s)",
            provider_id,
            model_id,
            is_offline_mode(),
        )
        return registry

    registry.active_provider_id = provider_id
    registry.active_model_id = model_id
    return registry


def prepare_llm_registry_seed(raw: str) -> str | None:
    """Normalize LLM_REGISTRY seed JSON and apply offline/online active profile."""
    parsed = _parse_registry_raw(raw)
    if parsed is None:
        return None
    return _registry_to_json(apply_bootstrap_active_profile(parsed))


def _read_legacy_kv(db: Session) -> dict[str, str]:
    from sqlalchemy import select

    from src.models.config_kv import ConfigKv

    rows = db.scalars(
        select(ConfigKv).where(ConfigKv.config_key.in_(LEGACY_KEYS))
    ).all()
    return {row.config_key: row.config_value or "" for row in rows}


def _migrate_from_legacy(db: Session) -> LlmRegistry | None:
    """从旧版配置迁移到新的LLM注册表格式。

    读取数据库中遗留的配置键值对，将其转换为新的LlmRegistry结构。
    支持内置提供商和自定义提供商两种模式。

    Args:
        db: 数据库会话对象，用于读取遗留的配置数据。

    Returns:
        如果存在有效的遗留配置则返回LlmRegistry对象，否则返回None。
        LlmRegistry包含激活的提供商ID、激活的模型ID以及提供商列表。
    """
    legacy = _read_legacy_kv(db)
    model = (legacy.get("DEEPAGENT_MODEL") or "").strip()
    base_url = (legacy.get("BASE_URL") or "").strip()
    api_key = legacy.get("OPENAI_API_KEY") or ""
    if not model or not base_url:
        return None

    # 确定提供商ID，如果未配置则根据base_url自动解析
    provider_id = (legacy.get("LLM_PROVIDER") or "").strip()
    if not provider_id:
        provider_id = resolve_provider_id(base_url)

    profile = get_provider(provider_id)
    # 处理内置提供商的情况
    if profile and provider_id != "custom":
        source: Literal["builtin", "custom"] = "builtin"
        display_name = profile.display_name
        normalized_url = profile.base_url
        models = _models_from_ids(list(profile.default_models))
        if not any(m.id == model for m in models):
            models.insert(0, LlmModelEntry(id=model))
        entry_id = profile.id
    else:
        # 处理自定义提供商的情况
        source = "custom"
        display_name = provider_id if provider_id != "custom" else "自定义供应商"
        try:
            normalized_url = normalize_openai_base_url(base_url)
        except ValueError:
            normalized_url = base_url
        entry_id = provider_id if provider_id and provider_id != "custom" else "custom"
        models = [LlmModelEntry(id=model)]

    # 构建提供商条目并返回完整的注册表对象
    provider = LlmProviderEntry(
        id=entry_id,
        source=source,
        display_name=display_name,
        base_url=normalized_url,
        api_key=api_key,
        models=models,
    )
    return LlmRegistry(
        active_provider_id=entry_id,
        active_model_id=model,
        providers=[provider],
    )


def load_registry(db: Session) -> LlmRegistry:
    """
    从数据库加载LLM注册表配置。

    按优先级尝试以下加载方式：
    1. 从配置键值对中解析已保存的注册表数据
    2. 从旧版配置迁移数据并保存
    3. 返回空的默认注册表实例

    Args:
        db: 数据库会话对象，用于查询和保存配置数据

    Returns:
        LlmRegistry: LLM注册表对象，包含活跃的provider、model等信息。
                    如果数据库中无配置且无法迁移，则返回空注册表。
    """
    from sqlalchemy import select

    from src.models.config_kv import ConfigKv

    # 从数据库查询注册表配置
    row = db.scalar(select(ConfigKv).where(ConfigKv.config_key == REGISTRY_KV_KEY))
    raw = row.config_value if row is not None else None

    # 尝试解析已保存的注册表数据
    parsed = _parse_registry_raw(raw)
    if parsed is not None:
        return parsed

    # 尝试从旧版配置迁移数据，迁移成功后写入 LLM_REGISTRY（保留 DB 内四键行）
    migrated = _migrate_from_legacy(db)
    if migrated is not None:
        save_registry(db, migrated)
        logger.info(
            "Migrated LLM config from legacy keys to LLM_REGISTRY: active=%s/%s",
            migrated.active_provider_id,
            migrated.active_model_id,
        )
        return migrated

    # 返回空的默认注册表实例
    return LlmRegistry()


def save_registry(db: Session, registry: LlmRegistry) -> None:
    from src.service.config_kv_service import ConfigKvService

    ConfigKvService.upsert(db, REGISTRY_KV_KEY, _registry_to_json(registry))


def registry_for_api(registry: LlmRegistry) -> dict[str, Any]:
    data = registry.model_dump()
    for provider in data.get("providers", []):
        provider["api_key_masked"] = mask_api_key(provider.get("api_key"))
        provider["api_key_present"] = bool((provider.get("api_key") or "").strip())
        del provider["api_key"]
    return data


def find_provider(registry: LlmRegistry, provider_id: str) -> LlmProviderEntry | None:
    for entry in registry.providers:
        if entry.id == provider_id:
            return entry
    return None


def is_remote_synced_provider(provider: LlmProviderEntry) -> bool:
    return provider.display_name.strip() == REMOTE_SYNC_PROVIDER_DISPLAY_NAME


def has_local_custom_provider(registry: LlmRegistry) -> bool:
    """是否存在用户手动配置的自定义供应商（非登录远程同步写入）。"""
    return any(
        p.source == "custom" and not is_remote_synced_provider(p)
        for p in registry.providers
    )


def maybe_restore_local_active_provider(
    registry: LlmRegistry,
) -> bool:
    """远程同步被跳过时，若当前仍激活远程同步供应商，则切回本地自定义供应商。"""
    if not has_local_custom_provider(registry):
        return False

    active = (
        find_provider(registry, registry.active_provider_id)
        if registry.active_provider_id
        else None
    )
    if active is not None and not is_remote_synced_provider(active):
        return False

    preferred_ids = (OFFLINE_BOOTSTRAP_PROVIDER_ID,)
    candidates: list[LlmProviderEntry] = []
    for pid in preferred_ids:
        entry = find_provider(registry, pid)
        if entry and not is_remote_synced_provider(entry):
            candidates.append(entry)
    if not candidates:
        candidates = [
            p
            for p in registry.providers
            if p.source == "custom" and not is_remote_synced_provider(p)
        ]
    if not candidates:
        return False

    pick = candidates[0]
    registry.active_provider_id = pick.id
    registry.active_model_id = pick.models[0].id
    mark_registry_local_preference(registry)
    return True


def resolve_model_sync_policy(registry: LlmRegistry) -> ModelSyncPolicy:
    """解析是否允许登录后远程覆盖模型配置。"""
    if registry.model_sync_policy in ("remote", "local"):
        return registry.model_sync_policy

    if not registry.active_provider_id or not registry.active_model_id:
        return "remote"

    provider = find_provider(registry, registry.active_provider_id)
    if provider is None:
        return "remote"

    if provider.source == "custom" and not is_remote_synced_provider(provider):
        return "local"

    return "remote"


def should_apply_remote_model_sync(registry: LlmRegistry) -> bool:
    """未配置活跃模型，或用户仍使用平台远程模型时，才允许登录同步。"""
    if registry.model_sync_policy == "local":
        return False
    if registry.model_sync_policy == "remote":
        return True
    if not registry.active_provider_id or not registry.active_model_id:
        return True
    if has_local_custom_provider(registry):
        return False
    return resolve_model_sync_policy(registry) == "remote"


def mark_registry_local_preference(registry: LlmRegistry) -> None:
    registry.model_sync_policy = "local"


def mark_registry_remote_preference(registry: LlmRegistry) -> None:
    registry.model_sync_policy = "remote"


def list_catalog_available(registry: LlmRegistry) -> list[str]:
    connected = {p.id for p in registry.providers if p.source == "builtin"}
    return [p.id for p in list_providers() if p.id not in connected]


def set_active(
    db: Session, registry: LlmRegistry, provider_id: str, model_id: str
) -> LlmRegistry:
    provider = find_provider(registry, provider_id)
    if provider is None:
        raise ValueError(f"未找到供应商: {provider_id}")
    model_trimmed = model_id.strip()
    if not any(m.id == model_trimmed for m in provider.models):
        raise ValueError(f"供应商 {provider_id} 下无模型: {model_trimmed}")
    registry.active_provider_id = provider_id
    registry.active_model_id = model_trimmed
    if is_remote_synced_provider(provider):
        mark_registry_remote_preference(registry)
    else:
        mark_registry_local_preference(registry)
    save_registry(db, registry)
    return registry


def clear_active_if_deleted(registry: LlmRegistry, deleted_id: str) -> None:
    if registry.active_provider_id == deleted_id:
        registry.active_provider_id = None
        registry.active_model_id = None


def resolve_active_from_kv(kv_data: dict[str, str]) -> tuple[str | None, str | None, str | None, str | None]:
    """Return (api_key, base_url, model, llm_provider) from registry active or None."""
    raw = kv_data.get(REGISTRY_KV_KEY)
    registry = _parse_registry_raw(raw)
    if registry is None or not registry.active_provider_id or not registry.active_model_id:
        return None, None, None, None
    provider = find_provider(registry, registry.active_provider_id)
    if provider is None:
        return None, None, None, None
    llm_provider = provider.id if provider.source == "builtin" else "custom"
    return (
        provider.api_key or None,
        provider.base_url,
        registry.active_model_id,
        llm_provider,
    )
