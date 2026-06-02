import logging
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.core.config import get_settings
from src.db.session import get_db
from src.llm.connection import ConnectionTestRequest, test_connection
from src.llm.providers import list_providers
from src.llm.registry import LlmModelEntry
from src.llm.vision import active_model_supports_vision
from src.llm.registry_service import (
    activate_model,
    add_custom_provider,
    add_preset_provider,
    delete_provider,
    get_available_catalog_ids,
    get_registry_for_api,
    test_provider_connection,
    update_provider,
)
from src.models.response import ResponseBase
from src.core.deps import require_capability
from src.service.config_kv_service import ConfigKvService
from src.service.modal_service import ModelCallRequest, ModelService

router = APIRouter(tags=["模型调用"])
logger = logging.getLogger(__name__)


class ModelCallResponse(BaseModel):
    success: bool
    data: Optional[dict[str, Any]] = None
    message: str = ""


class RuntimeModelConfigResponse(BaseModel):
    model: str
    base_url: str
    api_key_present: bool
    provider_id: str | None = None
    supports_vision: bool = False


class ProviderCatalogItem(BaseModel):
    id: str
    display_name: str
    base_url: str
    default_models: list[str]
    vision_models: list[str] = Field(default_factory=list)
    suggested_max_input_tokens: int | None = None


class TestConnectionRequest(BaseModel):
    provider_id: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None


class TestConnectionResponse(BaseModel):
    ok: bool
    provider_id: str
    normalized_base_url: str
    model: str
    message: str


class RegistryModelItem(BaseModel):
    id: str
    display_name: str | None = None
    supports_vision: bool | None = None


class RegistryProviderItem(BaseModel):
    id: str
    source: Literal["builtin", "custom"]
    display_name: str
    base_url: str
    api_key_masked: str = ""
    api_key_present: bool = False
    models: list[RegistryModelItem]


class LlmRegistryResponse(BaseModel):
    active_provider_id: str | None = None
    active_model_id: str | None = None
    providers: list[RegistryProviderItem] = Field(default_factory=list)


class RegistryModelInput(BaseModel):
    id: str
    display_name: str | None = None
    supports_vision: bool | None = None


class AddProviderRequest(BaseModel):
    source: Literal["preset", "custom"]
    catalog_id: str | None = None
    provider_id: str | None = None
    display_name: str | None = None
    base_url: str | None = None
    api_key: str = ""
    models: list[RegistryModelInput] | None = None
    set_as_active: bool = False


class UpdateProviderRequest(BaseModel):
    display_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    api_key_unchanged: bool = False
    models: list[RegistryModelInput] | None = None


class SetActiveModelRequest(BaseModel):
    provider_id: str
    model_id: str


class TestProviderRequest(BaseModel):
    model_id: str | None = None


class SyncFromRemoteResponse(BaseModel):
    synced: bool
    registry: LlmRegistryResponse


@router.post(
    "/model/sync-from-remote",
    summary="从平台手动同步模型配置",
    response_model=ResponseBase[SyncFromRemoteResponse],
    dependencies=[Depends(require_capability("remote_model_sync"))],
)
async def sync_model_from_remote(
    request: Request,
    db: Session = Depends(get_db),
):
    token = (request.headers.get("token") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="需要登录 token，请先登录后再同步")

    synced = ConfigKvService.sync_model_provider_from_remote(
        db, token=token, force=True
    )
    if not synced:
        raise HTTPException(
            status_code=502,
            detail="同步失败，请检查网络、平台地址或登录状态",
        )

    ConfigKvService._refresh_settings_cache()
    get_settings.cache_clear()
    data = get_registry_for_api(db)
    return ResponseBase(
        data=SyncFromRemoteResponse(
            synced=True,
            registry=LlmRegistryResponse.model_validate(data),
        ),
        msg="已从平台同步模型配置",
    )


@router.get(
    "/model/providers",
    summary="LLM 供应商目录",
    response_model=ResponseBase[list[ProviderCatalogItem]],
)
async def list_llm_providers():
    items = [
        ProviderCatalogItem(
            id=p.id,
            display_name=p.display_name,
            base_url=p.base_url,
            default_models=list(p.default_models),
            vision_models=sorted(p.vision_models),
            suggested_max_input_tokens=p.suggested_max_input_tokens,
        )
        for p in list_providers()
    ]
    return ResponseBase(data=items)


@router.post(
    "/model/test-connection",
    summary="测试 LLM 连接",
    response_model=ResponseBase[TestConnectionResponse],
)
async def test_llm_connection(payload: TestConnectionRequest):
    result = test_connection(
        ConnectionTestRequest(
            provider_id=payload.provider_id,
            base_url=payload.base_url,
            api_key=payload.api_key,
            model=payload.model,
        )
    )
    return ResponseBase(
        data=TestConnectionResponse(
            ok=result.ok,
            provider_id=result.provider_id,
            normalized_base_url=result.normalized_base_url,
            model=result.model,
            message=result.message,
        )
    )


@router.get(
    "/model/registry",
    summary="LLM 供应商注册表",
    response_model=ResponseBase[LlmRegistryResponse],
)
async def get_llm_registry(db: Session = Depends(get_db)):
    data = get_registry_for_api(db)
    return ResponseBase(data=LlmRegistryResponse.model_validate(data))


@router.get(
    "/model/registry/available-catalog",
    summary="尚未接入的预设供应商",
    response_model=ResponseBase[list[str]],
)
async def list_available_catalog(db: Session = Depends(get_db)):
    return ResponseBase(data=get_available_catalog_ids(db))


