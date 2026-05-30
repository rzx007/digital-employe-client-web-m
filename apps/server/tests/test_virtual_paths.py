"""虚拟前缀映射。"""

from pathlib import Path

from src.service.agent.path_access.virtual_paths import (
    is_virtual_path,
    map_virtual_token,
)


def test_is_virtual_path():
    assert is_virtual_path("/skills/foo")
    assert is_virtual_path("/skills")
    assert is_virtual_path("/artifacts/x.md")
    assert not is_virtual_path("/Users/me")
    assert not is_virtual_path("C:/x")


def test_map_skills_token():
    skills = Path("/tmp/skills")
    assert map_virtual_token("/skills", skills_root=skills) == str(skills)
    mapped = map_virtual_token("/skills/foo/SKILL.md", skills_root=skills)
    assert mapped == str((skills / "foo/SKILL.md").resolve())


def test_map_memories_and_draft_tokens():
    skills = Path("/tmp/skills")
    memories = Path("/tmp/mem")
    draft = Path("/tmp/draft")
    assert (
        map_virtual_token("/memories/a.md", skills_root=skills, memories_root=memories)
        == str((memories / "a.md").resolve())
    )
    assert (
        map_virtual_token("/skills-draft/s", skills_root=skills, draft_root=draft)
        == str((draft / "s").resolve())
    )


def test_non_virtual_token_returned_unchanged():
    skills = Path("/tmp/skills")
    assert map_virtual_token("D:/a/b.pdf", skills_root=skills) == "D:/a/b.pdf"
    assert map_virtual_token("plain.txt", skills_root=skills) == "plain.txt"
    # draft 未提供时，/skills-draft/ 原样返回
    assert map_virtual_token("/skills-draft/x", skills_root=skills) == "/skills-draft/x"
