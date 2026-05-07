from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import ResponseBase
from src.service.performance_balance_service import PerformanceBalanceService

router = APIRouter(tags=["绩效管理"])


@router.get(
    "/performance/monthly-balance",
    response_model=ResponseBase[Any],
    summary="远程月度结算查询",
)
async def get_monthly_balance(
    db: Session = Depends(get_db),
) -> ResponseBase[Any]:
    data = await PerformanceBalanceService.get_remote_monthly_balance(db)
    return ResponseBase(data=data)


@router.get(
    "/performance/dispatch-orders",
    response_model=ResponseBase[Any],
    summary="远程绩效派单查询",
)
async def get_dispatch_orders(
    db: Session = Depends(get_db),
) -> ResponseBase[Any]:
    data = await PerformanceBalanceService.get_remote_dispatch_orders(db)
    return ResponseBase(data=data)

