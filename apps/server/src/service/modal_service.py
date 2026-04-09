from typing import Any

from pydantic import BaseModel
from src.core.config import get_settings
import aiohttp
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

class ModelCallRequest(BaseModel):
    prompt: str
    model_params: dict[str, Any] | None = None

class ModelService:
    """模型服务类 - 用于调用外部AI模型API"""

    @staticmethod
    async def call_model(
        prompt: str, model_params: dict[str, Any] | None = None
    ) -> Any:
        """
        调用外部模型API
        注意：这里的URL需要根据实际部署环境调整
        """
        if model_params is None:
            model_params = {}


        url = settings.dbchat_base_url + "/model/chat/simple"  # 需要根据实际情况调整

        try:
            async with aiohttp.ClientSession() as session:
                payload = {"prompt": prompt, "model_params": model_params}
                async with session.post(url, json=payload) as response:
                    response_data = await response.json()
                    return response_data
        except aiohttp.ClientError as e:
            logger.error(f"Error calling model API: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error calling model API: {str(e)}")
            return None