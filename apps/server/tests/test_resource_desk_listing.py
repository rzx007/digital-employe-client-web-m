"""1C：总管会话 artifact-panel 显示共享桌产物。"""
from pathlib import Path

from src.models.conversation import Conversation
from src.service.resource_service import resolve_workspace_context


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


# NOTE(SP2 Task 2.1): 资源面板的「共享桌产物合并」读路径已随 legacy/desk-merge
# 读回退一并删除（spec §2「不做双轨读回退」）。SP2 后资源面板只读项目产物根下
# 的 artifacts/uploads/skills-draft 三桶；总管/desk 产物落项目根是 Task 2.3 的事，
# 届时再补对应面板可见性测试。原 test_list_resources_shows_desk_artifacts 因此移除。
#
# resolve_workspace_context 本身（含其内部 desk 重定向）仍保留，供 skill_api 草稿
# 技能解析使用，上面两个测试继续覆盖其行为。
