async def test_feishu_credentials(app_id: str, app_secret: str) -> tuple[bool, str]:
    """拿 app_id/secret 直连飞书换 tenant_access_token 判有效。返回 (ok, message)。"""
    import httpx
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={"app_id": app_id, "app_secret": app_secret})
            data = resp.json()
    except Exception as exc:
        return False, f"连接失败：{exc}"
    if data.get("code") == 0:
        return True, "连接成功"
    return False, data.get("msg") or f"飞书返回错误 code={data.get('code')}"


CHANNEL_CRED_TESTERS = {"feishu": test_feishu_credentials}
