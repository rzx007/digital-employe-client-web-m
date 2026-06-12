"""ClawHub 镜像技能市场客户端测试（搜索 / 详情 / 下载 / 归一化）。

历史：本套测试原覆盖 skillsmp.com 的 GitHub/ghproxy 下载路径，已随服务整体切到
ClawHub 镜像而重写。
"""
from __future__ import annotations

import io
import zipfile

import pytest

from src.service import skillsmp_service
from src.service.skillsmp_service import (
    DEFAULT_MARKET_BASE,
    SkillsMpError,
    SkillsMpService,
    market_base,
    market_web_url,
)


class _Resp:
    """最小 httpx.Response 替身：固定 status / json / content / headers。"""

    def __init__(
        self,
        status_code: int = 200,
        *,
        payload=None,
        content: bytes = b"",
        headers: dict | None = None,
    ):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("no json payload")
        return self._payload


def _client_returning(resp_for):
    """构造假 httpx.Client；resp_for(url, params) -> _Resp，并记录调用。"""

    calls: list[dict] = []

    class _Client:
        def __init__(self, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url, params=None, headers=None, follow_redirects=True):
            calls.append({"url": url, "params": params})
            return resp_for(url, params)

    return _Client, calls


def _zip_bytes(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


# ---- base 配置 -----------------------------------------------------------


def test_market_base_default() -> None:
    assert market_base() == DEFAULT_MARKET_BASE
    assert market_web_url() == f"{DEFAULT_MARKET_BASE}/skills"


def test_market_base_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SKILL_MARKET_BASE", "https://my.mirror.example/")
    assert market_base() == "https://my.mirror.example"
    assert market_web_url() == "https://my.mirror.example/skills"


# ---- 搜索 ---------------------------------------------------------------


def test_search_parses_results(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "results": [
            {
                "slug": "ppt",
                "displayName": "ppt",
                "summary": "生成演示稿",
                "version": "1.0.0",
                "metaContent": {
                    "Files": ["SKILL.md", "_meta.json"],
                    "skillMd": "---\nname: ppt\n---\n",
                    "License": "MIT-0",
                },
            },
            {"not_a_dict": True},  # 应被跳过
            {"displayName": "no slug"},  # 无 slug，应被跳过
        ]
    }
    Client, calls = _client_returning(lambda url, params: _Resp(payload=payload))
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)

    data = SkillsMpService.search("ppt", limit=3)
    assert calls[0]["url"].endswith("/api/v1/search")
    assert calls[0]["params"]["q"] == "ppt"
    skills = data["skills"]
    assert len(skills) == 1
    s = skills[0]
    assert s["slug"] == "ppt"
    assert s["id"] == "ppt"  # 旧上层把 id 当 slug 用
    assert s["name"] == "ppt"
    assert s["version"] == "1.0.0"
    assert s["skillUrl"].endswith("/skills/ppt")


def test_search_empty_query_raises() -> None:
    with pytest.raises(SkillsMpError):
        SkillsMpService.search("   ")


def test_search_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    Client, _ = _client_returning(lambda url, params: _Resp(500))
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)
    with pytest.raises(SkillsMpError):
        SkillsMpService.search("ppt")


def test_search_bad_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    Client, _ = _client_returning(lambda url, params: _Resp(payload={"nope": 1}))
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)
    with pytest.raises(SkillsMpError):
        SkillsMpService.search("ppt")


# ---- 详情 ---------------------------------------------------------------


def test_get_skill_merges_inline_skill_md(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "skill": {"slug": "autoreview", "displayName": "Autoreview", "summary": "代码评审"},
        "owner": {"handle": "thanosbao", "displayName": "ThanosBao"},
        "metaContent": {
            "Files": ["SKILL.md", "_meta.json"],
            "skillMd": "---\nname: autoreview\n---\nbody",
            "License": "MIT-0",
            "latest": {"version": "0.1.0"},
        },
    }
    Client, calls = _client_returning(lambda url, params: _Resp(payload=payload))
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)

    detail = SkillsMpService.get_skill("autoreview")
    assert calls[0]["url"].endswith("/api/v1/skills/autoreview")
    assert detail["slug"] == "autoreview"
    assert detail["name"] == "Autoreview"
    assert detail["author"] == "ThanosBao"
    assert detail["version"] == "0.1.0"
    assert detail["skillMd"].startswith("---")
    assert detail["files"] == ["SKILL.md", "_meta.json"]
    assert detail["githubUrl"] is None  # ClawHub 不依赖 GitHub


def test_get_skill_404(monkeypatch: pytest.MonkeyPatch) -> None:
    Client, _ = _client_returning(lambda url, params: _Resp(404))
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)
    with pytest.raises(SkillsMpError):
        SkillsMpService.get_skill("nope")


def test_get_skill_empty_slug() -> None:
    with pytest.raises(SkillsMpError):
        SkillsMpService.get_skill("  ")


# ---- 下载 / file_map ----------------------------------------------------


def test_fetch_skill_file_map_from_zip(monkeypatch: pytest.MonkeyPatch) -> None:
    zip_bytes = _zip_bytes(
        {
            "SKILL.md": "---\nname: ppt\n---\n",
            "scripts/run.py": "print('hi')\n",
            ".hidden": "ignored",  # 点开头应被忽略
        }
    )

    def resp_for(url, params):
        assert url.endswith("/api/v1/download")
        assert params["slug"] == "ppt"
        return _Resp(content=zip_bytes, headers={"content-type": "application/zip"})

    Client, _ = _client_returning(resp_for)
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)

    fm = SkillsMpService.fetch_skill_file_map("ppt")
    assert "SKILL.md" in fm
    assert "scripts/run.py" in fm
    assert ".hidden" not in fm


def test_fetch_skill_file_map_passes_version(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def resp_for(url, params):
        captured.update(params)
        return _Resp(
            content=_zip_bytes({"SKILL.md": "x"}),
            headers={"content-type": "application/zip"},
        )

    Client, _ = _client_returning(resp_for)
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)

    SkillsMpService.fetch_skill_file_map("ppt", version="1.2.3")
    assert captured["version"] == "1.2.3"


def test_download_non_zip_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    Client, _ = _client_returning(
        lambda url, params: _Resp(
            content=b"<!doctype html>", headers={"content-type": "text/html"}
        )
    )
    monkeypatch.setattr(skillsmp_service.httpx, "Client", Client)
    with pytest.raises(SkillsMpError):
        SkillsMpService.fetch_skill_file_map("ppt")


def test_fetch_skill_file_map_empty_slug() -> None:
    with pytest.raises(SkillsMpError):
        SkillsMpService.fetch_skill_file_map("  ")


# ---- 归一化 -------------------------------------------------------------


def test_normalize_skill_file_map_from_lowercase_skill_md() -> None:
    file_map = {"skill.md": "# Skill\n"}
    normalized = SkillsMpService._normalize_skill_file_map(file_map)
    assert "SKILL.md" in normalized


def test_normalize_requires_skill_md() -> None:
    with pytest.raises(SkillsMpError):
        SkillsMpService._normalize_skill_file_map({"readme.md": "x"})
