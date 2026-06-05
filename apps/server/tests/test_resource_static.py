"""会话产物 inline 静态资源端点测试（HTML 预览用）。"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from src.api import chat_api
from src.db.session import get_db
from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.server import app

HTML_BODY = (
    "<!doctype html><html><head>"
    '<link rel="stylesheet" href="./style.css">'
    "</head><body><h1>Hello Preview</h1></body></html>"
)
CSS_BODY = "h1 { color: red; }"


@pytest.fixture()
def static_client(db_engine, monkeypatch):
    """配置 TestClient：测试库 + 临时 artifacts 目录 + 一条带产物的会话。"""
    session_factory = sessionmaker(bind=db_engine)

    # 创建 workspace + conversation（id=1）
    session = session_factory()
    try:
        ws = Workspace(id=1, name="Test Workspace", root_path=tempfile.mkdtemp())
        session.add(ws)
        session.flush()
        conv = Conversation(
            id=1,
            workspace_id=ws.id,
            target_type="employee",
            target_id=1,
            title="t",
        )
        session.add(conv)
        session.commit()
        conversation_id = conv.id
    finally:
        session.close()

    # 临时 artifacts 目录：<root>/<conversation_id>/artifacts/{report.html, style.css}
    artifacts_root = Path(tempfile.mkdtemp(prefix="de-test-artifacts-"))
    artifacts_dir = artifacts_root / str(conversation_id) / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (artifacts_dir / "report.html").write_text(HTML_BODY, encoding="utf-8")
    (artifacts_dir / "style.css").write_text(CSS_BODY, encoding="utf-8")

    # 让端点内 get_settings() 返回指向临时目录的配置
    class _Settings:
        artifacts_path = str(artifacts_root)

    monkeypatch.setattr(chat_api, "get_settings", lambda: _Settings())

    # 覆盖 get_db 依赖，使用测试库
    def _override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(app) as client:
            client.conversation_id = conversation_id  # type: ignore[attr-defined]
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


def _url(client: TestClient, path: str) -> str:
    cid = client.conversation_id  # type: ignore[attr-defined]
    return f"/chat/conversations/{cid}/resources/static/{path}"


def test_html_served_inline_with_html_content_type(static_client):
    resp = static_client.get(_url(static_client, "artifacts/report.html"))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    # 不能作为附件下载，否则浏览器不会渲染
    disposition = resp.headers.get("content-disposition", "")
    assert "attachment" not in disposition.lower()
    assert "Hello Preview" in resp.text


def test_relative_css_asset_served_with_css_content_type(static_client):
    resp = static_client.get(_url(static_client, "artifacts/style.css"))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/css")
    assert "color: red" in resp.text


def test_path_traversal_rejected(static_client):
    resp = static_client.get(_url(static_client, "artifacts/../../secret"))
    assert resp.status_code in (400, 404)


def test_missing_file_returns_404(static_client):
    resp = static_client.get(_url(static_client, "artifacts/does-not-exist.html"))
    assert resp.status_code == 404
