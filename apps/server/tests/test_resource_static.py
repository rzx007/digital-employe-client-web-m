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

    # 隔离激活网关：静态路由单元测试不依赖激活状态（某些环境强制激活会 403）
    from types import SimpleNamespace
    from src.core import activation_gateway

    monkeypatch.setattr(
        activation_gateway.ActivationService,
        "get_status",
        staticmethod(
            lambda: SimpleNamespace(enforced=False, activated=True, reason=None)
        ),
    )

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
            client.artifacts_dir = artifacts_dir  # type: ignore[attr-defined]
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


def _url(client: TestClient, real_path: str) -> str:
    """静态服务改为真实路径查询参数：?path=<abs>。"""
    cid = client.conversation_id  # type: ignore[attr-defined]
    return f"/chat/conversations/{cid}/resources/static"


def _get(client: TestClient, real_path: str):
    cid = client.conversation_id  # type: ignore[attr-defined]
    return client.get(
        f"/chat/conversations/{cid}/resources/static", params={"path": real_path}
    )


def test_html_served_inline_with_html_content_type(static_client):
    real = str(static_client.artifacts_dir / "report.html")  # type: ignore[attr-defined]
    resp = _get(static_client, real)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    # 不能作为附件下载，否则浏览器不会渲染
    disposition = resp.headers.get("content-disposition", "")
    assert "attachment" not in disposition.lower()
    assert "Hello Preview" in resp.text


def test_relative_css_asset_served_with_css_content_type(static_client):
    real = str(static_client.artifacts_dir / "style.css")  # type: ignore[attr-defined]
    resp = _get(static_client, real)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/css")
    assert "color: red" in resp.text


def test_path_traversal_rejected(static_client):
    # 会话根之外的真实路径 → 沙箱拒绝
    outside = str(static_client.artifacts_dir.parent.parent / "secret")  # type: ignore[attr-defined]
    resp = _get(static_client, outside)
    assert resp.status_code in (400, 404)


def test_missing_file_returns_404(static_client):
    real = str(static_client.artifacts_dir / "does-not-exist.html")  # type: ignore[attr-defined]
    resp = _get(static_client, real)
    assert resp.status_code == 404
