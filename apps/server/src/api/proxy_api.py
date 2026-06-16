"""看板 HTML 跨域代理。

看板 HTML 在沙箱 iframe（Origin: null 不透明源）里直接 fetch 不支持 CORS 的第三方接口会被
浏览器拦死，且主进程改 CORS 头对不透明源无效。前端在注入 srcDoc 前会把外部 fetch URL 透明
重写为 /proxy?url=<原URL>，由本端点服务端到服务端拉取（服务端无 CORS）后原样回传，并补上
Access-Control-Allow-Origin:* 让 iframe 能读到。
"""

import logging

import httpx
from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse

router = APIRouter(tags=["代理"])
logger = logging.getLogger(__name__)

# 透传给上游的请求头（避免把本地 token/cookie 等带出去）
_FORWARD_REQUEST_HEADERS = ("accept", "accept-language", "user-agent")
# 回传给前端时剔除的逐跳头
_STRIP_RESPONSE_HEADERS = {
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
}
_ALLOW_CORS = {"Access-Control-Allow-Origin": "*"}


@router.get("/proxy", summary="看板跨域代理（GET 拉取外部接口）")
async def proxy_get(
    url: str = Query(..., description="要代理拉取的完整 http(s) 地址"),
) -> Response:
    if not (url.startswith("http://") or url.startswith("https://")):
        return JSONResponse(
            status_code=400,
            content={"detail": "仅支持 http/https 地址"},
            headers=_ALLOW_CORS,
        )

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=20.0
        ) as client:
            upstream = await client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("proxy fetch failed: %s (%s)", url, exc)
        return JSONResponse(
            status_code=502,
            content={"detail": f"代理拉取失败：{exc}"},
            headers=_ALLOW_CORS,
        )

    headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in _STRIP_RESPONSE_HEADERS
    }
    headers.update(_ALLOW_CORS)

    media_type = upstream.headers.get("content-type")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=headers,
        media_type=media_type,
    )
