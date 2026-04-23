import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional

from src.core.config import get_settings
from src.service.modal_service import ModelCallRequest, ModelService
from src.models.response import ResponseBase

router = APIRouter(tags=["模型调用"])
logger = logging.getLogger(__name__)


class ModelCallResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    message: str = ""


class RuntimeModelConfigResponse(BaseModel):
    model: str
    base_url: str
    api_key_present: bool


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


@router.post("/simple-chat", summary="简单聊天接口", response_model=ResponseBase[Dict[str, Any]])
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


@router.get(
    "/runtime/model-config",
    summary="获取运行态模型配置",
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
        )
    )