@router.post(
    "/model/providers",
    summary="新增已接入供应商",
    response_model=ResponseBase[LlmRegistryResponse],
)
async def create_llm_provider(
    payload: AddProviderRequest,
    db: Session = Depends(get_db),
):
    if payload.source == "preset":
        if not payload.catalog_id:
            raise HTTPException(status_code=400, detail="catalog_id 必填")
        models = (
            [
                LlmModelEntry(
                    id=m.id,
                    display_name=m.display_name,
                    supports_vision=m.supports_vision,
                )
                for m in payload.models
            ]
            if payload.models
            else None
        )
        data = add_preset_provider(
            db,
            catalog_id=payload.catalog_id,
            api_key=payload.api_key,
            models=models,
            set_as_active=payload.set_as_active,
        )
    else:
        if not payload.provider_id or not payload.display_name or not payload.base_url:
            raise HTTPException(
                status_code=400,
                detail="自定义供应商须填写 provider_id、display_name、base_url",
            )
        if not payload.models:
            raise HTTPException(status_code=400, detail="至少需要一个模型")
        data = add_custom_provider(
            db,
            provider_id=payload.provider_id,
            display_name=payload.display_name,
            base_url=payload.base_url,
            api_key=payload.api_key,
            models=[
                LlmModelEntry(
                    id=m.id,
                    display_name=m.display_name,
                    supports_vision=m.supports_vision,
                )
                for m in payload.models
            ],
            set_as_active=payload.set_as_active,
        )
    return ResponseBase(data=LlmRegistryResponse.model_validate(data))


@router.put(
    "/model/providers/{provider_id}",
    summary="更新已接入供应商",
    response_model=ResponseBase[LlmRegistryResponse],
)
async def update_llm_provider(
    provider_id: str,
    payload: UpdateProviderRequest,
    db: Session = Depends(get_db),
):
    models = (
        [
            LlmModelEntry(
                id=m.id,
                display_name=m.display_name,
                supports_vision=m.supports_vision,
            )
            for m in payload.models
        ]
        if payload.models is not None
        else None
    )
    data = update_provider(
        db,
        provider_id,
        display_name=payload.display_name,
        base_url=payload.base_url,
        api_key=payload.api_key,
        models=models,
        api_key_unchanged=payload.api_key_unchanged,
    )
    return ResponseBase(data=LlmRegistryResponse.model_validate(data))


@router.delete(
    "/model/providers/{provider_id}",
    summary="删除已接入供应商",
    response_model=ResponseBase[LlmRegistryResponse],
)
async def remove_llm_provider(provider_id: str, db: Session = Depends(get_db)):
    data = delete_provider(db, provider_id)
    return ResponseBase(data=LlmRegistryResponse.model_validate(data))


@router.put(
    "/model/active",
    summary="设为当前使用的模型（全局单选）",
    response_model=ResponseBase[LlmRegistryResponse],
)
async def set_active_llm_model(
    payload: SetActiveModelRequest,
    db: Session = Depends(get_db),
):
    data = activate_model(db, payload.provider_id, payload.model_id)
    return ResponseBase(data=LlmRegistryResponse.model_validate(data))


@router.post(
    "/model/providers/{provider_id}/test",
    summary="测试已接入供应商连接",
    response_model=ResponseBase[TestConnectionResponse],
)
async def test_connected_provider(
    provider_id: str,
    payload: TestProviderRequest | None = None,
    db: Session = Depends(get_db),
):
    model_id = payload.model_id if payload else None
    result = test_provider_connection(db, provider_id, model_id)
    return ResponseBase(
        data=TestConnectionResponse(
            ok=result["ok"],
            provider_id=result["provider_id"],
            normalized_base_url=result["normalized_base_url"],
            model=result["model"],
            message=result["message"],
        )
    )


@router.get(
    "/model/runtime-config",
    summary="运行时模型配置（无密钥）",
    response_model=ResponseBase[RuntimeModelConfigResponse],
)
async def get_runtime_model_config():
    settings = get_settings()
    return ResponseBase(
        data=RuntimeModelConfigResponse(
            model=settings.deepagent_model or "qwen2.5-72b-instruct",
            base_url=settings.base_url
            or "https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key_present=bool(settings.api_key),
            provider_id=settings.llm_provider,
            supports_vision=active_model_supports_vision(),
        )
    )


@router.post("/call-model", summary="调用模型API", response_model=ResponseBase[ModelCallResponse])
async def call_model_api(request: ModelCallRequest):
    """
    调用外部AI模型API
    """
    try:
        result = await ModelService.call_model(request.prompt, request.model_params)
        if result is not None:
            return ResponseBase(data=ModelCallResponse(
                success=True,
                data=result,
                message="模型调用成功"
            ))
        else:
            return ResponseBase(data=ModelCallResponse(
                success=False,
                data=None,
                message="模型调用失败"
            ))
    except Exception as e:
        logger.error("call-model 失败: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/simple-chat", summary="简单聊天接口", response_model=ResponseBase[dict[str, Any]])
async def simple_chat(prompt: str):
    """
    简单的聊天接口，直接传入提示词即可调用模型
    """
    try:
        result = await ModelService.call_model(prompt, {})
        return ResponseBase(data=result or {"error": "模型调用失败"})
    except Exception as e:
        logger.error("simple-chat 失败: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e
