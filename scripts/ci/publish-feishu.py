#!/usr/bin/env python3
"""
GitLab CI：将 release 构建产物写入飞书多维表格（Bitable）。

目标表（版本管理）：
  https://scnj8otdvysf.feishu.cn/wiki/Zc3XwAhsMiJPUEk7IimcHMfKnoc?table=tblhM5KRRT2i8YsP

GitLab CI/CD Variables（Masked，勿写入仓库）：
  FEISHU_APP_ID
  FEISHU_APP_SECRET

可选 Variables：
  FEISHU_BITABLE_APP_TOKEN   多维表格 app_token；未设则从 FEISHU_BITABLE_WIKI_NODE 解析
  FEISHU_BITABLE_WIKI_NODE   Wiki 中嵌入多维表格的 node token
  FEISHU_BITABLE_TABLE_ID
  FEISHU_BITABLE_URL         表格链接（仅日志展示）

应用权限：bitable:app
资源授权：目标多维表格 → … → 添加文档应用 → 可管理
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

FEISHU_API = "https://open.feishu.cn/open-apis"
DEFAULT_WIKI_NODE = "Zc3XwAhsMiJPUEk7IimcHMfKnoc"
DEFAULT_TABLE_ID = "tblhM5KRRT2i8YsP"
DEFAULT_BITABLE_URL = (
    "https://scnj8otdvysf.feishu.cn/wiki/Zc3XwAhsMiJPUEk7IimcHMfKnoc"
    "?table=tblhM5KRRT2i8YsP&view=vewYirQnN3"
)
CHUNK_SIZE = 4 * 1024 * 1024
UPLOAD_ALL_LIMIT = 20 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[2]

ARTIFACT_DIRS = [ROOT / "apps/web/release", ROOT / "release"]
PACKAGE_SUFFIXES = {".exe", ".dmg", ".zip", ".deb"}

FIELD_VERSION = "版本"
FIELD_PLATFORM = "平台"
FIELD_FILENAME = "文件名"
FIELD_ATTACHMENT = "附件"
FIELD_BUILD_TIME = "构建时间"
FIELD_PIPELINE = "流水线"
FIELD_TAG = "Tag"

PLATFORM_OPTIONS = ["Windows", "macOS", "Linux", "其他"]


def log(msg: str) -> None:
    print(msg, flush=True)


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def json_request(
    method: str,
    url: str,
    token: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = None
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise RuntimeError(f"Feishu API error: {payload.get('msg')} ({payload})")
    return payload.get("data") or {}


def multipart_upload(
    url: str,
    token: str,
    fields: dict[str, str],
    file_field: str,
    file_name: str,
    file_bytes: bytes,
) -> dict[str, Any]:
    boundary = f"----FeishuBoundary{uuid.uuid4().hex}"
    body = bytearray()
    for key, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        )
        body.extend(f"{value}\r\n".encode())
    mime = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(
        (
            f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{file_name}"\r\n'
        ).encode()
    )
    body.extend(f"Content-Type: {mime}\r\n\r\n".encode())
    body.extend(file_bytes)
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    req = Request(
        url,
        data=bytes(body),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urlopen(req, timeout=600) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise RuntimeError(f"Feishu upload error: {payload.get('msg')} ({payload})")
    return payload.get("data") or {}


def get_tenant_token(app_id: str, app_secret: str) -> str:
    url = f"{FEISHU_API}/auth/v3/tenant_access_token/internal"
    req = Request(
        url,
        data=json.dumps({"app_id": app_id, "app_secret": app_secret}).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise RuntimeError(f"获取 tenant_access_token 失败: {payload.get('msg')}")
    token = payload.get("tenant_access_token")
    if not token:
        raise RuntimeError("tenant_access_token 为空")
    return str(token)


def resolve_bitable_app_token(token: str, wiki_node: str) -> str:
    preset = env("FEISHU_BITABLE_APP_TOKEN")
    if preset:
        return preset

    qs = urlencode({"token": wiki_node})
    url = f"{FEISHU_API}/wiki/v2/spaces/get_node?{qs}"
    req = Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    with urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise RuntimeError(f"解析多维表格 app_token 失败: {payload.get('msg')}")
    node = (payload.get("data") or {}).get("node") or {}
    obj_type = node.get("obj_type")
    obj_token = node.get("obj_token")
    if obj_type != "bitable" or not obj_token:
        raise RuntimeError(
            f"Wiki 节点 {wiki_node} 不是多维表格 (obj_type={obj_type})"
        )
    return str(obj_token)


def list_fields(token: str, app_token: str, table_id: str) -> dict[str, str]:
    url = (
        f"{FEISHU_API}/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
        "?page_size=100"
    )
    req = Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    with urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise RuntimeError(f"列出字段失败: {payload.get('msg')}")
    items = (payload.get("data") or {}).get("items") or []
    return {str(item.get("field_name")): str(item.get("field_id")) for item in items}


def create_field(
    token: str,
    app_token: str,
    table_id: str,
    field_name: str,
    field_type: int,
    *,
    property_body: dict[str, Any] | None = None,
) -> None:
    body: dict[str, Any] = {"field_name": field_name, "type": field_type}
    if property_body:
        body["property"] = property_body
    json_request(
        "POST",
        f"{FEISHU_API}/bitable/v1/apps/{app_token}/tables/{table_id}/fields",
        token,
        body,
    )


def ensure_table_fields(token: str, app_token: str, table_id: str) -> None:
    existing = list_fields(token, app_token, table_id)
    specs: list[tuple[str, int, dict[str, Any] | None]] = [
        (FIELD_VERSION, 1, None),
        (FIELD_TAG, 1, None),
        (FIELD_PLATFORM, 3, {"options": [{"name": n} for n in PLATFORM_OPTIONS]}),
        (FIELD_FILENAME, 1, None),
        (FIELD_ATTACHMENT, 17, None),
        (FIELD_BUILD_TIME, 5, None),
        (FIELD_PIPELINE, 15, None),
    ]
    created = False
    for name, ftype, prop in specs:
        if name in existing:
            continue
        log(f"   + 创建字段: {name}")
        create_field(token, app_token, table_id, name, ftype, property_body=prop)
        created = True
    if created:
        time.sleep(1)


def upload_bitable_file(token: str, app_token: str, file_path: Path) -> str:
    file_bytes = file_path.read_bytes()
    file_name = file_path.name
    size = len(file_bytes)
    parent_type = "bitable_file"
    parent_node = app_token

    if size <= UPLOAD_ALL_LIMIT:
        data = multipart_upload(
            f"{FEISHU_API}/drive/v1/medias/upload_all",
            token,
            {
                "file_name": file_name,
                "parent_type": parent_type,
                "parent_node": parent_node,
                "size": str(size),
            },
            "file",
            file_name,
            file_bytes,
        )
        file_token = data.get("file_token")
        if not file_token:
            raise RuntimeError(f"medias/upload_all 未返回 file_token: {data}")
        return str(file_token)

    prep = json_request(
        "POST",
        f"{FEISHU_API}/drive/v1/medias/upload_prepare",
        token,
        {
            "file_name": file_name,
            "parent_type": parent_type,
            "parent_node": parent_node,
            "size": size,
        },
    )
    upload_id = prep.get("upload_id")
    if not upload_id:
        raise RuntimeError(f"medias/upload_prepare 失败: {prep}")

    block_num = (size + CHUNK_SIZE - 1) // CHUNK_SIZE
    for seq, offset in enumerate(range(0, size, CHUNK_SIZE)):
        chunk = file_bytes[offset : offset + CHUNK_SIZE]
        multipart_upload(
            f"{FEISHU_API}/drive/v1/medias/upload_part",
            token,
            {
                "upload_id": str(upload_id),
                "seq": str(seq),
                "size": str(len(chunk)),
            },
            "file",
            file_name,
            chunk,
        )

    done = json_request(
        "POST",
        f"{FEISHU_API}/drive/v1/medias/upload_finish",
        token,
        {"upload_id": str(upload_id), "block_num": block_num},
    )
    file_token = done.get("file_token")
    if not file_token:
        raise RuntimeError(f"medias/upload_finish 未返回 file_token: {done}")
    return str(file_token)


def detect_platform(file_path: Path) -> str:
    name = file_path.name.lower()
    suffix = file_path.suffix.lower()
    if suffix == ".exe" or "windows" in name:
        return "Windows"
    if suffix in {".dmg", ".zip"} and ("mac" in name or "darwin" in name):
        return "macOS"
    if suffix == ".zip" and "mac" not in name and "windows" not in name:
        return "macOS"
    if suffix == ".deb" or "linux" in name or "arm64" in name:
        return "Linux"
    return "其他"


def create_record(
    token: str,
    app_token: str,
    table_id: str,
    fields: dict[str, Any],
) -> None:
    json_request(
        "POST",
        f"{FEISHU_API}/bitable/v1/apps/{app_token}/tables/{table_id}/records",
        token,
        {"fields": fields},
    )


def collect_packages() -> list[Path]:
    files: list[Path] = []
    for base in ARTIFACT_DIRS:
        if not base.exists():
            continue
        for path in sorted(base.iterdir()):
            if path.is_file() and path.suffix.lower() in PACKAGE_SUFFIXES:
                files.append(path)
    return files


def pipeline_url() -> str:
    project_url = env("CI_PROJECT_URL")
    pipeline_id = env("CI_PIPELINE_ID")
    if project_url and pipeline_id:
        # 旧版 GitLab(11.7)流水线 URL 不含 /-/，新版才是 /-/pipelines/
        return f"{project_url}/pipelines/{pipeline_id}"
    return ""


def main() -> int:
    app_id = env("FEISHU_APP_ID")
    app_secret = env("FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        log("⏭️  未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，跳过飞书发布。")
        return 0

    table_id = env("FEISHU_BITABLE_TABLE_ID", DEFAULT_TABLE_ID)
    wiki_node = env("FEISHU_BITABLE_WIKI_NODE", DEFAULT_WIKI_NODE)
    bitable_url = env("FEISHU_BITABLE_URL", DEFAULT_BITABLE_URL)
    tag = env("CI_COMMIT_TAG", "local")
    version = tag.lstrip("v") if tag.startswith("v") else tag

    # 本地测试：可直接把安装包路径作为命令行参数传入，绕过工作区扫描。
    cli_paths = [Path(p) for p in sys.argv[1:]]
    if cli_paths:
        packages = [p for p in cli_paths if p.is_file()]
        missing = [str(p) for p in cli_paths if not p.is_file()]
        if missing:
            log(f"⚠️  以下路径不是文件，已忽略: {missing}")
    else:
        packages = collect_packages()
    if not packages:
        log("⚠️  未找到安装包（.exe/.dmg/.zip/.deb），跳过。")
        return 0

    log(f"📤 飞书多维表格发布 {tag}")
    log(f"   {bitable_url}")
    log(f"   待写入 {len(packages)} 条记录")

    tenant = get_tenant_token(app_id, app_secret)
    app_token = resolve_bitable_app_token(tenant, wiki_node)
    log(f"   app_token: {app_token[:12]}… table: {table_id}")

    ensure_table_fields(tenant, app_token, table_id)

    build_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    pipe = pipeline_url()
    created = 0

    for file_path in packages:
        platform = detect_platform(file_path)
        size_mb = file_path.stat().st_size / (1024 * 1024)
        log(f"   ↑ {file_path.name} [{platform}] ({size_mb:.1f} MB)")

        file_token = upload_bitable_file(tenant, app_token, file_path)
        fields: dict[str, Any] = {
            FIELD_VERSION: version,
            FIELD_TAG: tag,
            FIELD_PLATFORM: platform,
            FIELD_FILENAME: file_path.name,
            FIELD_ATTACHMENT: [{"file_token": file_token}],
            FIELD_BUILD_TIME: build_ms,
        }
        if pipe:
            fields[FIELD_PIPELINE] = {"text": f"Pipeline #{env('CI_PIPELINE_ID')}", "link": pipe}

        create_record(tenant, app_token, table_id, fields)
        created += 1

    log("")
    log(f"✅ 已写入 {created} 条记录到多维表格")
    log(f"   {bitable_url}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HTTPError, URLError, RuntimeError, OSError) as exc:
        detail = ""
        if isinstance(exc, HTTPError):
            try:
                detail = " | 响应: " + exc.read().decode("utf-8", "replace")
            except Exception:
                pass
        log(f"❌ 飞书发布失败: {exc}{detail}")
        raise SystemExit(1) from exc
