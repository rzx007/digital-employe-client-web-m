from typing import Any, Dict, Optional
from datetime import datetime

from fastapi import APIRouter, Query

from src.models.response import ResponseBase
from src.service.feishu_bitable_service import FeishuBitableService
from src.service.feishu_token_service import FeishuTokenService

router = APIRouter(tags=["飞书"])


@router.get("/feishu/token", summary="获取飞书 tenant_access_token")
def get_feishu_tenant_access_token() -> ResponseBase[dict[str, Any]]:
    data = FeishuTokenService.get_token_state()
    return ResponseBase(data=data)


@router.get("/feishu/bitable/records", summary="获取飞书多维表格记录")
def get_feishu_bitable_records(
    page_size: int = Query(default=100, ge=1, le=500),
    page_token: str | None = Query(default=None),
    automatic_fields: bool = Query(default=True),
) -> ResponseBase[dict[str, Any]]:
    data = FeishuBitableService.search_records(
        page_size=page_size,
        page_token=page_token,
        automatic_fields=automatic_fields,
    )
    return ResponseBase(data=data)


@router.get(
    "/mock/queryTradeDailyRollEntity",
    summary="模拟获取交易日历",
    response_model=Dict,
)
async def mock_query_trade_daily_roll_entity(
    dateTime: Optional[str] = Query(None, description="目标日期，格式 YYYY-MM-DD，默认当天"),
):
    target_date = dateTime or datetime.now().strftime("%Y-%m-%d")
    response_data = {
        "code": 0,
        "msg": "操作成功",
        "data": [
            {
                "tradeseqName": f"{target_date.replace('-', '年', 1).replace('-', '月', 1)}日分时段能量块交易(模拟)",
                "beginDate": f"{target_date} 00:00:00",
                "endDate": f"{target_date} 00:00:00",
                "tradeType": "2",
                "tradeTypeName": "日滚动",
                "declareStartTime": f"{target_date} 16:30:00",
                "declareEndTime": f"{target_date} 17:30:00",
                "dataTime": target_date,
            }
        ],
    }
    return response_data


@router.get(
    "/mock/getSpotInfo",
    summary="模拟获取近10个月交易总览",
    response_model=Dict,
)
async def mock_get_spot_info():
    current = datetime.now()
    results = []
    for idx in range(10):
        month = current.month - idx
        year = current.year
        while month <= 0:
            month += 12
            year -= 1

        # 使用稳定公式构造模拟价格，便于前端联调时观察变化趋势
        month_avg_purchase_price = round(320 + idx * 1.35, 2)
        month_central_bidding_price = round(305 + idx * 1.28, 2)
        state_grid_purchase_price = round(335 + idx * 1.42, 2)
        results.append(
            {
                "dateTime": f"{year}-{month:02d}",
                "monthAvgPurchasePrice": f"{month_avg_purchase_price:.2f}",
                "monthCentralBiddingPrice": f"{month_central_bidding_price:.2f}",
                "stateGridPurchasePrice": f"{state_grid_purchase_price:.2f}",
            }
        )

    return {
        "responseType": "json",
        "totalSize": len(results),
        "resultCode": "0",
        "pageSize": 10,
        "currentPage": 1,
        "results": results,
    }
