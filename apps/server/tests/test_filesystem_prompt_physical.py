"""文件工具 prompt：去虚拟前缀，改真实路径 + env。"""
from src.service.agent.prompts import build_filesystem_prompt_section
from src.service.agent.path_access.prompt_rules import build_file_tool_rules


def test_prompt_uses_real_paths_not_virtual():
    s = build_filesystem_prompt_section(
        skills_real_path=r"D:\ws\skills",
        draft_skills_real_path=r"D:\ws\conv\1\skills-draft",
        artifacts_real_path=r"D:\ws\conv\1\artifacts",
        memories_real_path=r"D:\ws\mem",
        agent_real_path=r"D:\ws\agent",
        uploads_real_path=r"D:\ws\conv\1\uploads",
        use_session_history=True,
        has_draft_route=True,
        virtual_mode=False,
    )
    for v in ("/artifacts/", "/skills/", "/uploads/", "/skills-draft/", "/memories/"):
        assert v not in s, f"虚拟前缀仍存在: {v}"
    assert r"D:\ws\conv\1\artifacts" in s or "D:/ws/conv/1/artifacts" in s
    assert "ARTIFACTS_DIR" in s


def test_file_tool_rules_no_virtual_prefix():
    s = build_file_tool_rules(virtual_mode=False, artifacts_real_path=r"D:\ws\a")
    for v in ("/artifacts/", "/skills/", "/uploads/"):
        assert v not in s
    assert "ARTIFACTS_DIR" in s or "SKILLS_DIR" in s


def test_file_tool_rules_mentions_workspace_and_public():
    s = build_file_tool_rules(virtual_mode=False, artifacts_real_path=r"D:\ws\a")
    assert "$WORKSPACE_DIR" in s
    assert "$PUBLIC_DIR" in s
    assert "$PUBLIC_ROOT" in s
