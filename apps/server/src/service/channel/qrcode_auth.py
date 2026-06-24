from __future__ import annotations
import base64
import io
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import segno

PROJECT_NAME = "DigitalEmployee"
_FEISHU_ACCOUNTS_DOMAIN = "https://accounts.feishu.cn"
_FEISHU_REGISTER_ENDPOINT = "/oauth/v1/app/registration"
_FORM_HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}


@dataclass
class QRCodeResult:
    scan_url: str
    poll_token: str


@dataclass
class PollResult:
    status: str  # waiting | success | expired | fail
    credentials: dict[str, Any]


class QRCodeAuthHandler(ABC):
    @abstractmethod
    async def fetch_qrcode(self) -> QRCodeResult: ...
    @abstractmethod
    async def poll_status(self, token: str) -> PollResult: ...


def generate_qrcode_image(scan_url: str) -> str:
    qr = segno.make(scan_url, error="M")
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=6, border=2)
    return base64.b64encode(buf.getvalue()).decode()


def _normalize_feishu_poll(data: dict[str, Any]) -> PollResult:
    if data.get("client_id") and data.get("client_secret"):
        user_info = data.get("user_info", {}) or {}
        return PollResult("success", {
            "app_id": data["client_id"],
            "app_secret": data["client_secret"],
            "open_id": user_info.get("open_id", ""),
        })
    error = data.get("error", "")
    if error in ("expired_token", "invalid_grant"):
        return PollResult("expired", {"fail_reason": "二维码已过期"})
    if error == "access_denied":
        return PollResult("fail", {"fail_reason": "用户拒绝授权"})
    if error and error not in ("authorization_pending", "slow_down"):
        return PollResult("fail", {"fail_reason": error})
    return PollResult("waiting", {})


class FeishuQRCodeAuthHandler(QRCodeAuthHandler):
    async def fetch_qrcode(self) -> QRCodeResult:
        import httpx
        endpoint = _FEISHU_ACCOUNTS_DOMAIN + _FEISHU_REGISTER_ENDPOINT
        async with httpx.AsyncClient(timeout=15) as client:
            init = await client.post(endpoint, content=urlencode({"action": "init"}), headers=_FORM_HEADERS)
            init.raise_for_status()
            if "client_secret" not in (init.json().get("supported_auth_methods") or []):
                raise RuntimeError("Feishu: client_secret auth not supported")
            begin = await client.post(endpoint, content=urlencode({
                "action": "begin", "archetype": "PersonalAgent",
                "auth_method": "client_secret", "request_user_info": "open_id",
            }), headers=_FORM_HEADERS)
            begin.raise_for_status()
            bd = begin.json()
            device_code = bd.get("device_code", "")
            verification_uri = bd.get("verification_uri_complete", "")
            if not device_code or not verification_uri:
                raise RuntimeError("Feishu: missing device_code or verification_uri")
            sep = "&" if "?" in verification_uri else "?"
            scan_url = f"{verification_uri}{sep}source={PROJECT_NAME}"
            return QRCodeResult(scan_url=scan_url, poll_token=device_code)

    async def poll_status(self, token: str) -> PollResult:
        import httpx
        endpoint = _FEISHU_ACCOUNTS_DOMAIN + _FEISHU_REGISTER_ENDPOINT
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(endpoint, content=urlencode({
                "action": "poll", "device_code": token,
            }), headers=_FORM_HEADERS)
            return _normalize_feishu_poll(resp.json())


QRCODE_AUTH_HANDLERS: dict[str, QRCodeAuthHandler] = {
    "feishu": FeishuQRCodeAuthHandler(),
}
