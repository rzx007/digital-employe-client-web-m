"""SkillsMP 公开目录集成：搜索 API + 从 GitHub 源安装技能。"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from zipfile import BadZipFile, ZipFile

import httpx

from src.service.local_skill_service import LocalSkillService

logger = logging.getLogger(__name__)

SKILLSMP_BASE = "https://skillsmp.com"
SEARCH_URL = f"{SKILLSMP_BASE}/api/v1/skills/search"
GITHUB_CONTENTS_URL = f"{SKILLSMP_BASE}/api/github-contents"
MCP_URL = f"{SKILLSMP_BASE}/mcp"
USER_AGENT = "digital-employee-client/1.0 (+https://skillsmp.com)"
GITHUB_API = "https://api.github.com"
RAW_GITHUB = "https://raw.githubusercontent.com"
CODELOAD_BASE = "https://codeload.github.com"

# ghproxy 加速：国内（无梯子）下直连 GitHub 走不动，公共 ghproxy 域名可达。
# 实测多数公共域名只代理 raw、不代理 api(trees)，且大量失效 → 必须多域名轮询。
# gh-proxy.com 实测能两用（api + raw）。域名常变，做成可配置。
DEFAULT_GHPROXY_HOSTS = ("https://gh-proxy.com",)
GHPROXY_TIMEOUT = 20.0
GHPROXY_FILE_CONCURRENCY = 10

# 直连 GitHub 的超时收紧：受限网络（无代理）下 GitHub 不可达时快速失败，
# 避免卡到 90s 才报错。优先走 ghproxy 加速（国内可达、快）。
GITHUB_ZIP_TIMEOUT = 20.0
GITHUB_API_TIMEOUT = 8.0
SKILLSMP_CONTENTS_TIMEOUT = 15.0


def _ghproxy_hosts() -> list[str]:
    """ghproxy 加速域名轮询列表（依次尝试）。

    优先级：env SKILL_GHPROXY_HOSTS（逗号分隔）> KV skill_ghproxy_hosts
    > 内置默认。公共域名失效率高，允许用户覆盖为自建/可用域名。
    """
    raw = os.getenv("SKILL_GHPROXY_HOSTS", "").strip()
    if not raw:
        try:
            from src.core.config import get_settings

            kv = getattr(get_settings(), "skill_ghproxy_hosts", None)
            if isinstance(kv, str):
                raw = kv.strip()
            elif isinstance(kv, (list, tuple)):
                raw = ",".join(str(h) for h in kv)
        except Exception:
            raw = ""
    hosts: list[str] = []
    for part in raw.split(","):
        host = part.strip().rstrip("/")
        if host:
            hosts.append(host)
    if not hosts:
        hosts = [h.rstrip("/") for h in DEFAULT_GHPROXY_HOSTS]
    return hosts


def _direct_github_fallback_enabled() -> bool:
    """是否允许在 SkillsMP 代理失败后回退直连 GitHub。

    受限网络（无梯子）下直连 GitHub 会超时拖慢甚至卡死，可通过 KV/env
    SKILL_DIRECT_GITHUB_FALLBACK=false 关闭回退，只走 SkillsMP 代理。
    默认开启（但已收紧超时快速失败）。
    """
    val = os.getenv("SKILL_DIRECT_GITHUB_FALLBACK", "").strip().lower()
    if val in ("0", "false", "no", "off"):
        return False
    try:
        from src.core.config import get_settings

        kv = getattr(get_settings(), "skill_direct_github_fallback", None)
        if kv is False:
            return False
    except Exception:
        pass
    return True

MAX_SKILL_FILES = 200
MAX_SKILL_BYTES = 10 * 1024 * 1024
MAX_GITHUB_ZIP_BYTES = 50 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ParsedGitHubUrl:
    owner: str
    repo: str
    ref: str
    subpath: str


class SkillsMpError(Exception):
    """SkillsMP 或 GitHub 拉取失败。"""


def humanize_http_error(exc: Exception, *, context: str = "远程技能服务") -> str:
    """将 httpx/网络异常转为用户可读的中文说明。"""
    msg = str(exc).strip()
    lower = msg.lower()
    if "server disconnected without sending a response" in lower:
        return f"{context}未响应（连接已断开），请稍后重试。"
    if "timed out" in lower or "timeout" in lower:
        return f"{context}请求超时，请稍后重试。"
    if "connection refused" in lower:
        return f"无法连接{context}，请检查网络。"
    if "connect" in lower and ("failed" in lower or "error" in lower):
        return f"无法连接{context}，请检查网络后重试。"
    if "403" in lower or "forbidden" in lower:
        return f"{context}拒绝访问（可能被限流）。"
    if "429" in lower or "rate limit" in lower:
        return f"{context}请求过于频繁，请稍后再试。"
    if "ssl" in lower or "certificate" in lower:
        return f"{context} TLS 证书校验失败。"
    return f"{context}网络异常：{msg}"


class SkillsMpService:
    @staticmethod
    def _headers() -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        api_key = os.getenv("SKILLSMP_API_KEY", "").strip()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    @staticmethod
    def parse_github_tree_url(url: str) -> ParsedGitHubUrl:
        raw = (url or "").strip()
        if not raw:
            raise SkillsMpError("GitHub 地址为空。")

        parsed = urlparse(raw)
        if parsed.netloc not in ("github.com", "www.github.com"):
            raise SkillsMpError(f"不支持的 GitHub 地址: {url}")

        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) < 2:
            raise SkillsMpError(f"无法解析 GitHub 地址: {url}")

        owner, repo = parts[0], parts[1]
        ref = "main"
        subpath = ""

        if len(parts) >= 4 and parts[2] in ("tree", "blob"):
            ref = unquote(parts[3])
            subpath = "/".join(unquote(p) for p in parts[4:])
            if parts[2] == "blob" and subpath:
                leaf = subpath.rsplit("/", 1)[-1]
                if leaf.lower() in ("skill.md", "skills.md"):
                    subpath = subpath.rsplit("/", 1)[0]

        return ParsedGitHubUrl(owner=owner, repo=repo, ref=ref, subpath=subpath)

    @staticmethod
    def github_contents_params(parsed: ParsedGitHubUrl, path: str = "") -> dict[str, str]:
        skill_path = (path or parsed.subpath).strip("/")
        params = {
            "owner": parsed.owner,
            "repo": parsed.repo,
            "branch": parsed.ref,
        }
        if skill_path:
            params["path"] = skill_path
        return params

    @staticmethod
    def github_contents_url(parsed: ParsedGitHubUrl, path: str = "") -> str:
        from urllib.parse import urlencode

        return f"{GITHUB_CONTENTS_URL}?{urlencode(SkillsMpService.github_contents_params(parsed, path))}"

    @staticmethod
    def _skillsmp_proxy_headers(skill_slug: str | None = None) -> dict[str, str]:
        slug = (skill_slug or "").strip()
        referer = (
            f"{SKILLSMP_BASE}/skills/{slug}"
            if slug
            else f"{SKILLSMP_BASE}/search"
        )
        return {
            # zip 优先：让代理一次性返回整个技能目录的 ZIP，避免逐文件递归
            # （代理对同一 path 有限流，第二次请求即 403，递归会自残）。
            "Accept": "application/zip, application/json, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Referer": referer,
            "Origin": SKILLSMP_BASE,
        }

    @staticmethod
    def search(
        query: str,
        *,
        limit: int = 20,
        page: int = 1,
        sort_by: str = "stars",
    ) -> dict[str, Any]:
        q = query.strip()
        if not q:
            raise SkillsMpError("搜索关键词不能为空。")
        if not re.search(r"[A-Za-z0-9\u4e00-\u9fff]", q):
            raise SkillsMpError("搜索关键词须包含至少一个字母或数字。")

        params = {
            "q": q[:200],
            "limit": min(max(limit, 1), 50),
            "page": min(max(page, 1), 50),
            "sortBy": sort_by if sort_by in ("stars", "recent") else "recent",
        }
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                resp = client.get(SEARCH_URL, params=params, headers=SkillsMpService._headers())
        except httpx.HTTPError as exc:
            raise SkillsMpError(
                humanize_http_error(exc, context="SkillsMP 搜索")
            ) from exc

        try:
            payload = resp.json()
        except json.JSONDecodeError as exc:
            raise SkillsMpError("SkillsMP 返回非 JSON 响应。") from exc

        if resp.status_code == 429 or (
            isinstance(payload, dict)
            and payload.get("success") is False
            and payload.get("error", {}).get("code")
            in ("DAILY_QUOTA_EXCEEDED", "RATE_LIMITED")
        ):
            raise SkillsMpError(
                "SkillsMP 搜索频率已达上限（匿名 50 次/天、10 次/分钟）。"
                "请稍后再试，或在浏览器打开 https://skillsmp.com/search 浏览。"
            )

        if not isinstance(payload, dict) or payload.get("success") is not True:
            err = payload.get("error", {}) if isinstance(payload, dict) else {}
            message = err.get("message") if isinstance(err, dict) else None
            raise SkillsMpError(message or f"SkillsMP 搜索失败 (HTTP {resp.status_code})。")

        data = payload.get("data")
        if not isinstance(data, dict):
            raise SkillsMpError("SkillsMP 搜索响应格式异常。")
        return data

    @staticmethod
    def get_skill(slug: str) -> dict[str, Any]:
        skill_slug = slug.strip()
        if not skill_slug:
            raise SkillsMpError("skill_slug 不能为空。")

        init_body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "digital-employee-client", "version": "1.0"},
            },
        }
        call_body = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "get_skill", "arguments": {"id": skill_slug}},
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": USER_AGENT,
        }

        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                init_resp = client.post(MCP_URL, json=init_body, headers=headers)
                init_resp.raise_for_status()
                session_id = init_resp.headers.get("mcp-session-id", "")
                call_headers = dict(headers)
                if session_id:
                    call_headers["Mcp-Session-Id"] = session_id
                call_resp = client.post(MCP_URL, json=call_body, headers=call_headers)
                call_resp.raise_for_status()
                envelope = call_resp.json()
        except httpx.HTTPError as exc:
            raise SkillsMpError(
                humanize_http_error(exc, context="SkillsMP 技能详情")
            ) from exc
        except json.JSONDecodeError as exc:
            raise SkillsMpError("SkillsMP MCP 返回非 JSON 响应。") from exc

        content = envelope.get("result", {}).get("content")
        if not isinstance(content, list) or not content:
            raise SkillsMpError(f"未找到技能: {skill_slug}")

        text = content[0].get("text") if isinstance(content[0], dict) else None
        if not isinstance(text, str):
            raise SkillsMpError(f"未找到技能: {skill_slug}")

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SkillsMpError("SkillsMP 技能详情格式异常。") from exc

        skill = parsed.get("skill") if isinstance(parsed, dict) else None
        if not isinstance(skill, dict):
            raise SkillsMpError(f"未找到技能: {skill_slug}")
        return skill

    @staticmethod
    def _decode_github_entry_content(entry: dict[str, Any]) -> str | None:
        encoded = entry.get("content")
        if isinstance(encoded, str) and encoded:
            encoding = str(entry.get("encoding") or "base64")
            if encoding == "base64":
                try:
                    return base64.b64decode(encoded).decode("utf-8")
                except (UnicodeDecodeError, ValueError):
                    return None
            return encoded
        text_content = entry.get("text")
        if isinstance(text_content, str):
            return text_content
        return None

    @staticmethod
    def _file_map_from_zip_bytes(file_bytes: bytes) -> dict[str, str]:
        temp_dir = LocalSkillService._extract_zip_to_temp(file_bytes)
        try:
            source_root = LocalSkillService._detect_skill_source_root(temp_dir)
            file_map: dict[str, str] = {}
            total_bytes = 0
            for path in source_root.rglob("*"):
                if not path.is_file() or path.name.startswith("."):
                    continue
                relative = path.relative_to(source_root).as_posix()
                if len(file_map) >= MAX_SKILL_FILES:
                    raise SkillsMpError(
                        f"技能文件过多（>{MAX_SKILL_FILES}），请手动下载 ZIP 导入。"
                    )
                try:
                    content = path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                total_bytes += len(content.encode("utf-8"))
                if total_bytes > MAX_SKILL_BYTES:
                    raise SkillsMpError("技能体积过大，请手动下载 ZIP 导入。")
                file_map[relative] = content
            return SkillsMpService._normalize_skill_file_map(file_map)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @staticmethod
    def _collect_github_entries_recursive(
        client: httpx.Client,
        *,
        fetch_entries,
        parsed: ParsedGitHubUrl,
        repo_path: str,
        prefix: str,
        file_map: dict[str, str],
        total_bytes: int,
    ) -> int:
        if len(file_map) >= MAX_SKILL_FILES:
            raise SkillsMpError(
                f"技能文件过多（>{MAX_SKILL_FILES}），请改在浏览器下载 ZIP 后手动导入。"
            )

        entries = fetch_entries(repo_path.strip("/"))
        if isinstance(entries, dict):
            entries = [entries]

        if not isinstance(entries, list):
            raise SkillsMpError("技能目录结构异常。")

        for entry in entries:
            if not isinstance(entry, dict):
                continue
            entry_type = entry.get("type")
            entry_path = str(entry.get("path") or "")
            relative = entry_path
            if prefix and entry_path.startswith(f"{prefix}/"):
                relative = entry_path[len(prefix) + 1 :]
            elif prefix and entry_path == prefix:
                relative = ""
            elif prefix:
                continue

            if entry_type == "dir":
                if not entry_path:
                    continue
                total_bytes = SkillsMpService._collect_github_entries_recursive(
                    client,
                    fetch_entries=fetch_entries,
                    parsed=parsed,
                    repo_path=entry_path,
                    prefix=prefix,
                    file_map=file_map,
                    total_bytes=total_bytes,
                )
                continue

            if entry_type != "file" or not relative:
                continue

            content = SkillsMpService._decode_github_entry_content(entry)
            if content is None:
                download_url = entry.get("download_url")
                if isinstance(download_url, str) and download_url:
                    file_resp = client.get(
                        download_url, headers={"User-Agent": USER_AGENT}
                    )
                    if file_resp.status_code != 200:
                        logger.warning("跳过无法下载的文件: %s", relative)
                        continue
                    try:
                        content = file_resp.text
                    except UnicodeDecodeError:
                        logger.warning("跳过二进制文件: %s", relative)
                        continue
                else:
                    continue

            size = len(content.encode("utf-8"))
            total_bytes += size
            if total_bytes > MAX_SKILL_BYTES:
                raise SkillsMpError(
                    f"技能体积超过 {MAX_SKILL_BYTES // (1024 * 1024)}MB，"
                    "请在浏览器下载 ZIP 后手动导入。"
                )
            file_map[relative.replace("\\", "/")] = content

        return total_bytes

    @staticmethod
    def _parse_skillsmp_github_contents_payload(
        payload: Any,
    ) -> list[dict[str, Any]] | dict[str, Any]:
        if isinstance(payload, list):
            return payload
        if not isinstance(payload, dict):
            raise SkillsMpError("SkillsMP github-contents 响应格式异常。")

        for key in ("files", "contents", "data", "tree"):
            nested = payload.get(key)
            if isinstance(nested, list):
                if nested and isinstance(nested[0], dict) and "content" in nested[0]:
                    file_map: dict[str, str] = {}
                    total_bytes = 0
                    for item in nested:
                        if not isinstance(item, dict):
                            continue
                        path = str(item.get("path") or item.get("name") or "")
                        content = item.get("content")
                        if not path or not isinstance(content, str):
                            continue
                        size = len(content.encode("utf-8"))
                        total_bytes += size
                        if total_bytes > MAX_SKILL_BYTES:
                            raise SkillsMpError("技能体积过大，请手动下载 ZIP 导入。")
                        file_map[path.replace("\\", "/")] = content
                    return {"__file_map__": SkillsMpService._normalize_skill_file_map(file_map)}
                return nested
            if isinstance(nested, dict) and nested.get("type") in ("file", "dir"):
                return nested

        if payload.get("type") in ("file", "dir"):
            return payload
        raise SkillsMpError("SkillsMP github-contents 响应格式异常。")

    @staticmethod
    def _fetch_via_skillsmp_github_contents(
        parsed: ParsedGitHubUrl,
        *,
        skill_slug: str | None = None,
    ) -> dict[str, str]:
        prefix = parsed.subpath.strip("/")
        proxy_headers = SkillsMpService._skillsmp_proxy_headers(skill_slug)

        with httpx.Client(
            timeout=SKILLSMP_CONTENTS_TIMEOUT, follow_redirects=True
        ) as client:

            def fetch_entries(repo_path: str) -> list[dict[str, Any]] | dict[str, Any]:
                params = SkillsMpService.github_contents_params(parsed, repo_path)
                resp = client.get(
                    GITHUB_CONTENTS_URL,
                    params=params,
                    headers=proxy_headers,
                )
                if resp.status_code == 403:
                    raise SkillsMpError(
                        "SkillsMP github-contents 不可用（HTTP 403），将改用 GitHub 源。"
                    )
                if resp.status_code != 200:
                    raise SkillsMpError(
                        f"SkillsMP github-contents 请求失败 (HTTP {resp.status_code})。"
                    )

                content_type = (resp.headers.get("content-type") or "").lower()
                if "zip" in content_type or resp.content[:2] == b"PK":
                    return {
                        "__file_map__": SkillsMpService._file_map_from_zip_bytes(
                            resp.content
                        )
                    }

                try:
                    payload = resp.json()
                except json.JSONDecodeError as exc:
                    raise SkillsMpError(
                        "SkillsMP github-contents 返回非 JSON。"
                    ) from exc

                return SkillsMpService._parse_skillsmp_github_contents_payload(payload)

            # 只发一次请求。代理对同一 path 有限流（第二次请求即 403），
            # 所以这一次必须拿到整个目录的 ZIP（或代理一次性内联了全部 content）。
            first = fetch_entries(prefix)
            if isinstance(first, dict) and "__file_map__" in first:
                return first["__file_map__"]

            # 没拿到 ZIP，只拿到逐文件清单。此时绝不递归逐文件下载——那会
            # 立刻触发代理限流（403）并拖垮整条链。直接判定此代理不支持
            # ZIP，干净地退出，让上层回退到 GitHub 直连源。
            raise SkillsMpError(
                "SkillsMP 代理未返回 ZIP（仅逐文件清单），跳过逐文件下载以避免限流，改用 GitHub 源。"
            )

    @staticmethod
    def _github_headers() -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
        }
        token = os.getenv("GITHUB_TOKEN", "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    # ---- ghproxy 加速路径（首选，国内可达）---------------------------------

    @staticmethod
    def _ghproxy_get(
        client: httpx.Client,
        target_url: str,
        hosts: list[str],
        *,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response | None:
        """通过 ghproxy 域名轮询请求 target_url，返回首个 200 响应。

        每个 host 失败（非 200 或网络异常）转下一个；全部失败返回 None。
        """
        for host in hosts:
            url = f"{host}/{target_url}"
            try:
                resp = client.get(url, headers=headers, follow_redirects=True)
            except httpx.HTTPError as exc:
                logger.info("ghproxy host 失败 %s: %s", host, exc)
                continue
            if resp.status_code == 200:
                return resp
            logger.info("ghproxy host %s 返回 HTTP %s", host, resp.status_code)
        return None

    @staticmethod
    def _fetch_via_ghproxy(parsed: ParsedGitHubUrl) -> dict[str, str]:
        """首选下载路径：ghproxy 加速 + GitHub trees 拿全树 + 并发取 raw。

        国内（无梯子）下直连 GitHub 走不动，故全程经 ghproxy 代理：
        1. 一次请求拿整棵文件树（trees API），过滤出技能子目录下的文件；
        2. 10 并发取每个文件的 raw 内容。
        """
        hosts = _ghproxy_hosts()
        prefix = parsed.subpath.strip("/")
        ref = parsed.ref
        tree_url = (
            f"{GITHUB_API}/repos/{parsed.owner}/{parsed.repo}"
            f"/git/trees/{ref}?recursive=1"
        )

        with httpx.Client(timeout=GHPROXY_TIMEOUT) as client:
            tree_resp = SkillsMpService._ghproxy_get(
                client, tree_url, hosts, headers=SkillsMpService._github_headers()
            )
            if tree_resp is None:
                raise SkillsMpError(
                    "ghproxy 加速不可用（trees 请求全部失败），将改用其他源。"
                )
            try:
                tree_payload = tree_resp.json()
            except json.JSONDecodeError as exc:
                raise SkillsMpError("ghproxy trees 返回非 JSON。") from exc

            tree = tree_payload.get("tree") if isinstance(tree_payload, dict) else None
            if not isinstance(tree, list):
                raise SkillsMpError("ghproxy trees 响应格式异常。")

            # 过滤出技能子目录下的文件（blob），算出相对路径
            rel_paths: list[str] = []
            for item in tree:
                if not isinstance(item, dict) or item.get("type") != "blob":
                    continue
                path = str(item.get("path") or "")
                if prefix:
                    if path == prefix or not path.startswith(f"{prefix}/"):
                        continue
                    relative = path[len(prefix) + 1 :]
                else:
                    relative = path
                if not relative or relative.split("/")[-1].startswith("."):
                    continue
                rel_paths.append(relative)
                if len(rel_paths) > MAX_SKILL_FILES:
                    raise SkillsMpError(
                        f"技能文件过多（>{MAX_SKILL_FILES}），请改在浏览器下载 ZIP 后手动导入。"
                    )

            if not rel_paths:
                raise SkillsMpError("ghproxy trees 中未找到技能目录文件。")

            def fetch_one(relative: str) -> tuple[str, str | None]:
                repo_path = f"{prefix}/{relative}" if prefix else relative
                raw_url = (
                    f"{RAW_GITHUB}/{parsed.owner}/{parsed.repo}/{ref}/{repo_path}"
                )
                resp = SkillsMpService._ghproxy_get(
                    client, raw_url, hosts, headers={"User-Agent": USER_AGENT}
                )
                if resp is None:
                    logger.warning("ghproxy 跳过无法下载的文件: %s", relative)
                    return relative, None
                try:
                    return relative, resp.text
                except UnicodeDecodeError:
                    logger.warning("ghproxy 跳过二进制文件: %s", relative)
                    return relative, None

            file_map: dict[str, str] = {}
            total_bytes = 0
            with ThreadPoolExecutor(max_workers=GHPROXY_FILE_CONCURRENCY) as pool:
                for relative, content in pool.map(fetch_one, rel_paths):
                    if content is None:
                        continue
                    total_bytes += len(content.encode("utf-8"))
                    if total_bytes > MAX_SKILL_BYTES:
                        raise SkillsMpError(
                            f"技能体积超过 {MAX_SKILL_BYTES // (1024 * 1024)}MB，"
                            "请在浏览器下载 ZIP 后手动导入。"
                        )
                    file_map[relative.replace("\\", "/")] = content

        return SkillsMpService._normalize_skill_file_map(file_map)

    @staticmethod
    def _fetch_via_github_api(parsed: ParsedGitHubUrl) -> dict[str, str]:
        prefix = parsed.subpath.strip("/")

        def fetch_entries(repo_path: str) -> list[dict[str, Any]] | dict[str, Any]:
            api_path = repo_path.strip("/")
            url = f"{GITHUB_API}/repos/{parsed.owner}/{parsed.repo}/contents/{api_path}"
            with httpx.Client(
                timeout=GITHUB_API_TIMEOUT, follow_redirects=True
            ) as client:
                resp = client.get(
                    url,
                    params={"ref": parsed.ref},
                    headers=SkillsMpService._github_headers(),
                )
            if resp.status_code == 404:
                raise SkillsMpError(
                    f"GitHub 上未找到技能目录: {parsed.owner}/{parsed.repo}/{api_path}"
                )
            if resp.status_code != 200:
                raise SkillsMpError(
                    f"GitHub API 请求失败 (HTTP {resp.status_code})。"
                )
            payload = resp.json()
            return SkillsMpService._parse_skillsmp_github_contents_payload(payload)

        file_map: dict[str, str] = {}
        try:
            with httpx.Client(
                timeout=GITHUB_API_TIMEOUT, follow_redirects=True
            ) as client:
                SkillsMpService._collect_github_entries_recursive(
                    client,
                    fetch_entries=fetch_entries,
                    parsed=parsed,
                    repo_path=prefix,
                    prefix=prefix,
                    file_map=file_map,
                    total_bytes=0,
                )
        except httpx.HTTPError as exc:
            raise SkillsMpError(
                humanize_http_error(exc, context="GitHub API")
            ) from exc
        return SkillsMpService._normalize_skill_file_map(file_map)

    @staticmethod
    def _fetch_via_repo_zip(parsed: ParsedGitHubUrl) -> dict[str, str]:
        zip_url = f"{CODELOAD_BASE}/{parsed.owner}/{parsed.repo}/zip/refs/heads/{parsed.ref}"
        try:
            with httpx.Client(
                timeout=GITHUB_ZIP_TIMEOUT, follow_redirects=True
            ) as client:
                resp = client.get(zip_url, headers={"User-Agent": USER_AGENT})
        except httpx.HTTPError as exc:
            raise SkillsMpError(
                humanize_http_error(exc, context="GitHub ZIP 下载")
            ) from exc
        if resp.status_code != 200:
            raise SkillsMpError(
                f"GitHub 仓库 ZIP 下载失败 (HTTP {resp.status_code})。"
            )
        if len(resp.content) > MAX_GITHUB_ZIP_BYTES:
            raise SkillsMpError("GitHub 仓库 ZIP 过大，请手动下载后导入。")

        temp_dir = Path(tempfile.mkdtemp(prefix="skillsmp-github-"))
        try:
            with ZipFile(io.BytesIO(resp.content), "r") as zf:
                zf.extractall(temp_dir)
            roots = [p for p in temp_dir.iterdir() if p.is_dir()]
            if not roots:
                raise SkillsMpError("GitHub ZIP 解压后为空。")
            repo_root = roots[0]
            skill_root = repo_root / parsed.subpath if parsed.subpath else repo_root
            if not skill_root.is_dir():
                raise SkillsMpError(f"ZIP 中未找到技能目录: {parsed.subpath}")

            file_map: dict[str, str] = {}
            total_bytes = 0
            for path in skill_root.rglob("*"):
                if not path.is_file():
                    continue
                if path.name.startswith("."):
                    continue
                relative = path.relative_to(skill_root).as_posix()
                if len(file_map) >= MAX_SKILL_FILES:
                    raise SkillsMpError(
                        f"技能文件过多（>{MAX_SKILL_FILES}），请手动下载 ZIP 导入。"
                    )
                try:
                    content = path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                total_bytes += len(content.encode("utf-8"))
                if total_bytes > MAX_SKILL_BYTES:
                    raise SkillsMpError("技能体积过大，请手动下载 ZIP 导入。")
                file_map[relative] = content
            return SkillsMpService._normalize_skill_file_map(file_map)
        except BadZipFile as exc:
            raise SkillsMpError("GitHub ZIP 文件无效。") from exc
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @staticmethod
    def _normalize_skill_file_map(file_map: dict[str, str]) -> dict[str, str]:
        if not file_map:
            raise SkillsMpError("技能目录为空或未包含可读文本文件。")

        normalized = {k.replace("\\", "/"): v for k, v in file_map.items()}
        if "SKILL.md" not in normalized:
            for key, value in list(normalized.items()):
                if key.lower() == "skill.md":
                    normalized["SKILL.md"] = value
                    if key != "SKILL.md":
                        del normalized[key]
                    break

        if "SKILL.md" not in normalized:
            raise SkillsMpError("未找到 SKILL.md，不是标准技能包。")
        return normalized

    @staticmethod
    def fetch_skill_file_map(
        github_url: str,
        *,
        skill_slug: str | None = None,
    ) -> dict[str, str]:
        parsed = SkillsMpService.parse_github_tree_url(github_url)
        errors: list[str] = []

        # 首选 ghproxy 加速（国内可达、快）：trees 拿全树 + 并发取 raw。
        try:
            return SkillsMpService._fetch_via_ghproxy(parsed)
        except SkillsMpError as exc:
            logger.info("ghproxy 加速失败: %s", exc)
            errors.append(str(exc))
        except httpx.HTTPError as exc:
            logger.info("ghproxy 加速网络失败: %s", exc)
            errors.append(humanize_http_error(exc, context="ghproxy 加速"))

        # 次选 SkillsMP 代理（国内可达，但有限流；仅一次拿到 zip/内联时有用）。
        try:
            return SkillsMpService._fetch_via_skillsmp_github_contents(
                parsed, skill_slug=skill_slug
            )
        except SkillsMpError as exc:
            logger.info("SkillsMP 代理失败: %s", exc)
            errors.append(str(exc))
        except httpx.HTTPError as exc:
            logger.info("SkillsMP 代理网络失败: %s", exc)
            errors.append(humanize_http_error(exc, context="SkillsMP 代理"))

        # 回退直连 GitHub（受限网络下可关闭，避免长时间卡死）
        if not _direct_github_fallback_enabled():
            joined = "；".join(errors[:3])
            raise SkillsMpError(
                "SkillsMP 代理不可用，且已禁用 GitHub 直连回退"
                "（SKILL_DIRECT_GITHUB_FALLBACK=false）。" + joined
            )

        for fetcher in (
            SkillsMpService._fetch_via_github_api,
            SkillsMpService._fetch_via_repo_zip,
        ):
            try:
                return fetcher(parsed)
            except SkillsMpError as exc:
                logger.info("%s 失败: %s", fetcher.__name__, exc)
                errors.append(str(exc))
            except httpx.HTTPError as exc:
                logger.info("%s 网络失败: %s", fetcher.__name__, exc)
                errors.append(humanize_http_error(exc, context="GitHub 拉取"))

        joined = "；".join(errors[:3])
        raise SkillsMpError(
            f"无法拉取技能文件（已尝试 ghproxy 加速 / SkillsMP 代理 / GitHub API / ZIP）。{joined}"
        )

    @staticmethod
    def install_from_slug(
        slug: str,
        workspace_id: int,
        *,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        skill = SkillsMpService.get_skill(slug)
        github_url = str(skill.get("githubUrl") or "").strip()
        if not github_url:
            raise SkillsMpError("该技能缺少 GitHub 源地址，无法自动安装。")

        file_map = SkillsMpService.fetch_skill_file_map(github_url, skill_slug=slug)
        skill_name = str(skill.get("name") or "").strip()
        if not skill_name:
            skill_name = LocalSkillService._normalize_skill_name(slug)
        normalized = LocalSkillService._normalize_skill_name(skill_name)
        description = str(skill.get("description") or "").strip() or None

        return LocalSkillService.install_skill_from_file_map(
            skill_name=normalized,
            file_map=file_map,
            workspace_id=workspace_id,
            overwrite=overwrite,
            description=description,
            source_file_name=f"skillsmp:{slug}",
        )
