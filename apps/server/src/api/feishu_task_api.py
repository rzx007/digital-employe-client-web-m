from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import ListResponse
from src.schemas.feishu_task import FeishuTaskRead
from src.service.feishu_task_sync_service import FeishuTaskSyncService

router = APIRouter(tags=["飞书任务"])


@router.get(
    "/feishu/tasks/current-user",
    response_model=ListResponse[FeishuTaskRead],
    summary="查询当前用户飞书任务",
)
def list_current_user_feishu_tasks(
    db: Session = Depends(get_db),
) -> ListResponse[FeishuTaskRead]:
    rows = FeishuTaskSyncService.get_current_user_tasks(db)
    return ListResponse(data=[FeishuTaskRead.model_validate(row) for row in rows])
