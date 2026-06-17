from src.service.agent.workspace_paths import resolve_workspace_dirs


def test_single_shared_area(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        base_dir=tmp_path / "svc",
    )
    # 单一项目级共享产物区：artifacts/workspace/public_dir/public_root 全归一
    assert d.artifacts_dir == tmp_path / "artifacts"
    assert d.workspace_dir == tmp_path / "artifacts"
    assert d.public_dir == tmp_path / "artifacts"
    assert d.public_root == tmp_path / "artifacts"
    # uploads / draft 仍各自扁平直挂产物根
    assert d.uploads_dir == tmp_path / "uploads"
    assert d.draft_dir == tmp_path / "skills-draft"


def test_no_root_path_falls_back_to_base(tmp_path):
    base = tmp_path / "svc"
    d = resolve_workspace_dirs(
        root_path=None,
        base_dir=base,
    )
    # 无 root_path 时回退 base_dir，公共区仍归一到 base/artifacts
    assert d.artifacts_dir == base / "artifacts"
    assert d.workspace_dir == base / "artifacts"
    assert d.public_dir == base / "artifacts"
    assert d.public_root == base / "artifacts"
    assert d.uploads_dir == base / "uploads"
    assert d.draft_dir == base / "skills-draft"


def test_draft_dir_is_flat(tmp_path):
    """草稿目录拍平为产物根 skills-draft（与 uploads 同级直挂产物根）。"""
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        base_dir=tmp_path / "svc",
    )
    assert d.draft_dir == tmp_path / "skills-draft"
    assert d.draft_dir.parent == d.uploads_dir.parent == tmp_path
