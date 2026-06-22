"""资源池 API：list / add / delete（用 FastAPI TestClient + get_db 覆盖到测试库）。"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.workbench_resource_api import router
from src.db.session import get_db


@pytest.fixture()
def client(db_session):
    app = FastAPI()
    app.include_router(router)

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_add_list_delete_flow(client, workspace):
    ws = workspace.id
    # add（引用产物）
    r = client.post(
        "/workbench-resources/add",
        json={
            "workspace_id": ws,
            "src_path": "employee-1/artifacts/s.html",
            "title": "S",
        },
    )
    assert r.status_code in (200, 201), r.text
    rid = r.json()["data"]["id"]

    # list
    r = client.get("/workbench-resources/list", params={"workspace_id": ws})
    assert r.status_code == 200
    assert any(item["id"] == rid for item in r.json()["data"])

    # delete
    r = client.delete(f"/workbench-resources/{rid}", params={"workspace_id": ws})
    assert r.status_code == 200

    # 删后 list 不再含它
    r = client.get("/workbench-resources/list", params={"workspace_id": ws})
    assert all(item["id"] != rid for item in r.json()["data"])


def test_upload_rejects_non_html(client, workspace):
    files = {"file": ("x.txt", b"hello", "text/plain")}
    r = client.post(
        "/workbench-resources/upload",
        data={"workspace_id": str(workspace.id)},
        files=files,
    )
    assert r.status_code == 400
