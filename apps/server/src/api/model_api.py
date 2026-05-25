import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from src.core.config import get_settings
from src.llm.connection import ConnectionTestRequest, test_connection
from src.llm.providers import list_providers
from src.service.modal_service import ModelCallRequest, ModelService
from src.models.response import ResponseBase

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


class ProviderCatalogItem(BaseModel):
    id: str
    display_name: str
    base_url: str
    default_models: list[str]
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
