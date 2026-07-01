"""外部目录模式 GET/PATCH 端点测试。

使用 TestClient + 测试 db 依赖覆盖（仿 test_resource_static.py 风格）。
路由：
  GET  /chat/conversations/{id}/external-dir-mode
  PATCH /chat/conversations/{id}/external-dir-mode
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from src.db.session import get_db
from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.server import app


@pytest.fixture()
def client_with_conv(db_engine, monkeypatch):
    """配置 TestClient：测试库 + 一条 curator 会话，返回 (client, conversation_id)。"""
    session_factory = sessionmaker(bind=db_engine)

    # 建 workspace + conversation
    session = session_factory()
    try:
        ws = Workspace(id=1, name="Test WS", root_path="/tmp/test-ws", user_id="u-ws1")
        session.add(ws)
        session.flush()
        conv = Conversation(
            workspace_id=ws.id,
            target_type="curator",
            target_id=1,
            title="test-conv",
        )
        session.add(conv)
        session.commit()
        conversation_id = conv.id
    finally:
        session.close()

    # 隔离激活网关
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
            yield client, conversation_id
    finally:
        app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# 测试
# ---------------------------------------------------------------------------


def test_get_external_dir_mode_default(client_with_conv):
    """GET 默认返回 mode == 'ask'。"""
    client, conv_id = client_with_conv
    resp = client.get(f"/chat/conversations/{conv_id}/external-dir-mode")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["mode"] == "ask"


def test_patch_external_dir_mode_auto_then_get(client_with_conv):
    """PATCH 设 'auto' 后 GET 返回 'auto'。"""
    client, conv_id = client_with_conv
    patch_resp = client.patch(
        f"/chat/conversations/{conv_id}/external-dir-mode",
        json={"mode": "auto"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["data"]["mode"] == "auto"

    get_resp = client.get(f"/chat/conversations/{conv_id}/external-dir-mode")
    assert get_resp.status_code == 200
    assert get_resp.json()["data"]["mode"] == "auto"


def test_patch_external_dir_mode_deny(client_with_conv):
    """PATCH 设 'deny' 后 GET 返回 'deny'。"""
    client, conv_id = client_with_conv
    resp = client.patch(
        f"/chat/conversations/{conv_id}/external-dir-mode",
        json={"mode": "deny"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["mode"] == "deny"


def test_patch_external_dir_mode_ask(client_with_conv):
    """PATCH 设 'ask' 后 GET 返回 'ask'（覆盖已有设置）。"""
    client, conv_id = client_with_conv
    # 先设为 auto
    client.patch(
        f"/chat/conversations/{conv_id}/external-dir-mode",
        json={"mode": "auto"},
    )
    # 再改回 ask
    resp = client.patch(
        f"/chat/conversations/{conv_id}/external-dir-mode",
        json={"mode": "ask"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["mode"] == "ask"


def test_patch_external_dir_mode_invalid_returns_400(client_with_conv):
    """PATCH 非法 mode（如 'bogus'）返回 400。"""
    client, conv_id = client_with_conv
    resp = client.patch(
        f"/chat/conversations/{conv_id}/external-dir-mode",
        json={"mode": "bogus"},
    )
    assert resp.status_code == 400
