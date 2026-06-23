"""资源池 service：add（引用产物）/ list / delete。"""
from __future__ import annotations

import pytest

from src.service.workbench_resource_service import WorkbenchResourceService


def test_add_and_list(db_session, workspace):
    created = WorkbenchResourceService.add_artifact(
        db_session,
        workspace_id=workspace.id,
        src_path="employee-1/artifacts/sales.html",
        title="销售看板",
        added_by="u1",
    )
    assert created.id is not None
    assert created.source == "employee_artifact"

    items = WorkbenchResourceService.list_resources(db_session, workspace.id)
    assert len(items) == 1
    assert items[0].title == "销售看板"


def test_add_artifact_defaults_title_to_filename(db_session, workspace):
    created = WorkbenchResourceService.add_artifact(
        db_session,
        workspace_id=workspace.id,
        src_path="employee-1/artifacts/report.html",
        title=None,
        added_by=None,
    )
    assert created.title == "report.html"


def test_delete_artifact_only_removes_record(db_session, workspace):
    created = WorkbenchResourceService.add_artifact(
        db_session,
        workspace_id=workspace.id,
        src_path="employee-1/artifacts/x.html",
        title="x",
        added_by="u1",
    )
    WorkbenchResourceService.delete_resource(db_session, workspace.id, created.id)
    assert WorkbenchResourceService.list_resources(db_session, workspace.id) == []


def test_delete_missing_raises(db_session, workspace):
    with pytest.raises(Exception):
        WorkbenchResourceService.delete_resource(db_session, workspace.id, 99999)
