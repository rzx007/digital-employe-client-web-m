from typing import Any

import logging

from pydantic import BaseModel

from src.core.config import get_settings
from src.llm.factory import build_chat_model

logger = logging.getLogger(__name__)


class ModelCallRequest(BaseModel):
    prompt: str
    model_params: dict[str, Any] | None = None


class ModelService:
    """模型服务类 - 通过 llm 工厂调用 ChatOpenAI"""

    @staticmethod
    async def call_model(
        prompt: str, model_params: dict[str, Any] | None = None
    ) -> Any:
        """调用 ChatOpenAI 并返回兼容历史结构的数据。"""
        if model_params is None:
            model_params = {}

        settings = get_settings()
        model_name = (
            model_params.get("model")
            or settings.deepagent_model
            or "qwen2.5-72b-instruct"
        )
        if not settings.api_key and not model_params.get("api_key"):
            if (settings.llm_provider or "custom") != "custom":
                logger.error("未配置 OPENAI_API_KEY，无法调用模型。")
                return None

        try:
            extra_kwargs: dict[str, Any] = {}
            temperature = model_params.get("temperature")
            if temperature is not None:
                extra_kwargs["temperature"] = temperature

            for key, value in model_params.items():
                if key in {"model", "temperature", "api_key", "base_url"}:
                    continue
                extra_kwargs[key] = value

            model = build_chat_model(
                model=model_name,
                api_key=model_params.get("api_key"),
                base_url=model_params.get("base_url"),
                apply_profile=False,
                **extra_kwargs,
            )
            response = model.invoke(prompt)
            content = response.content if hasattr(response, "content") else ""
            if isinstance(content, list):
                content = "".join(str(item) for item in content)
            return {"code": 1, "data": str(content), "message": "success"}
        except Exception as e:
            logger.error("调用 ChatOpenAI 失败: %s", e, exc_info=True)
            return None
