"""飞书审批客户端：列实例 / 取表单 / 读写评论。接口格式见 plan「已验证事实」。"""

from __future__ import annotations

import json
import urllib.parse
from dataclasses import dataclass

from license_issuer_server.feishu_token import FEISHU_BASE, FeishuError, _http_json


@dataclass
class Instance:
    instance_code: str
    status: str
    user_id: str | None
    device_code: str | None
    expires: str | None


class FeishuApproval:
    def __init__(self, token, approval_code: str, device_field: str,
                 expires_field: str, comment_prefix: str) -> None:
        self._token = token
        self._approval_code = approval_code
        self._device_field = device_field
        self._expires_field = expires_field
        self._prefix = comment_prefix

    def _auth(self) -> dict:
        return {"Authorization": f"Bearer {self._token.get()}"}

    def list_instances(self, start_ms: int, end_ms: int) -> list[str]:
        out: list[str] = []
        page_token = ""
        while True:
            params = {
                "approval_code": self._approval_code,
                "start_time": str(start_ms),
                "end_time": str(end_ms),
                "page_size": "50",
            }
            if page_token:
                params["page_token"] = page_token
            url = f"{FEISHU_BASE}/open-apis/approval/v4/instances?{urllib.parse.urlencode(params)}"
            r = _http_json("GET", url, headers=self._auth())
            if r.get("code") != 0:
                raise FeishuError(f"列实例失败: {r.get('code')} {r.get('msg')}")
            data = r.get("data", {})
            out.extend(data.get("instance_code_list", []))
            if data.get("has_more") and data.get("page_token"):
                page_token = data["page_token"]
                continue
            return out

    def get_instance(self, instance_code: str) -> Instance:
        url = f"{FEISHU_BASE}/open-apis/approval/v4/instances/{instance_code}"
        r = _http_json("GET", url, headers=self._auth())
        if r.get("code") != 0:
            raise FeishuError(f"取实例失败: {r.get('code')} {r.get('msg')}")
        data = r.get("data", {})
        form_raw = data.get("form") or "[]"
        widgets = json.loads(form_raw) if isinstance(form_raw, str) else form_raw
        by_id = {w.get("id"): w.get("value") for w in widgets}
        dev = by_id.get(self._device_field)
        exp_raw = by_id.get(self._expires_field)
        expires = exp_raw[:10] if isinstance(exp_raw, str) and len(exp_raw) >= 10 else None
        return Instance(
            instance_code=instance_code,
            status=data.get("status", ""),
            user_id=data.get("user_id"),
            device_code=dev if isinstance(dev, str) and dev else None,
            expires=expires,
        )

    def _comments_url(self, instance_code: str, user_id: str) -> str:
        q = urllib.parse.urlencode({"user_id_type": "user_id", "user_id": user_id})
        return f"{FEISHU_BASE}/open-apis/approval/v4/instances/{instance_code}/comments?{q}"

    def has_license_comment(self, instance_code: str, user_id: str) -> bool:
        r = _http_json("GET", self._comments_url(instance_code, user_id), headers=self._auth())
        if r.get("code") != 0:
            raise FeishuError(f"读评论失败: {r.get('code')} {r.get('msg')}")
        for c in r.get("data", {}).get("comments", []):
            # 飞书读评论返回字段为 content（部分文档/版本写作 comment，两者都兼容）
            raw = c.get("content") or c.get("comment")
            text = ""
            if isinstance(raw, str):
                try:
                    text = json.loads(raw).get("text", "")
                except Exception:
                    text = raw
            if text.startswith(self._prefix):
                return True
        return False

    def write_license_comment(self, instance_code: str, user_id: str, license_code: str) -> str:
        content = json.dumps({"text": f"{self._prefix}{license_code}"}, ensure_ascii=False)
        r = _http_json("POST", self._comments_url(instance_code, user_id),
                       body={"content": content}, headers=self._auth())
        if r.get("code") != 0:
            raise FeishuError(f"写评论失败: {r.get('code')} {r.get('msg')}")
        return r.get("data", {}).get("comment_id", "")
