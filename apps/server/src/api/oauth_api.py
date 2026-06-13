import logging
import os
import secrets
import json
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import HTMLResponse

from src.core.config import get_settings
from src.core.deps import require_capability
from src.service.oauth.feishu import register_feishu, get_feishu_client

router = APIRouter(prefix="/oauth", tags=["第三方登录"])
logger = logging.getLogger(__name__)

# 未配置 FEISHU_REDIRECT_URI 时的兜底回调地址。
# 注意：端口与路径之间不能有空格，否则飞书侧 redirect_uri 校验会失败导致扫码后白屏。
_DEFAULT_FEISHU_REDIRECT_URI = "http://localhost:34567/oauth/feishu/callback"

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
    redirect_uri = settings.feishu_redirect_uri or _DEFAULT_FEISHU_REDIRECT_URI
    register_feishu(settings.feishu_app_id, settings.feishu_app_secret, redirect_uri)


@router.get("/{provider}/authorize", dependencies=[Depends(require_capability("oauth"))])
async def oauth_authorize(provider: str, request: Request):
    if provider != "feishu":
        raise HTTPException(status_code=400, detail=f"不支持的 OAuth provider: {provider}")

    _ensure_feishu_registered()
    client = get_feishu_client()
    settings = get_settings()
    redirect_uri = settings.feishu_redirect_uri or _DEFAULT_FEISHU_REDIRECT_URI

    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state

    authorization_url = await client.create_authorization_url(
        redirect_uri,
        state=state,
    )
    logger.info("Feishu authorize_url generated")
    return {"url": authorization_url["url"]}


@router.get("/{provider}/callback", dependencies=[Depends(require_capability("oauth"))])
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
    redirect_uri = settings.feishu_redirect_uri or _DEFAULT_FEISHU_REDIRECT_URI

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

    # 用飞书 user_info 向业务后台换取本系统登录态（token + 用户信息）。
    # 业务后台只认它自己签发的 token，故飞书登录必须经此换取，不能直接用飞书 access_token。
    try:
        login_result = await _exchange_feishu_user_for_login(user_info)
    except Exception as exc:
        logger.error("Feishu -> 本系统登录换取失败: %s", exc, exc_info=True)
        error_html = _CALLBACK_HTML_TEMPLATE.format(
            data_json=json.dumps({"error": str(exc), "provider": provider})
        )
        return HTMLResponse(content=error_html)

    result = {
        "provider": "feishu",
        "user_info": user_info,
        # 业务后台登录结果：{ code, result:[user], token, msg }
        "login": login_result,
    }
    success_html = _CALLBACK_HTML_TEMPLATE.format(data_json=json.dumps(result))
    return HTMLResponse(content=success_html)


def _feishu_login_url() -> str:
    """业务后台「飞书换 token」端点：与 login_url 同源，路径替换为 /yc/loginFeishu。

    可用环境变量 FEISHU_LOGIN_URL 直接覆盖整个端点（如本地联调指向 http://127.0.0.1:5002/yc/loginFeishu）。
    """
    override = (os.environ.get("FEISHU_LOGIN_URL") or "").strip()
    if override:
        return override
    login_url = (get_settings().login_url or "").strip()
    if not login_url:
        raise RuntimeError("未配置登录服务地址（REMOTE_API_BASE_URL / LOGIN_PATH）。")
    if login_url.endswith("/yc/login"):
        return login_url[: -len("/yc/login")] + "/yc/loginFeishu"
    # 兜底：直接在 base 上拼端点
    base = login_url.rsplit("/", 1)[0]
    return f"{base}/yc/loginFeishu"


async def _exchange_feishu_user_for_login(user_info: dict) -> dict:
    url = _feishu_login_url()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json={"name": user_info.get("name", ""), "user_info": user_info})
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 1 or not data.get("token"):
            raise RuntimeError(f"业务后台飞书登录失败: {data.get('msg', data)}")
        return data


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
