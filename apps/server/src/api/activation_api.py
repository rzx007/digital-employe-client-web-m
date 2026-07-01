"""激活相关 HTTP 路由（独立前缀 /activation/*，便于拔插）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from src.core.activation import license as lic
from src.models.response import ResponseBase
from src.service.activation_service import ActivationService

router = APIRouter(prefix="/activation", tags=["激活"])


class ActivateRequest(BaseModel):
    license_code: str


def _status_dict(status) -> dict[str, Any]:
    return {
        "enforced": status.enforced,
        "activated": status.activated,
        "expires_at": status.expires_at,
        "days_remaining": status.days_remaining,
        "reason": status.reason,
    }


@router.get("/device", response_model=ResponseBase[dict[str, Any]])
def get_device() -> ResponseBase[dict[str, Any]]:
    return ResponseBase(data={"device_code": ActivationService.get_device_code()})


@router.get("/status", response_model=ResponseBase[dict[str, Any]])
def get_activation_status() -> ResponseBase[dict[str, Any]]:
    return ResponseBase(data=_status_dict(ActivationService.get_status()))


@router.post("/activate", response_model=ResponseBase[dict[str, Any]])
def activate(payload: ActivateRequest) -> ResponseBase[dict[str, Any]]:
    try:
        result = ActivationService.activate(payload.license_code)
    except lic.LicenseDeviceMismatchError:
        return ResponseBase(code=400, msg="授权码与当前设备不匹配", data=None)
    except lic.LicenseExpiredError:
        return ResponseBase(code=400, msg="授权码已过期", data=None)
    except lic.LicenseSignatureError:
        return ResponseBase(code=400, msg="授权码签名无效", data=None)
    except lic.LicenseError as exc:
        return ResponseBase(code=400, msg=f"授权码无效: {exc}", data=None)
    return ResponseBase(data=_status_dict(result), msg="激活成功")
