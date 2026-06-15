from pathlib import Path

from src.service.agent.workspace_paths import resolve_workspace_dirs


def test_employee_conversation(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    assert d.workspace_dir == tmp_path / "employee-7" / "artifacts"
    assert d.artifacts_dir == tmp_path / "employee-7" / "artifacts" / "conv-42"
    assert d.uploads_dir == d.artifacts_dir / "uploads"
    assert d.public_root == tmp_path / "shared"
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "conv-42"


def test_room_member_writes_to_room_but_keeps_own_workspace(tmp_path):
    room = tmp_path / "room-3" / "artifacts"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        shared_artifacts_dir=str(room), base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == room                                   # 协作产出落房间
    assert d.workspace_dir == tmp_path / "employee-7" / "artifacts"  # 仍读自己
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "conv-42"


def test_orchestrator_owner(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id="orchestrator", conversation_id=9,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    assert d.workspace_dir == tmp_path / "employee-orchestrator" / "artifacts"
    assert d.public_dir == tmp_path / "shared" / "employee-orchestrator" / "conv-9"


def test_no_conversation_uses_scratch(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=None,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == tmp_path / "employee-7" / "artifacts" / "_scratch"
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "_scratch"


def test_no_root_path_falls_back_to_base(tmp_path):
    base = tmp_path / "svc"
    d = resolve_workspace_dirs(
        root_path=None, employee_id=None, conversation_id=None,
        shared_artifacts_dir=None, base_dir=base,
    )
    assert d.public_root == base / "shared"
    assert d.workspace_dir == base / "employee-default" / "artifacts"


def test_shared_workspace_root_redirects_read_root(tmp_path):
    """传 shared_workspace_root → workspace_dir 指向共享桌根（读整张桌）；
    artifacts_dir 仍由 shared_artifacts_dir 控制（写自己子目录）。"""
    desk = tmp_path / "orchestrator-desk" / "conv-9"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,
        shared_artifacts_dir=str(desk / "task-100"),
        shared_workspace_root=desk,
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == desk / "task-100"   # 写自己子目录
    assert d.workspace_dir == desk                # 读整张桌
    assert d.public_root == tmp_path / "shared"


def test_shared_workspace_root_absent_keeps_own(tmp_path):
    """不传 shared_workspace_root → workspace_dir 仍是员工自己（群模式行为不变）。"""
    room = tmp_path / "room-3" / "artifacts"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,
        shared_artifacts_dir=str(room),
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == room
    assert d.workspace_dir == tmp_path / "employee-7" / "artifacts"  # 维持现状
