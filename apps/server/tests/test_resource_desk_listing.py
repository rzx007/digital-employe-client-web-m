"""1C：总管会话 artifact-panel 显示共享桌产物。"""
from pathlib import Path

from src.models.conversation import Conversation
from src.service.resource_service import ResourceService, resolve_workspace_context


def _curator_conv(db, ws_id) -> int:
    conv = Conversation(workspace_id=ws_id, target_type="curator", target_id=0, title="总管")
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv.id


def test_resolve_workspace_context_points_artifacts_to_desk(
    patched_task_mutations_db, db_session, workspace
):
    conv_id = _curator_conv(db_session, workspace.id)
    root = workspace.root_path
    desk = Path(root) / "orchestrator-desk" / f"conv-{conv_id}"
    desk.mkdir(parents=True, exist_ok=True)
    (desk / "sort.py").write_text("x", encoding="utf-8")

    workspace_dir, public_root, conv_artifacts = resolve_workspace_context(root, conv_id)
    assert conv_artifacts == desk


def test_resolve_workspace_context_no_desk_unchanged(
    patched_task_mutations_db, db_session, workspace
):
    conv_id = _curator_conv(db_session, workspace.id)
    root = workspace.root_path
    _ws, _pub, conv_artifacts = resolve_workspace_context(root, conv_id)
    assert conv_artifacts == Path(root) / "employee-orchestrator" / "artifacts" / f"conv-{conv_id}"


def test_list_resources_shows_desk_artifacts(
    patched_task_mutations_db, db_session, workspace
):
    conv_id = _curator_conv(db_session, workspace.id)
    root = workspace.root_path
    desk = Path(root) / "orchestrator-desk" / f"conv-{conv_id}"
    (desk / "task-47").mkdir(parents=True, exist_ok=True)
    (desk / "task-47" / "sort.py").write_text("x", encoding="utf-8")
    (desk / "bubble.py").write_text("y", encoding="utf-8")

    rl = ResourceService.list_resources(root, conv_id)
    names: set[str] = set()

    def _walk(entries):
        for e in entries:
            names.add(e.name)
            if getattr(e, "children", None):
                _walk(e.children)

    _walk(rl.artifacts)
    assert "bubble.py" in names
    assert "sort.py" in names
