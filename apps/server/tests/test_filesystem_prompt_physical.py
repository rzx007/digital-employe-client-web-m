"""文件工具 prompt：去虚拟前缀，改真实路径 + env。"""
from src.service.agent.prompts import build_filesystem_prompt_section
from src.service.agent.path_access.prompt_rules import build_file_tool_rules
from src.service.agent.workspace_paths import resolve_workspace_dirs


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


def test_file_tool_rules_single_shared_area():
    """单一共享区文案：$WORKSPACE_DIR=$ARTIFACTS_DIR 全队同写同读；
    不再有 per-employee 公共区，故无 $PUBLIC_*/conv-*/employee-* 残留。"""
    s = build_file_tool_rules(virtual_mode=False, artifacts_real_path=r"D:\ws\a")
    assert "$WORKSPACE_DIR" in s
    assert "$ARTIFACTS_DIR" in s
    assert "共享" in s
    # 旧 per-employee 公共区契约已收敛，文案不得复活
    assert "$PUBLIC_DIR" not in s
    assert "$PUBLIC_ROOT" not in s
    assert "conv-*" not in s
    assert "employee-*" not in s


def test_single_shared_area_contract_physical(tmp_path):
    """单一共享区物理契约：员工 agent 用到的 artifacts/workspace/public_dir/
    public_root 全归一到同一共享区；写入 artifacts_dir 的文件，队友经
    workspace_dir/public_root（同路径）即可读到——"能读写产物、能读到队友产物"。
    外部 root（tmp_path 不在 APP_PROJECTS_BASE 下）→ flat：共享区 = root 本身。"""
    d = resolve_workspace_dirs(root_path=str(tmp_path), base_dir=tmp_path / "svc")

    shared = tmp_path
    assert d.artifacts_dir == shared
    assert d.workspace_dir == shared
    assert d.public_dir == shared
    assert d.public_root == shared

    # 一名员工把产物写进 artifacts_dir
    d.artifacts_dir.mkdir(parents=True, exist_ok=True)
    (d.artifacts_dir / "deliverable.txt").write_text("teammate output", encoding="utf-8")

    # 队友经共享区（workspace_dir / public_root，同一路径）即可读到
    assert (d.workspace_dir / "deliverable.txt").read_text(encoding="utf-8") == (
        "teammate output"
    )
    assert (d.public_root / "deliverable.txt").read_text(encoding="utf-8") == (
        "teammate output"
    )
