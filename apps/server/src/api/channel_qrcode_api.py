from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from src.core.deps import require_capability
from src.models.response import ResponseBase
from src.service.channel.qrcode_auth import QRCODE_AUTH_HANDLERS, generate_qrcode_image

router = APIRouter(
    tags=["渠道"],
    dependencies=[Depends(require_capability("feishu_platform"))],
)


def _require_handler(channel: str):
    handler = QRCODE_AUTH_HANDLERS.get(channel)
    if handler is None:
        raise HTTPException(status_code=404, detail=f"未知渠道：{channel}")
    return handler


@router.get("/channels/{channel}/qrcode", summary="获取渠道扫码二维码")
async def get_channel_qrcode(channel: str) -> ResponseBase[dict[str, Any]]:
    handler = _require_handler(channel)
    try:
        result = await handler.fetch_qrcode()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取二维码失败：{exc}") from exc
    return ResponseBase(data={
        "qrcode_img": generate_qrcode_image(result.scan_url),
        "poll_token": result.poll_token,
    })


@router.get("/channels/{channel}/qrcode/status", summary="轮询渠道扫码授权状态")
async def get_channel_qrcode_status(
    channel: str, token: str = Query(...),
) -> ResponseBase[dict[str, Any]]:
    handler = _require_handler(channel)
    try:
        result = await handler.poll_status(token)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"轮询状态失败：{exc}") from exc
    return ResponseBase(data={"status": result.status, "credentials": result.credentials})
