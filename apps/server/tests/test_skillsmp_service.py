from __future__ import annotations

import json

import pytest

from src.service.skillsmp_service import SkillsMpError, SkillsMpService


class _GhResp:
    """模拟 httpx.Response，按 url 返回预设内容。"""

    def __init__(self, status_code: int, *, text: str = "", payload=None):
        self.status_code = status_code
        self._text = text
        self._payload = payload

    @property
    def text(self) -> str:
        return self._text

    def json(self):
        if self._payload is not None:
            return self._payload
        return json.loads(self._text)


def _make_gh_client(route):
    """route(url) -> _GhResp。返回一个可记录调用的假 httpx.Client。"""

    calls: list[str] = []

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, headers=None, follow_redirects=True):
            calls.append(url)
            return route(url)

    return _Client, calls


def _tree_payload(paths: list[str]) -> dict:
    return {"tree": [{"type": "blob", "path": p} for p in paths]}


def test_parse_github_tree_url_with_subpath() -> None:
    parsed = SkillsMpService.parse_github_tree_url(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/control-ui-e2e"
    )
    assert parsed.owner == "openclaw"
    assert parsed.repo == "openclaw"
    assert parsed.ref == "main"
    assert parsed.subpath == ".agents/skills/control-ui-e2e"


def test_github_contents_url_matches_skillsmp_format() -> None:
    parsed = SkillsMpService.parse_github_tree_url(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/control-ui-e2e"
    )
    url = SkillsMpService.github_contents_url(parsed)
    assert url.startswith("https://skillsmp.com/api/github-contents?")
    assert "owner=openclaw" in url
    assert "repo=openclaw" in url
    assert "branch=main" in url
    assert "path=.agents%2Fskills%2Fcontrol-ui-e2e" in url


def test_github_contents_params() -> None:
    parsed = SkillsMpService.parse_github_tree_url(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/control-ui-e2e"
    )
    params = SkillsMpService.github_contents_params(parsed)
    assert params == {
        "owner": "openclaw",
        "repo": "openclaw",
        "branch": "main",
        "path": ".agents/skills/control-ui-e2e",
    }


def test_normalize_skill_file_map_from_lowercase_skill_md() -> None:
    file_map = {"skill.md": "# Skill\n"}
    normalized = SkillsMpService._normalize_skill_file_map(file_map)
    assert "SKILL.md" in normalized


def test_proxy_headers_prefer_zip() -> None:
    """代理请求头必须 zip 优先，才能让代理一次性返回 ZIP。"""
    headers = SkillsMpService._skillsmp_proxy_headers("some-skill")
    accept = headers["Accept"]
    assert accept.startswith("application/zip"), accept


def test_proxy_no_zip_raises_instead_of_recursing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """代理只返回逐文件清单（无 ZIP）时，应直接抛错退回 GitHub 源，
    绝不递归逐文件下载（会触发代理限流 403）。"""
    parsed = SkillsMpService.parse_github_tree_url(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/crabbox"
    )

    class _Resp:
        status_code = 200
        headers = {"content-type": "application/json"}
        content = b'[{"type":"file","path":".agents/skills/crabbox/SKILL.md"}]'

        @staticmethod
        def json() -> list:
            # 逐文件清单：有 download_url 但无内联 content
            return [
                {
                    "type": "file",
                    "path": ".agents/skills/crabbox/SKILL.md",
                    "download_url": "https://raw.example/SKILL.md",
                }
            ]

    call_count = {"n": 0}

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, params=None, headers=None):
            call_count["n"] += 1
            return _Resp()

    monkeypatch.setattr(
        "src.service.skillsmp_service.httpx.Client", lambda **kw: _Client()
    )

    with pytest.raises(SkillsMpError):
        SkillsMpService._fetch_via_skillsmp_github_contents(parsed)

    # 关键：只发了一次请求，没有为逐文件/子目录发第二次
    assert call_count["n"] == 1, f"发了 {call_count['n']} 次请求，应只发 1 次"


