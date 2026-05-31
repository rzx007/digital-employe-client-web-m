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


def test_normalize_skill_file_map_requires_skill_md() -> None:
    with pytest.raises(SkillsMpError):
        SkillsMpService._normalize_skill_file_map({"README.md": "x"})
