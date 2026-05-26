"""Business logic for LLM provider registry CRUD and validation."""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from src.llm.connection import ConnectionTestRequest, test_connection
from src.llm.providers import get_provider
from src.llm.providers.url import normalize_openai_base_url
from src.llm.registry import (
    CUSTOM_ID_PATTERN,
    LlmModelEntry,
    LlmProviderEntry,
    LlmRegistry,
    clear_active_if_deleted,
    find_provider,
    list_catalog_available,
    load_registry,
    registry_for_api,
    save_registry,
    set_active,
)

_RESERVED_CUSTOM_IDS = frozenset({"custom"})


def get_registry_for_api(db: Session) -> dict:
    registry = load_registry(db)
    return registry_for_api(registry)


def _validate_custom_id(provider_id: str) -> str:
    pid = provider_id.strip().lower()
    if pid in _RESERVED_CUSTOM_IDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"供应商 ID 不可用: {pid}",
        )
    if not CUSTOM_ID_PATTERN.match(pid):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自定义供应商 ID 须为小写字母开头，仅含小写字母、数字、连字符、下划线",
        )
    return pid


def _normalize_models(models: list[LlmModelEntry]) -> list[LlmModelEntry]:
    seen: set[str] = set()
    out: list[LlmModelEntry] = []
    for item in models:
        mid = item.id.strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        display = (item.display_name or "").strip() or None
        out.append(LlmModelEntry(id=mid, display_name=display))
    if not out:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="至少需要一个模型",
        )
    return out


def _normalize_base_url(base_url: str) -> str:
    try:
        return normalize_openai_base_url(base_url)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


def _ensure_unique_provider_id(registry: LlmRegistry, provider_id: str) -> None:
    if find_provider(registry, provider_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"供应商已存在: {provider_id}",
        )


def add_preset_provider(
    db: Session,
    *,
    catalog_id: str,
    api_key: str,
    models: list[LlmModelEntry] | None = None,
    set_as_active: bool = False,
) -> dict:
    profile = get_provider(catalog_id)
    if profile is None or profile.id == "custom":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"未知预设供应商: {catalog_id}",
        )

    registry = load_registry(db)
    _ensure_unique_provider_id(registry, profile.id)

    model_entries = _normalize_models(
        models
        if models
        else [LlmModelEntry(id=m) for m in profile.default_models]
    )

    entry = LlmProviderEntry(
        id=profile.id,
        source="builtin",
        display_name=profile.display_name,
        base_url=profile.base_url,
        api_key=api_key.strip(),
        models=model_entries,
    )
    registry.providers.append(entry)

    if set_as_active and model_entries:
        registry.active_provider_id = entry.id
        registry.active_model_id = model_entries[0].id

    save_registry(db, registry)

    return registry_for_api(registry)


def add_custom_provider(
    db: Session,
    *,
    provider_id: str,
    display_name: str,
    base_url: str,
    api_key: str = "",
    models: list[LlmModelEntry],
    set_as_active: bool = False,
) -> dict:
    pid = _validate_custom_id(provider_id)
    registry = load_registry(db)
    _ensure_unique_provider_id(registry, pid)

    entry = LlmProviderEntry(
        id=pid,
        source="custom",
        display_name=display_name.strip(),
        base_url=_normalize_base_url(base_url),
        api_key=api_key.strip(),
        models=_normalize_models(models),
    )
    registry.providers.append(entry)

    if set_as_active:
        registry.active_provider_id = entry.id
        registry.active_model_id = entry.models[0].id

    save_registry(db, registry)

    return registry_for_api(registry)


def update_provider(
    db: Session,
    provider_id: str,
    *,
    display_name: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    models: list[LlmModelEntry] | None = None,
    api_key_unchanged: bool = False,
) -> dict:
    registry = load_registry(db)
    entry = find_provider(registry, provider_id)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未找到供应商: {provider_id}",
        )

    if display_name is not None:
        trimmed = display_name.strip()
        if not trimmed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="显示名称不能为空",
            )
        entry.display_name = trimmed

    if base_url is not None:
        if entry.source == "builtin":
            profile = get_provider(entry.id)
            if profile and base_url.strip() != profile.base_url:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="预设供应商不可修改基础 URL",
                )
        else:
            entry.base_url = _normalize_base_url(base_url)

    if models is not None:
        entry.models = _normalize_models(models)
        if (
            registry.active_provider_id == provider_id
            and registry.active_model_id
            and not any(m.id == registry.active_model_id for m in entry.models)
        ):
            registry.active_model_id = entry.models[0].id

    if api_key is not None and not api_key_unchanged:
        entry.api_key = api_key.strip()

    save_registry(db, registry)

    return registry_for_api(registry)


