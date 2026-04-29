from typing import Any

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

