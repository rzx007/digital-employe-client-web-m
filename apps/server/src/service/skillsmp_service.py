"""ClawHub 镜像技能市场集成：搜索 / 详情（内联 SKILL.md）/ ZIP 直装。

历史：本模块原对接 skillsmp.com（详情只给 githubUrl，预览与安装都要绕 GitHub /
ghproxy，国内慢且常卡）。现整体替换为 ClawHub 镜像（cn.clawhub-mirror.com）：

- 搜索   GET {base}/api/v1/search?q=...          → {"results": [...]}（每条已内联 skillMd）
- 详情   GET {base}/api/v1/skills/{slug}           → metaContent.skillMd 内联，秒开
- 安装   GET {base}/api/v1/download?slug=...&version=... → application/zip 直接下发

提速点：预览靠内联 skillMd、安装靠整包 ZIP，**全程不绕 GitHub**。

为最小化上层改动，保留 `SkillsMpService` 类名与 search/get_skill/install_from_slug/
fetch_skill_file_map 的方法签名（旧名沿用，语义已切到 ClawHub）。
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx

from src.service.local_skill_service import LocalSkillService

logger = logging.getLogger(__name__)

# ClawHub 镜像默认地址。国内可达、快。域名可能变，做成可配置：
# 优先级 env SKILL_MARKET_BASE > KV skill_market_base > 内置默认。
DEFAULT_MARKET_BASE = "https://cn.clawhub-mirror.com"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

SEARCH_TIMEOUT = 15.0
DETAIL_TIMEOUT = 15.0
DOWNLOAD_TIMEOUT = 30.0

MAX_SKILL_FILES = 200
MAX_SKILL_BYTES = 10 * 1024 * 1024
MAX_DOWNLOAD_ZIP_BYTES = 50 * 1024 * 1024


def market_base() -> str:
    """ClawHub 镜像基址。env SKILL_MARKET_BASE > KV skill_market_base > 默认。"""
    raw = os.getenv("SKILL_MARKET_BASE", "").strip()
    if not raw:
        try:
            from src.core.config import get_settings

            kv = getattr(get_settings(), "skill_market_base", None)
            if isinstance(kv, str):
                raw = kv.strip()
        except Exception:
            raw = ""
    base = (raw or DEFAULT_MARKET_BASE).strip().rstrip("/")
    return base or DEFAULT_MARKET_BASE


def market_web_url() -> str:
    """浏览器可打开的技能市场页面（用于提示文案）。"""
    return f"{market_base()}/skills"


# 旧代码引用过 SKILLSMP_BASE / SEARCH_URL 等模块级常量，这里以函数取代；
# 若有外部仍 import 这些名字会立刻报错（提示已迁移），属预期。


@dataclass(frozen=True, slots=True)
class MarketSkill:
    """搜索/详情归一化后的技能条目。"""

    slug: str
    name: str
    summary: str
    version: str | None
    skill_md: str | None
    files: list[str]
    license: str | None


class SkillsMpError(Exception):
    """ClawHub 镜像或下载失败。"""


def humanize_http_error(exc: Exception, *, context: str = "技能市场") -> str:
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
        return {"Accept": "application/json", "User-Agent": USER_AGENT}

    # ---- 归一化 ----------------------------------------------------------

    @staticmethod
    def _meta_content(item: dict[str, Any]) -> dict[str, Any]:
        mc = item.get("metaContent")
        return mc if isinstance(mc, dict) else {}

    @staticmethod
    def _to_market_skill(item: dict[str, Any]) -> MarketSkill | None:
        if not isinstance(item, dict):
            return None
        slug = str(item.get("slug") or "").strip()
        if not slug:
            return None
        mc = SkillsMpService._meta_content(item)
        name = (
            str(item.get("displayName") or mc.get("displayName") or slug).strip()
            or slug
        )
        summary = str(
            item.get("summary") or mc.get("summary") or mc.get("DisplayDescription") or ""
        ).strip()
        version = item.get("version") or (mc.get("latest") or {}).get("version")
        skill_md = mc.get("skillMd")
        files_raw = mc.get("Files")
        files = [str(f) for f in files_raw] if isinstance(files_raw, list) else []
        license_raw = mc.get("License")
        return MarketSkill(
            slug=slug,
            name=name,
            summary=summary,
            version=str(version) if version else None,
            skill_md=skill_md if isinstance(skill_md, str) else None,
            files=files,
            license=str(license_raw) if license_raw else None,
        )

    # ---- 搜索 ------------------------------------------------------------

    @staticmethod
    def search(
        query: str,
        *,
        limit: int = 20,
        page: int = 1,
        sort_by: str = "stars",  # 兼容旧签名；ClawHub 无此参数
    ) -> dict[str, Any]:
        """搜索 ClawHub 镜像技能目录。

        返回 {"skills": [MarketSkill-dict...], "pagination": {...}}，
        保持与旧 skillsmp 上层调用相同的形状（skills 列表）。
        """
        q = query.strip()
        if not q:
            raise SkillsMpError("搜索关键词不能为空。")

        params = {"q": q[:200], "limit": min(max(limit, 1), 50)}
        url = f"{market_base()}/api/v1/search"
        try:
            with httpx.Client(timeout=SEARCH_TIMEOUT, follow_redirects=True) as client:
                resp = client.get(url, params=params, headers=SkillsMpService._headers())
        except httpx.HTTPError as exc:
            raise SkillsMpError(
                humanize_http_error(exc, context="技能市场搜索")
            ) from exc

        if resp.status_code != 200:
            raise SkillsMpError(
                f"技能市场搜索失败 (HTTP {resp.status_code})。"
            )

        try:
            payload = resp.json()
        except json.JSONDecodeError as exc:
            raise SkillsMpError("技能市场返回非 JSON 响应。") from exc

        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list):
            raise SkillsMpError("技能市场搜索响应格式异常。")

        skills: list[dict[str, Any]] = []
        for item in results:
            ms = SkillsMpService._to_market_skill(item)
            if ms is None:
                continue
            skills.append(
                {
                    "id": ms.slug,  # 旧上层把 item['id'] 当 slug 用
                    "slug": ms.slug,
                    "name": ms.name,
                    "description": ms.summary,
                    "version": ms.version,
                    "files": ms.files,
                    "skillUrl": f"{market_base()}/skills/{ms.slug}",
                }
            )

        return {"skills": skills, "pagination": {"total": len(skills)}}

    # ---- 详情 ------------------------------------------------------------

    @staticmethod
    def _fetch_detail_raw(slug: str) -> dict[str, Any]:
        url = f"{market_base()}/api/v1/skills/{slug}"
        try:
            with httpx.Client(timeout=DETAIL_TIMEOUT, follow_redirects=True) as client:
                resp = client.get(url, headers=SkillsMpService._headers())
        except httpx.HTTPError as exc:
            raise SkillsMpError(
                humanize_http_error(exc, context="技能详情")
            ) from exc
        if resp.status_code == 404:
            raise SkillsMpError(f"未找到技能: {slug}")
        if resp.status_code != 200:
            raise SkillsMpError(f"技能详情请求失败 (HTTP {resp.status_code})。")
        try:
            payload = resp.json()
        except json.JSONDecodeError as exc:
            raise SkillsMpError("技能详情返回非 JSON 响应。") from exc
        if not isinstance(payload, dict):
            raise SkillsMpError("技能详情响应格式异常。")
        return payload

    @staticmethod
    def get_skill(slug: str) -> dict[str, Any]:
        """获取技能详情（含内联 SKILL.md），归一为旧 skillsmp 上层期望的字段。

        返回 dict 含：name / description / version / slug / skillMd / files /
        skillUrl / githubUrl(=None，ClawHub 无须 GitHub)。
        """
        skill_slug = slug.strip()
        if not skill_slug:
            raise SkillsMpError("skill_slug 不能为空。")

        payload = SkillsMpService._fetch_detail_raw(skill_slug)
        # detail 顶层是 {skill, latestVersion, owner, metaContent}；归一时合并到一层
        merged: dict[str, Any] = {}
        sk = payload.get("skill")
        if isinstance(sk, dict):
            merged.update(sk)
        merged["metaContent"] = payload.get("metaContent")
        merged["slug"] = skill_slug

        ms = SkillsMpService._to_market_skill(merged)
        if ms is None:
            raise SkillsMpError(f"未找到技能: {skill_slug}")

        owner = payload.get("owner") if isinstance(payload.get("owner"), dict) else {}
        author = (owner or {}).get("displayName") or (owner or {}).get("handle")

        return {
            "slug": ms.slug,
            "name": ms.name,
            "author": author or "",
            "description": ms.summary,
            "version": ms.version,
            "skillMd": ms.skill_md,
            "files": ms.files,
            "license": ms.license,
            "skillUrl": f"{market_base()}/skills/{ms.slug}",
            # ClawHub 不依赖 GitHub；保留键以兼容旧调用，恒为空。
            "githubUrl": None,
        }

    # ---- 文件内容（安装）-------------------------------------------------

    @staticmethod
    def _download_zip_bytes(slug: str, version: str | None = None) -> bytes:
        params: dict[str, str] = {"slug": slug}
        if version:
            params["version"] = version
        url = f"{market_base()}/api/v1/download"
        try:
            with httpx.Client(
                timeout=DOWNLOAD_TIMEOUT, follow_redirects=True
            ) as client:
                resp = client.get(
                    url, params=params, headers={"User-Agent": USER_AGENT}
                )
        except httpx.HTTPError as exc:
            raise SkillsMpError(
                humanize_http_error(exc, context="技能下载")
            ) from exc
        if resp.status_code != 200:
            raise SkillsMpError(f"技能下载失败 (HTTP {resp.status_code})。")

        content = resp.content
        content_type = (resp.headers.get("content-type") or "").lower()
        if content[:2] != b"PK" and "zip" not in content_type:
            raise SkillsMpError(
                "技能下载未返回 ZIP（可能技能不存在或镜像异常）。"
            )
        if len(content) > MAX_DOWNLOAD_ZIP_BYTES:
            raise SkillsMpError("技能 ZIP 过大，请手动下载后导入。")
        return content

    @staticmethod
    def _file_map_from_zip_bytes(file_bytes: bytes) -> dict[str, str]:
        import shutil

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
    def fetch_skill_file_map(
        slug: str,
        *,
        version: str | None = None,
        skill_slug: str | None = None,  # 兼容旧签名（曾传 github_url+skill_slug）
    ) -> dict[str, str]:
        """下载技能 ZIP 并解析为 file_map（相对路径 → 文本内容）。

        ClawHub 整包 ZIP 直装，不绕 GitHub。slug 即技能 slug；旧调用可能传
        skill_slug（其值与 slug 相同），二者择一。
        """
        resolved = (slug or skill_slug or "").strip()
        if not resolved:
            raise SkillsMpError("技能 slug 为空。")
        zip_bytes = SkillsMpService._download_zip_bytes(resolved, version)
        return SkillsMpService._file_map_from_zip_bytes(zip_bytes)

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

    # ---- 安装 ------------------------------------------------------------

    @staticmethod
    def install_from_slug(
        slug: str,
        workspace_id: int,
        *,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        skill = SkillsMpService.get_skill(slug)
        version = skill.get("version") if isinstance(skill.get("version"), str) else None

        file_map = SkillsMpService.fetch_skill_file_map(slug, version=version)
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
            source_file_name=f"clawhub:{slug}",
        )
