from typing import Any

from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from src.core.config import get_settings
import logging

logger = logging.getLogger(__name__)

class ModelCallRequest(BaseModel):
    prompt: str
    model_params: dict[str, Any] | None = None

class ModelService:
    """模型服务类 - 直接调用 ChatOpenAI"""

    @staticmethod
    async def call_model(
        prompt: str, model_params: dict[str, Any] | None = None
    ) -> Any:
        """调用 ChatOpenAI 并返回兼容历史结构的数据。"""
        if model_params is None:
            model_params = {}

        settings = get_settings()
        api_key = settings.api_key
        base_url = settings.base_url
        model_name = (
            model_params.get("model")
            or settings.deepagent_model
            or "qwen2.5-72b-instruct"
        )
        if not api_key:
            logger.error("未配置 OPENAI_API_KEY，无法调用模型。")
            return None

        try:
            llm_kwargs: dict[str, Any] = {
                "model": model_name,
                "api_key": api_key,
                "base_url": base_url,
            }
            if "temperature" in model_params:
                llm_kwargs["temperature"] = model_params["temperature"]

            for key, value in model_params.items():
                if key in {"model", "temperature"}:
                    continue
                llm_kwargs[key] = value

            model = ChatOpenAI(**llm_kwargs)
            response = model.invoke(prompt)
            content = response.content if hasattr(response, "content") else ""
            if isinstance(content, list):
                content = "".join(str(item) for item in content)
            return {"code": 1, "data": str(content), "message": "success"}
        except Exception as e:
            logger.error("调用 ChatOpenAI 失败: %s", e, exc_info=True)
            return None