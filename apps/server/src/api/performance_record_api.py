from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import ListResponse
from src.schemas.performance_record import PerformanceRecordRead
from src.service.performance_record_service import PerformanceRecordService

router = APIRouter(tags=["绩效管理"])


@router.get(
    "/performance-records/current-month",
    response_model=ListResponse[PerformanceRecordRead],
    summary="查询当月绩效（按 config_kvs.username）",
)
def get_current_month_performance_records(
    db: Session = Depends(get_db),
) -> ListResponse[PerformanceRecordRead]:
    rows = PerformanceRecordService.get_current_month_records_by_username(db)
    return ListResponse(data=[PerformanceRecordRead.model_validate(row) for row in rows])
