import logging
import secrets
import json
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from src.core.config import get_settings
from src.service.oauth.feishu import register_feishu, get_feishu_client

router = APIRouter(prefix="/oauth", tags=["第三方登录"])
logger = logging.getLogger(__name__)

_CALLBACK_HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head><title>OAuth Callback</title></head>
<body>
<script>
(function() {{
  var data = {data_json};
  if (window.opener) {{
    window.opener.postMessage({{ type: "oauth_callback", payload: data }}, "*");
  }}
  window.close();
}})();
</script>
</body>
</html>"""


def _ensure_feishu_registered() -> None:
    settings = get_settings()
    if not settings.feishu_app_id or not settings.feishu_app_secret:
        raise HTTPException(
            status_code=500,
            detail="飞书 OAuth 未配置，请在 config_kvs 表中设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET",
        )
    redirect_uri = settings.feishu_redirect_uri or "http://localhost:34567 /oauth/feishu/callback"
    register_feishu(settings.feishu_app_id, settings.feishu_app_secret, redirect_uri)


@router.get("/{provider}/authorize")
async def oauth_authorize(provider: str, request: Request):
    if provider != "feishu":
        raise HTTPException(status_code=400, detail=f"不支持的 OAuth provider: {provider}")

    _ensure_feishu_registered()
    client = get_feishu_client()
    settings = get_settings()
    redirect_uri = settings.feishu_redirect_uri or "http://localhost:34567 /oauth/feishu/callback"

    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state

    authorization_url = await client.create_authorization_url(
        redirect_uri,
        state=state,
    )
    logger.info("Feishu authorize_url generated")
    return {"url": authorization_url["url"]}


@router.get("/{provider}/callback")
async def oauth_callback(provider: str, request: Request, code: str = "", state: str = ""):
    if provider != "feishu":
        raise HTTPException(status_code=400, detail=f"不支持的 OAuth provider: {provider}")

    if not code:
        error_html = _CALLBACK_HTML_TEMPLATE.format(
            data_json=json.dumps({"error": "missing_code", "provider": provider})
        )
        return HTMLResponse(content=error_html)

    saved_state = request.session.get("oauth_state")
    if saved_state and state != saved_state:
        error_html = _CALLBACK_HTML_TEMPLATE.format(
            data_json=json.dumps({"error": "state_mismatch", "provider": provider})
        )
        return HTMLResponse(content=error_html)

    _ensure_feishu_registered()
    settings = get_settings()
    redirect_uri = settings.feishu_redirect_uri or "http://localhost:34567 /oauth/feishu/callback"

    try:
        token = await _exchange_code_for_token(code, redirect_uri)
    except Exception as exc:
        logger.error("Feishu token exchange failed: %s", exc, exc_info=True)
        error_html = _CALLBACK_HTML_TEMPLATE.format(
            data_json=json.dumps({"error": str(exc), "provider": provider})
        )
        return HTMLResponse(content=error_html)

    try:
        user_info = await _get_feishu_user_info(token["access_token"])
    except Exception as exc:
        logger.error("Feishu user info failed: %s", exc, exc_info=True)
        error_html = _CALLBACK_HTML_TEMPLATE.format(
            data_json=json.dumps({"error": str(exc), "provider": provider})
        )
        return HTMLResponse(content=error_html)

    result = {
        "provider": "feishu",
        "access_token": token.get("access_token"),
        "user_info": user_info,
    }
    success_html = _CALLBACK_HTML_TEMPLATE.format(data_json=json.dumps(result))
    return HTMLResponse(content=success_html)


async def _exchange_code_for_token(code: str, redirect_uri: str) -> dict:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
            json={
                "grant_type": "authorization_code",
                "client_id": settings.feishu_app_id,
                "client_secret": settings.feishu_app_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"飞书 token 接口返回错误: {data.get('msg', data)}")
        return data


async def _get_feishu_user_info(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            "https://open.feishu.cn/open-apis/authen/v1/user_info",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"飞书用户信息接口返回错误: {data.get('msg', data)}")
        return data.get("data", {})
