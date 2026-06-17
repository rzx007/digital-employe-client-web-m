"""飞书 tenant_access_token 获取与缓存。标准库 urllib，无第三方依赖。"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

FEISHU_BASE = "https://open.feishu.cn"


class FeishuError(RuntimeError):
    """飞书接口返回非 0 code 或网络错误。"""


def _http_json(method: str, url: str, body: dict | None = None,
               headers: dict | None = None) -> dict:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    h = {"Content-Type": "application/json; charset=utf-8"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except Exception:
            raise FeishuError(f"HTTP {exc.code}: {raw[:200]}") from exc
    except Exception as exc:  # noqa: BLE001
        raise FeishuError(str(exc)) from exc


class FeishuToken:
    def __init__(self, app_id: str, app_secret: str) -> None:
        self._app_id = app_id
        self._app_secret = app_secret
        self._token: str | None = None
        self._expire_at: float = 0.0

    def get(self, now: float | None = None) -> str:
        cur = now if now is not None else time.time()
        if self._token and cur < self._expire_at:
            return self._token
        r = _http_json(
            "POST",
            f"{FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal",
            {"app_id": self._app_id, "app_secret": self._app_secret},
        )
        if r.get("code") != 0:
            raise FeishuError(f"获取 token 失败: {r.get('code')} {r.get('msg')}")
        self._token = r["tenant_access_token"]
        self._expire_at = cur + int(r.get("expire", 7200)) - 300
        return self._token
