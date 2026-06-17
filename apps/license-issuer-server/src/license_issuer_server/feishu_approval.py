"""飞书审批客户端：列实例 / 取表单 / 读写评论。接口格式见 plan「已验证事实」。"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass

from license_issuer_server.feishu_token import FEISHU_BASE, FeishuError, _http_json

# 激活文件名（deploy 候选路径 ~/BobanStaff/activation/license.code 之一）
LICENSE_FILENAME = "license.code"
# 放置目录（与 deploy-activation.sh 的 DE_LICENSE_FILE_CANDIDATES 对齐）
LICENSE_DIR = "~/BobanStaff/activation/"


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

    def _upload_license_file(self, license_code: str) -> tuple[str, int]:
        """上传激活码为附件文件，返回 (file_url, size)。失败抛 FeishuError。

        关键：评论 files 字段需要上传返回的真实 url（带签名），不能只填 code、url 留空，
        否则附件挂上但下载不了（实例查回来 url 为空）。真机验证过。
        """
        data_bytes = (license_code + "\n").encode("utf-8")
        boundary = "----deiss" + uuid.uuid4().hex
        parts = []

        def field(name, value):
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
            )

        field("name", LICENSE_FILENAME)
        field("type", "attachment")
        parts.append(
            (f'--{boundary}\r\nContent-Disposition: form-data; name="content"; '
             f'filename="{LICENSE_FILENAME}"\r\n'
             f'Content-Type: application/octet-stream\r\n\r\n').encode()
            + data_bytes + b"\r\n"
        )
        body = b"".join(parts) + f"--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            f"{FEISHU_BASE}/open-apis/approval/v4/files/upload",
            data=body,
            headers={**self._auth(),
                     "Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                r = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise FeishuError(f"上传激活文件 HTTP {exc.code}") from exc
        except Exception as exc:  # noqa: BLE001
            raise FeishuError(f"上传激活文件失败: {exc}") from exc
        if r.get("code") != 0:
            raise FeishuError(f"上传激活文件失败: {r.get('code')} {r.get('msg')}")
        details = r.get("data", {}).get("urls_detail", [])
        if not details or not details[0].get("url"):
            raise FeishuError("上传激活文件未返回可下载 url")
        return details[0]["url"], len(data_bytes)

    def _guide_text(self, license_code: str) -> str:
        """评论正文：激活码 + 可操作指引（前缀开头，供防重识别）。"""
        return (
            f"{self._prefix}{license_code}\n\n"
            f"【使用方法】\n"
            f"1. 下载本评论附件 {LICENSE_FILENAME}（或复制上面这串激活码，存为 {LICENSE_FILENAME}）\n"
            f"2. 放到目标机目录：{LICENSE_DIR}\n"
            f"3. 在目标机重新运行 deploy.sh，即自动完成激活\n"
            f"（也可在 deploy 激活阶段提示时直接粘贴上面的激活码）"
        )

    def write_license_comment(self, instance_code: str, user_id: str, license_code: str) -> str:
        """回写：上传激活文件作附件 + 发带使用指引的评论。

        附件上传失败时降级为纯文本评论（仍含激活码与指引），保证激活码必达。
        """
        files = []
        try:
            file_url, size = self._upload_license_file(license_code)
            # 必须填真实 url + file_size，附件才可下载（真机验证）
            files = [{"url": file_url, "file_size": size, "title": LICENSE_FILENAME,
                      "type": "attachment"}]
        except FeishuError:
            files = []  # 降级：无附件，仅文本

        content_obj = {"text": self._guide_text(license_code)}
        if files:
            content_obj["files"] = files
        content = json.dumps(content_obj, ensure_ascii=False)
        r = _http_json("POST", self._comments_url(instance_code, user_id),
                       body={"content": content}, headers=self._auth())
        if r.get("code") != 0:
            raise FeishuError(f"写评论失败: {r.get('code')} {r.get('msg')}")
        return r.get("data", {}).get("comment_id", "")
