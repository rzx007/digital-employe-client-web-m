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
CODELOAD_BASE = "https://codeload.github.com"

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
    def _skillsmp_proxy_headers() -> dict[str, str]:
        return {
            "Accept": "application/json, application/zip, */*",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Referer": f"{SKILLSMP_BASE}/search",
            "Origin": SKILLSMP_BASE,
        }

    @staticmethod
    def search(
        query: str,
        *,
        limit: int = 20,
        page: int = 1,
        sort_by: str = "recent",
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
            raise SkillsMpError(f"SkillsMP 搜索请求失败: {exc}") from exc

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
            raise SkillsMpError(f"SkillsMP 技能详情请求失败: {exc}") from exc
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
    def _fetch_via_skillsmp_github_contents(parsed: ParsedGitHubUrl) -> dict[str, str]:
        prefix = parsed.subpath.strip("/")
        file_map: dict[str, str] = {}

        with httpx.Client(timeout=30.0, follow_redirects=True) as client:

            def fetch_entries(repo_path: str) -> list[dict[str, Any]] | dict[str, Any]:
                params = SkillsMpService.github_contents_params(parsed, repo_path)
                resp = client.get(
                    GITHUB_CONTENTS_URL,
                    params=params,
                    headers=SkillsMpService._skillsmp_proxy_headers(),
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

            first = fetch_entries(prefix)
            if isinstance(first, dict) and "__file_map__" in first:
                return first["__file_map__"]

            SkillsMpService._collect_github_entries_recursive(
                client,
                fetch_entries=fetch_entries,
                parsed=parsed,
                repo_path=prefix,
                prefix=prefix,
                file_map=file_map,
                total_bytes=0,
            )

        return SkillsMpService._normalize_skill_file_map(file_map)

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

    @staticmethod
    def _fetch_via_github_api(parsed: ParsedGitHubUrl) -> dict[str, str]:
        prefix = parsed.subpath.strip("/")

        def fetch_entries(repo_path: str) -> list[dict[str, Any]] | dict[str, Any]:
            api_path = repo_path.strip("/")
            url = f"{GITHUB_API}/repos/{parsed.owner}/{parsed.repo}/contents/{api_path}"
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
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
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            SkillsMpService._collect_github_entries_recursive(
                client,
                fetch_entries=fetch_entries,
                parsed=parsed,
                repo_path=prefix,
                prefix=prefix,
                file_map=file_map,
                total_bytes=0,
            )
        return SkillsMpService._normalize_skill_file_map(file_map)

    @staticmethod
    def _fetch_via_repo_zip(parsed: ParsedGitHubUrl) -> dict[str, str]:
        zip_url = f"{CODELOAD_BASE}/{parsed.owner}/{parsed.repo}/zip/refs/heads/{parsed.ref}"
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            resp = client.get(zip_url, headers={"User-Agent": USER_AGENT})
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
    def fetch_skill_file_map(github_url: str) -> dict[str, str]:
        parsed = SkillsMpService.parse_github_tree_url(github_url)
        errors: list[str] = []

        for fetcher in (
            SkillsMpService._fetch_via_skillsmp_github_contents,
            SkillsMpService._fetch_via_github_api,
            SkillsMpService._fetch_via_repo_zip,
        ):
            try:
                return fetcher(parsed)
            except SkillsMpError as exc:
                logger.info("%s 失败: %s", fetcher.__name__, exc)
                errors.append(str(exc))

        joined = "；".join(errors[:2])
        raise SkillsMpError(
            f"无法拉取技能文件（已尝试 SkillsMP github-contents 与 GitHub 源）。{joined}"
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

        file_map = SkillsMpService.fetch_skill_file_map(github_url)
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
