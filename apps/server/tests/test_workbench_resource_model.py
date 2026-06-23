"""workbench_resources 表：建表 + 基本读写。"""
from __future__ import annotations

from src.models.workbench_resource import WorkbenchResource


def test_model_table_name_and_columns():
    assert WorkbenchResource.__tablename__ == "workbench_resources"
    cols = set(WorkbenchResource.__table__.columns.keys())
    assert {
        "id",
        "workspace_id",
        "source",
        "src_path",
        "title",
        "added_by",
        "created_at",
    } <= cols


def test_insert_and_query(db_session, workspace):
    row = WorkbenchResource(
        workspace_id=workspace.id,
        source="upload",
        src_path="workbench-uploads/abc/x.html",
        title="测试看板",
        added_by="u1",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.id is not None
    assert row.created_at is not None
