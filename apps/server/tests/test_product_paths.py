from pathlib import Path

from src.service.agent.workspace_paths import (
    resolve_workspace_product_root,
    APP_PROJECTS_BASE,
)


def test_managed_root_returns_dir_directly():
    # 托管区项目目录：产物直接放其下，不套 .digital-employee
    managed = APP_PROJECTS_BASE / "5"
    assert resolve_workspace_product_root(str(managed)) == managed


def test_managed_base_itself_is_managed():
    assert resolve_workspace_product_root(str(APP_PROJECTS_BASE)) == APP_PROJECTS_BASE


def test_external_folder_gets_hidden_subdir():
    ext = Path("/tmp/my-source-repo")
    assert resolve_workspace_product_root(str(ext)) == ext / ".digital-employee"


def test_conversation_product_root_from_workspace(db_session):
    from src.models.workspace import Workspace
    from src.models.conversation import Conversation
    from src.service.product_paths import resolve_conversation_product_root
    from src.service.agent.workspace_paths import resolve_workspace_product_root
    ws = Workspace(name="w", root_path="/tmp/proj-x", user_id="u1")
    db_session.add(ws); db_session.flush()
    c = Conversation(workspace_id=ws.id, user_id="u1", target_type="curator", target_id=1)
    db_session.add(c); db_session.commit()
    got = resolve_conversation_product_root(db_session, c)
    assert got == resolve_workspace_product_root("/tmp/proj-x")
