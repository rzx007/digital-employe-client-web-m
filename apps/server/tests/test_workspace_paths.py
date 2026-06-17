from pathlib import Path

from src.service.agent.workspace_paths import resolve_workspace_dirs


def test_employee_conversation(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    # 三桶拍平直挂产物根（不再带 employee/conv 分层）
    assert d.workspace_dir == tmp_path / "artifacts"
    assert d.artifacts_dir == tmp_path / "artifacts"
    assert d.uploads_dir == tmp_path / "uploads"
    assert d.draft_dir == tmp_path / "skills-draft"
    # 公共区本任务不动（Task 3.2 收口）
    assert d.public_root == tmp_path / "shared"
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "conv-42"


def test_room_member_writes_to_room_but_keeps_own_workspace(tmp_path):
    room = tmp_path / "room-3" / "artifacts"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=42,
        shared_artifacts_dir=str(room), base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == room                  # 协作产出落房间（desk override 保留）
    assert d.workspace_dir == tmp_path / "artifacts"  # 无 shared_workspace_root → 拍平产物根
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "conv-42"


def test_orchestrator_owner(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id="orchestrator", conversation_id=9,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    assert d.workspace_dir == tmp_path / "artifacts"
    assert d.public_dir == tmp_path / "shared" / "employee-orchestrator" / "conv-9"


def test_no_conversation_uses_scratch(tmp_path):
    d = resolve_workspace_dirs(
        root_path=str(tmp_path), employee_id=7, conversation_id=None,
        shared_artifacts_dir=None, base_dir=tmp_path / "svc",
    )
    # 三桶拍平后与 conv 无关
    assert d.artifacts_dir == tmp_path / "artifacts"
    assert d.uploads_dir == tmp_path / "uploads"
    assert d.draft_dir == tmp_path / "skills-draft"
    # 仅公共区仍用 _scratch conv 回退（公共区 Task 3.2 收口）
    assert d.public_dir == tmp_path / "shared" / "employee-7" / "_scratch"


def test_no_root_path_falls_back_to_base(tmp_path):
    base = tmp_path / "svc"
    d = resolve_workspace_dirs(
        root_path=None, employee_id=None, conversation_id=None,
        shared_artifacts_dir=None, base_dir=base,
    )
    assert d.public_root == base / "shared"
    assert d.workspace_dir == base / "artifacts"


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


def test_shared_workspace_root_absent_keeps_flat(tmp_path):
    """不传 shared_workspace_root → workspace_dir 拍平为产物根 artifacts 桶。"""
    room = tmp_path / "room-3" / "artifacts"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,
        shared_artifacts_dir=str(room),
        base_dir=tmp_path / "svc",
    )
    assert d.artifacts_dir == room
    assert d.workspace_dir == tmp_path / "artifacts"  # 拍平共享


def test_resolve_orchestrator_desk_dir(tmp_path):
    """共享桌按总管会话隔离，路径 = <root>/orchestrator-desk/conv-<orchConvId>，并 mkdir。"""
    from src.service.agent.workspace_paths import resolve_orchestrator_desk_dir
    desk = resolve_orchestrator_desk_dir(str(tmp_path), 9)
    assert desk == tmp_path / "orchestrator-desk" / "conv-9"
    assert desk.is_dir()


def test_orchestrator_task_subdir(tmp_path):
    """子任务写子目录 = 桌根/task-<taskId>。"""
    from src.service.agent.workspace_paths import (
        resolve_orchestrator_desk_dir,
        orchestrator_task_subdir,
    )
    desk = resolve_orchestrator_desk_dir(str(tmp_path), 9)
    sub = orchestrator_task_subdir(desk, 100)
    assert sub == desk / "task-100"


def test_draft_dir_is_flat_not_desk(tmp_path):
    """草稿目录拍平为产物根 skills-draft（不随共享桌/员工漂移）。"""
    desk = tmp_path / "orchestrator-desk" / "conv-9"
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,
        shared_artifacts_dir=str(desk / "task-100"),
        shared_workspace_root=desk,
        base_dir=tmp_path / "svc",
    )
    # 草稿拍平到产物根，不在共享桌下、不带 employee/conv
    assert d.draft_dir == tmp_path / "skills-draft"
    # 与 uploads 同级（都直挂产物根）
    assert d.draft_dir.parent == d.uploads_dir.parent == tmp_path


def test_draft_dir_without_redirect(tmp_path):
    """无共享桌时草稿目录也拍平到产物根 skills-draft。"""
    d = resolve_workspace_dirs(
        root_path=str(tmp_path),
        employee_id=7,
        conversation_id=42,
        shared_artifacts_dir=None,
        base_dir=tmp_path / "svc",
    )
    assert d.draft_dir == tmp_path / "skills-draft"
