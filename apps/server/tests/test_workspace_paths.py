from src.service.agent.workspace_paths import resolve_workspace_dirs


def test_employee_conversation(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        base_dir=tmp_path / "svc",
    )
    # 三桶拍平直挂产物根（不再带 employee/conv 分层，也无共享桌 override）
    assert d.workspace_dir == tmp_path / "artifacts"
    assert d.artifacts_dir == tmp_path / "artifacts"
    assert d.uploads_dir == tmp_path / "uploads"
    assert d.draft_dir == tmp_path / "skills-draft"
    # 公共区暂不动（Task 3.2b 收口）
    assert d.public_root == tmp_path / "shared"
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "conv-42"


def test_orchestrator_owner(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id="orchestrator", conversation_id=9,
        base_dir=tmp_path / "svc",
    )
    # 总管与员工同写同一个项目级 artifacts 桶（共享桌已消解）
    assert d.artifacts_dir == tmp_path / "artifacts"
    assert d.workspace_dir == tmp_path / "artifacts"
    assert d.public_dir == tmp_path / "shared" / "employee-orchestrator" / "conv-9"


def test_no_conversation_uses_scratch(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=None,
        base_dir=tmp_path / "svc",
    )
    # 三桶拍平后与 conv 无关
    assert d.artifacts_dir == tmp_path / "artifacts"
    assert d.uploads_dir == tmp_path / "uploads"
    assert d.draft_dir == tmp_path / "skills-draft"
    # 仅公共区仍用 _scratch conv 回退（公共区 Task 3.2b 收口）
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "_scratch"


def test_no_root_path_falls_back_to_base(tmp_path):
    base = tmp_path / "svc"
    d = resolve_workspace_dirs(
        root_path=None, employee_id=None, conversation_id=None,
        base_dir=base,
    )
    assert d.public_root == base / "shared"
    assert d.workspace_dir == base / "artifacts"


def test_draft_dir_is_flat(tmp_path):
    """草稿目录拍平为产物根 skills-draft（与 uploads 同级直挂产物根）。"""
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        base_dir=tmp_path / "svc",
    )
    assert d.draft_dir == tmp_path / "skills-draft"
    assert d.draft_dir.parent == d.uploads_dir.parent == tmp_path
