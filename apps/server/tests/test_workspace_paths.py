from src.service.agent.workspace_paths import resolve_workspace_dirs


def test_single_shared_area(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        base_dir=tmp_path / "svc",
    )
    # 外部 root（tmp_path 不在 APP_PROJECTS_BASE 下）→ flat：
    # artifacts/workspace/public_dir/public_root 全归一到 root 本身
    assert d.artifacts_dir == tmp_path
    assert d.workspace_dir == tmp_path
    assert d.public_dir == tmp_path
    assert d.public_root == tmp_path
    # 外部 flat：uploads 也平铺进 root 本身；draft 仍套 skills-draft 子目录
    assert d.uploads_dir == tmp_path
    assert d.draft_dir == tmp_path / "skills-draft"


def test_no_root_path_falls_back_to_base(tmp_path):
    base = tmp_path / "svc"
    d = resolve_workspace_dirs(
        root_path=None,
        base_dir=base,
    )
    # 无 root_path 时回退 base_dir；base 在 APP_PROJECTS_BASE 外 → flat，归一到 base 本身
    assert d.artifacts_dir == base
    assert d.workspace_dir == base
    assert d.public_dir == base
    assert d.public_root == base
    assert d.uploads_dir == base
    assert d.draft_dir == base / "skills-draft"


def test_draft_dir_is_flat(tmp_path):
    """外部 flat：草稿目录 = root/skills-draft；uploads 平铺进 root 本身。"""
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        base_dir=tmp_path / "svc",
    )
    assert d.draft_dir == tmp_path / "skills-draft"
    assert d.draft_dir.parent == tmp_path
    assert d.uploads_dir == tmp_path  # 外部 flat：uploads 直挂 root