def delete_provider(db: Session, provider_id: str) -> dict:
    registry = load_registry(db)
    before = len(registry.providers)
    registry.providers = [p for p in registry.providers if p.id != provider_id]
    if len(registry.providers) == before:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未找到供应商: {provider_id}",
        )
    clear_active_if_deleted(registry, provider_id)
    save_registry(db, registry)
    return registry_for_api(registry)


def activate_model(db: Session, provider_id: str, model_id: str) -> dict:
    registry = load_registry(db)
    try:
        set_active(db, registry, provider_id, model_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return registry_for_api(load_registry(db))


def test_provider_connection(
    db: Session,
    provider_id: str,
    model_id: str | None = None,
) -> dict:
    registry = load_registry(db)
    entry = find_provider(registry, provider_id)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未找到供应商: {provider_id}",
        )

    model = (model_id or "").strip()
    if not model:
        if registry.active_provider_id == provider_id and registry.active_model_id:
            model = registry.active_model_id
        elif entry.models:
            model = entry.models[0].id
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="请指定要测试的模型",
            )

    probe_provider_id = entry.id if entry.source == "builtin" else "custom"
    result = test_connection(
        ConnectionTestRequest(
            provider_id=probe_provider_id,
            base_url=entry.base_url,
            api_key=entry.api_key or None,
            model=model,
        )
    )
    return {
        "ok": result.ok,
        "provider_id": result.provider_id,
        "normalized_base_url": result.normalized_base_url,
        "model": result.model,
        "message": result.message,
    }


def upsert_from_remote_sync(
    db: Session,
    *,
    model_name: str,
    api_key: str,
    api_url: str,
    set_as_active: bool = True,
) -> bool:
    """从远程登录同步中插入或更新LLM提供商配置到注册表。

    该函数根据API URL解析提供商ID，规范化基础URL，然后创建或更新对应的提供商配置。
    如果是内置提供商则使用预定义的显示名称和默认模型列表；如果是自定义提供商则使用通用配置。
    同时支持将新配置的提供商设置为活跃状态。

    Args:
        db: 数据库会话对象，用于读取和保存注册表数据
        model_name: 模型名称标识符，将作为主要模型添加到提供商配置中
        api_key: API密钥，用于认证对该LLM服务的访问
        api_url: API服务的基础URL地址，用于推断提供商类型和配置连接信息
        set_as_active: 是否将此提供商和模型设置为当前活跃配置，默认为True

    Returns:
        bool: 操作成功返回True，表示提供商配置已成功插入或更新到注册表中

    Raises:
        ValueError: 当API URL格式无效且无法规范化时可能抛出异常（在normalize_openai_base_url中）
    """
    from src.llm.providers import resolve_provider_id

    # 加载当前注册表并解析提供商ID
    registry = load_registry(db)
    inferred = resolve_provider_id(api_url)

    # 规范化OpenAI风格的基础URL，失败则使用原始URL
    try:
        normalized_url = normalize_openai_base_url(api_url)
    except ValueError:
        normalized_url = api_url.strip()

    # 根据解析的提供商ID获取提供商配置文件，区分内置和自定义提供商
    profile = get_provider(inferred)
    if profile and inferred != "custom":
        entry_id = profile.id
        source: Literal["builtin", "custom"] = "builtin"
        display_name = profile.display_name
        base_url = normalized_url
    else:
        entry_id = inferred if inferred != "custom" else "custom"
        source = "custom"
        display_name = "远程同步供应商"
        base_url = normalized_url

    # 查找现有提供商配置，存在则更新，不存在则创建新配置
    existing = find_provider(registry, entry_id)
    model_entry = LlmModelEntry(id=model_name)
    if existing:
        existing.api_key = api_key
        existing.base_url = base_url
        if not any(m.id == model_name for m in existing.models):
            existing.models.insert(0, model_entry)
    else:
        models = [model_entry]
        if profile and source == "builtin":
            for mid in profile.default_models:
                if mid != model_name:
                    models.append(LlmModelEntry(id=mid))
        registry.providers.append(
            LlmProviderEntry(
                id=entry_id,
                source=source,
                display_name=display_name,
                base_url=base_url,
                api_key=api_key,
                models=models,
            )
        )

    # 如果需要则设置为活跃提供商和模型
    if set_as_active:
        registry.active_provider_id = entry_id
        registry.active_model_id = model_name

    # 保存注册表
    save_registry(db, registry)
    return True


def get_available_catalog_ids(db: Session) -> list[str]:
    return list_catalog_available(load_registry(db))
