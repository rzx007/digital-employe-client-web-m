from fastapi import APIRouter

from src.api.chat_api import router as chat_router
from src.api.employee_api import router as employee_router
from src.api.group_api import router as group_router
from src.api.task_api import router as task_router
from src.api.workspace_api import router as workspace_router

api_router = APIRouter()
api_router.include_router(workspace_router)
api_router.include_router(employee_router)
api_router.include_router(group_router)
api_router.include_router(chat_router)
api_router.include_router(task_router)

__all__ = ["api_router"]

