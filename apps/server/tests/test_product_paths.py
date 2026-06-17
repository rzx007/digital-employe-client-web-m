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
