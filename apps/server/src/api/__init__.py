from fastapi import APIRouter

from src.api.chat_api import router as chat_router
from src.api.config_kv_api import router as config_kv_router
from src.api.employee_api import router as employee_router
from src.api.feishu_api import router as feishu_router
from src.api.skill_api import router as skill_router
from src.api.task_api import router as task_router
from src.api.workspace_api import router as workspace_router
from src.api.model_api import router as model_router
from src.api.skill_rating_api import router as skill_rating_router
from src.api.login_api import router as login_router
from src.api.mcp_api import router as mcp_router
from src.api.orchestration_api import router as orchestration_router
from src.api.oauth_api import router as oauth_router
from src.api.performance_record_api import router as performance_record_router
from src.api.performance_balance_api import router as performance_balance_router
from src.api.system_api import router as system_router
from src.api.activation_api import router as activation_router
from src.api.feedback_api import router as feedback_router
from src.api.analytics_api import router as analytics_router
from src.api.avatar_api import router as avatar_router
from src.api.proxy_api import router as proxy_router
from src.api.channel_qrcode_api import router as channel_qrcode_router

api_router = APIRouter()
api_router.include_router(workspace_router)
api_router.include_router(employee_router)
api_router.include_router(feishu_router)
api_router.include_router(chat_router)
api_router.include_router(task_router)
api_router.include_router(skill_router)
api_router.include_router(skill_rating_router)
api_router.include_router(model_router)
api_router.include_router(login_router)
api_router.include_router(mcp_router)
api_router.include_router(config_kv_router)
api_router.include_router(orchestration_router)
api_router.include_router(oauth_router)
api_router.include_router(performance_record_router)
api_router.include_router(performance_balance_router)
api_router.include_router(system_router)
api_router.include_router(activation_router)
api_router.include_router(feedback_router)
api_router.include_router(analytics_router)
api_router.include_router(avatar_router)
api_router.include_router(proxy_router)
api_router.include_router(channel_qrcode_router)

__all__ = ["api_router"]

