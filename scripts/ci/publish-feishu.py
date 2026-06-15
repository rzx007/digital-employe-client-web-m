#!/usr/bin/env python3
"""
GitLab CI：将 release 构建产物上传飞书云盘，并挂载到指定知识库节点下。

配置（GitLab CI/CD Variables，Masked）：
  FEISHU_APP_ID          飞书自建应用 App ID
  FEISHU_APP_SECRET      飞书自建应用 App Secret
  FEISHU_WIKI_NODE_TOKEN 目标知识库页面 node token（URL 中 /wiki/ 后一段）
  FEISHU_DRIVE_FOLDER_TOKEN（可选）中转云盘文件夹 token；未设则用应用云空间根目录

默认知识库页：
  https://scnj8otdvysf.feishu.cn/wiki/CGcIwUsSjif5yzktPFVcVBWlnNe

应用权限（至少）：
  drive:drive / drive:file:upload
  wiki:wiki
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

FEISHU_API = "https://open.feishu.cn/open-apis"
DEFAULT_WIKI_NODE = "CGcIwUsSjif5yzktPFVcVBWlnNe"
CHUNK_SIZE = 4 * 1024 * 1024
UPLOAD_ALL_LIMIT = 20 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[2]

ARTIFACT_GLOBS = [
    ROOT / "apps/web/release",
    ROOT / "release",
]
ARTIFACT_SUFFIXES = {".exe", ".dmg", ".zip", ".deb", ".yml", ".blockmap"}


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


def get_wiki_node(token: str, node_token: str) -> dict[str, Any]:
    qs = urlencode({"token": node_token})
    url = f"{FEISHU_API}/wiki/v2/spaces/get_node?{qs}"
    req = Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    with urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise RuntimeError(f"获取知识库节点失败: {payload.get('msg')}")
    node = (payload.get("data") or {}).get("node") or {}
    if not node.get("space_id"):
        raise RuntimeError(f"知识库节点无效: {node_token}")
    return node


def get_drive_root_folder_token(token: str) -> str:
    url = f"{FEISHU_API}/drive/explorer/v2/root_folder/meta"
    data = json_request("GET", url, token)
    folder_token = data.get("token")
    if not folder_token:
        raise RuntimeError("无法获取云空间根目录 token")
    return str(folder_token)


def upload_to_drive(
    token: str,
    folder_token: str,
    file_path: Path,
) -> str:
    file_bytes = file_path.read_bytes()
    file_name = file_path.name
    size = len(file_bytes)
    parent_type = "explorer"
    parent_node = folder_token

    if size <= UPLOAD_ALL_LIMIT:
        data = multipart_upload(
            f"{FEISHU_API}/drive/v1/files/upload_all",
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
            raise RuntimeError(f"upload_all 未返回 file_token: {data}")
        return str(file_token)

    prep = json_request(
        "POST",
        f"{FEISHU_API}/drive/v1/files/upload_prepare",
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
        raise RuntimeError(f"upload_prepare 失败: {prep}")

    block_num = (size + CHUNK_SIZE - 1) // CHUNK_SIZE
    for seq, offset in enumerate(range(0, size, CHUNK_SIZE)):
        chunk = file_bytes[offset : offset + CHUNK_SIZE]
        multipart_upload(
            f"{FEISHU_API}/drive/v1/files/upload_part",
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
        f"{FEISHU_API}/drive/v1/files/upload_finish",
        token,
        {"upload_id": str(upload_id), "block_num": block_num},
    )
    file_token = done.get("file_token")
    if not file_token:
        raise RuntimeError(f"upload_finish 未返回 file_token: {done}")
    return str(file_token)


def move_file_to_wiki(
    token: str,
    space_id: str,
    parent_wiki_token: str,
    file_token: str,
) -> None:
    json_request(
        "POST",
        f"{FEISHU_API}/wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki",
        token,
        {
            "parent_wiki_token": parent_wiki_token,
            "obj_type": "file",
            "obj_token": file_token,
            "apply": True,
        },
    )


def collect_artifacts() -> list[Path]:
    files: list[Path] = []
    for base in ARTIFACT_GLOBS:
        if not base.exists():
            continue
        for path in sorted(base.iterdir()):
            if path.is_file() and path.suffix.lower() in ARTIFACT_SUFFIXES:
                files.append(path)
    return files


def main() -> int:
    app_id = env("FEISHU_APP_ID")
    app_secret = env("FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        log("⏭️  未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，跳过飞书发布。")
        return 0

    wiki_node_token = env("FEISHU_WIKI_NODE_TOKEN", DEFAULT_WIKI_NODE)
    tag = env("CI_COMMIT_TAG", "local")
    wiki_url = (
        env("FEISHU_WIKI_URL")
        or f"https://scnj8otdvysf.feishu.cn/wiki/{wiki_node_token}"
    )

    artifacts = collect_artifacts()
    if not artifacts:
        log("⚠️  未找到可发布的构建产物，跳过。")
        return 0

    log(f"📤 飞书发布 {tag} → {wiki_url}")
    log(f"   待上传 {len(artifacts)} 个文件")

    tenant = get_tenant_token(app_id, app_secret)
    wiki_node = get_wiki_node(tenant, wiki_node_token)
    space_id = str(wiki_node["space_id"])
    parent_title = wiki_node.get("title") or wiki_node_token
    log(f"   知识库: {parent_title} (space_id={space_id})")

    folder_token = env("FEISHU_DRIVE_FOLDER_TOKEN")
    if not folder_token:
        folder_token = get_drive_root_folder_token(tenant)
        log(f"   使用云空间根目录中转: {folder_token[:8]}…")

    uploaded: list[str] = []
    for file_path in artifacts:
        log(f"   ↑ {file_path.name} ({file_path.stat().st_size / (1024 * 1024):.1f} MB)")
        file_token = upload_to_drive(tenant, folder_token, file_path)
        move_file_to_wiki(
            tenant,
            space_id,
            wiki_node_token,
            file_token,
        )
        uploaded.append(file_path.name)

    log("")
    log(f"✅ 已发布 {len(uploaded)} 个文件到知识库「{parent_title}」")
    log(f"   {wiki_url}")
    for name in uploaded:
        log(f"   - {name}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HTTPError, URLError, RuntimeError, OSError) as exc:
        log(f"❌ 飞书发布失败: {exc}")
        raise SystemExit(1) from exc
