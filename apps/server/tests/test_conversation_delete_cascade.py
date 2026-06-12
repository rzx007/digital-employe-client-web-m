"""删会话级联删产物（私有 conv 目录 + 公共子区），cascade=False 时保留。"""
import asyncio
import tempfile
from pathlib import Path

import pytest
from sqlalchemy.orm import sessionmaker

from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.service import chat_service as cs
from src.service.chat_service import ChatService


def _setup(db_engine, monkeypatch, conversation_id=11, employee_id=7):
    root = Path(tempfile.mkdtemp(prefix="de-cascade-"))
    # 员工 7 工作空间会话 11 + 公共子区
    priv = root / f"employee-{employee_id}" / "artifacts" / f"conv-{conversation_id}"
    priv.mkdir(parents=True)
    (priv / "report.md").write_text("r", encoding="utf-8")
    pub = root / "shared" / f"employee-{employee_id}" / f"conv-{conversation_id}"
    pub.mkdir(parents=True)
    (pub / "pub.md").write_text("p", encoding="utf-8")

    class _Settings:
        artifacts_path = str(root)

    monkeypatch.setattr(cs, "get_settings", lambda: _Settings())

    session_factory = sessionmaker(bind=db_engine)
    db = session_factory()
    ws = Workspace(id=1, name="W", root_path=str(root / "ws"))
    db.add(ws)
    db.flush()
    db.add(Conversation(
        id=conversation_id, workspace_id=1,
        target_type="employee", target_id=employee_id, title="t",
    ))
    db.commit()
    return root, db, priv, pub, conversation_id


def test_cascade_deletes_private_and_public(db_engine, monkeypatch):
    root, db, priv, pub, cid = _setup(db_engine, monkeypatch)
    try:
        asyncio.run(ChatService.adelete_conversation(db, cid, cascade_artifacts=True))
        assert not priv.exists()
        assert not pub.exists()
    finally:
        db.close()


def test_no_cascade_keeps_products(db_engine, monkeypatch):
    root, db, priv, pub, cid = _setup(db_engine, monkeypatch, conversation_id=12)
    try:
        asyncio.run(ChatService.adelete_conversation(db, cid, cascade_artifacts=False))
        assert priv.exists()   # 只删会话，产物保留
        assert pub.exists()
    finally:
        db.close()