def test_ghproxy_host_rotation(monkeypatch: pytest.MonkeyPatch) -> None:
    """首个 ghproxy host 返回 403，应自动轮询到次个可用 host。"""
    monkeypatch.setenv(
        "SKILL_GHPROXY_HOSTS", "https://bad.example,https://good.example"
    )
    parsed = SkillsMpService.parse_github_tree_url(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/crabbox"
    )

    def route(url: str):
        if url.startswith("https://bad.example/"):
            return _GhResp(403)
        # good host：trees 与 raw 都返回
        if "git/trees" in url:
            return _GhResp(
                200, payload=_tree_payload([".agents/skills/crabbox/SKILL.md"])
            )
        return _GhResp(200, text="# Crabbox\n")

    Client, calls = _make_gh_client(route)
    monkeypatch.setattr("src.service.skillsmp_service.httpx.Client", lambda **kw: Client())

    fm = SkillsMpService._fetch_via_ghproxy(parsed)
    assert "SKILL.md" in fm
    # 确实尝试过 bad host（轮询发生）
    assert any(u.startswith("https://bad.example/") for u in calls)


def test_ghproxy_subpath_filtering(monkeypatch: pytest.MonkeyPatch) -> None:
    """trees 含全仓文件，只取目标技能子目录下的文件。"""
    monkeypatch.setenv("SKILL_GHPROXY_HOSTS", "https://gh.example")
    parsed = SkillsMpService.parse_github_tree_url(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/gitcrawl"
    )

    all_paths = [
        "README.md",
        ".agents/skills/crabbox/SKILL.md",
        ".agents/skills/gitcrawl/SKILL.md",
        ".agents/skills/gitcrawl/agents/helper.md",
        ".agents/skills/gitcrawl/.hidden",  # 应被过滤
    ]

    def route(url: str):
        if "git/trees" in url:
            return _GhResp(200, payload=_tree_payload(all_paths))
        return _GhResp(200, text="content of " + url.rsplit("/", 1)[-1])

    Client, calls = _make_gh_client(route)
    monkeypatch.setattr("src.service.skillsmp_service.httpx.Client", lambda **kw: Client())

    fm = SkillsMpService._fetch_via_ghproxy(parsed)
    assert set(fm) == {"SKILL.md", "agents/helper.md"}


def test_ghproxy_all_hosts_fail_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """所有 ghproxy host 的 trees 请求都失败时，应抛 SkillsMpError 退兜底。"""
    monkeypatch.setenv("SKILL_GHPROXY_HOSTS", "https://a.example,https://b.example")
    parsed = SkillsMpService.parse_github_tree_url(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/crabbox"
    )

    def route(url: str):
        return _GhResp(403)

    Client, _ = _make_gh_client(route)
    monkeypatch.setattr("src.service.skillsmp_service.httpx.Client", lambda **kw: Client())

    with pytest.raises(SkillsMpError):
        SkillsMpService._fetch_via_ghproxy(parsed)


def test_ghproxy_is_first_choice(monkeypatch: pytest.MonkeyPatch) -> None:
    """fetch_skill_file_map 应首选 ghproxy；成功时不触碰 skillsmp 代理。"""
    called = {"ghproxy": False, "skillsmp": False}

    def fake_ghproxy(parsed):
        called["ghproxy"] = True
        return {"SKILL.md": "# ok\n"}

    def fake_skillsmp(parsed, *, skill_slug=None):
        called["skillsmp"] = True
        return {"SKILL.md": "# should-not-run\n"}

    monkeypatch.setattr(SkillsMpService, "_fetch_via_ghproxy", staticmethod(fake_ghproxy))
    monkeypatch.setattr(
        SkillsMpService,
        "_fetch_via_skillsmp_github_contents",
        staticmethod(fake_skillsmp),
    )

    fm = SkillsMpService.fetch_skill_file_map(
        "https://github.com/openclaw/openclaw/tree/main/.agents/skills/crabbox"
    )
    assert fm == {"SKILL.md": "# ok\n"}
    assert called["ghproxy"] is True
    assert called["skillsmp"] is False


def test_search_default_sort_by_stars(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    class _Resp:
        status_code = 200

        @staticmethod
        def json() -> dict:
            return {"success": True, "data": {"skills": [], "pagination": {}}}

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, params=None, headers=None):
            captured["sortBy"] = params["sortBy"]
            return _Resp()

    monkeypatch.setattr("src.service.skillsmp_service.httpx.Client", lambda **kw: _Client())
    SkillsMpService.search("test")
    assert captured["sortBy"] == "stars"
