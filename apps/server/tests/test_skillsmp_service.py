from __future__ import annotations

import pytest

from src.service.skillsmp_service import SkillsMpError, SkillsMpService


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


def test_fetch_skill_file_map_prefers_skillsmp_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def _skillsmp(_parsed, *, skill_slug=None):
        calls.append("skillsmp")
        return {"SKILL.md": "# proxy\n"}

    def _api(_parsed):
        calls.append("api")
        raise SkillsMpError("api fail")

    def _zip(_parsed):
        calls.append("zip")
        raise SkillsMpError("zip fail")

    monkeypatch.setattr(
        SkillsMpService,
        "_fetch_via_skillsmp_github_contents",
        staticmethod(_skillsmp),
    )
    monkeypatch.setattr(
        SkillsMpService, "_fetch_via_github_api", staticmethod(_api)
    )
    monkeypatch.setattr(
        SkillsMpService, "_fetch_via_repo_zip", staticmethod(_zip)
    )

    result = SkillsMpService.fetch_skill_file_map(
        "https://github.com/bytedance/deer-flow/tree/main/skills/public/claude-to-deerflow",
        skill_slug="bytedance-deer-flow-skills-public-claude-to-deerflow-skill-md",
    )
    assert result["SKILL.md"] == "# proxy\n"
    assert calls == ["skillsmp"]


def test_fetch_skill_file_map_falls_back_when_skillsmp_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    def _skillsmp(_parsed, *, skill_slug=None):
        raise SkillsMpError("403")

    def _api(_parsed):
        raise httpx.RemoteProtocolError("Server disconnected without sending a response.")

    def _zip(_parsed):
        return {"SKILL.md": "# zip\n"}

    monkeypatch.setattr(
        SkillsMpService,
        "_fetch_via_skillsmp_github_contents",
        staticmethod(_skillsmp),
    )
    monkeypatch.setattr(
        SkillsMpService, "_fetch_via_github_api", staticmethod(_api)
    )
    monkeypatch.setattr(
        SkillsMpService, "_fetch_via_repo_zip", staticmethod(_zip)
    )

    result = SkillsMpService.fetch_skill_file_map(
        "https://github.com/bytedance/deer-flow/tree/main/skills/public/claude-to-deerflow"
    )
    assert result["SKILL.md"] == "# zip\n"
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
