"""SP2：产物现为项目级共享，删单个会话不删共享产物。

旧语义（已废弃）：adelete_conversation 会按全局 artifacts_path 下的
employee-<id>/conv-<cid> 私有目录 + 公共子区做 rmtree。SP2 把产物改成项目级
共享（同项目所有会话共用 `<product_root>/{artifacts,uploads,...}`），删单个会话
必须保留这些共享产物——否则会抹掉同项目其它会话仍引用的产物。整个项目的产物
随 WorkspaceService.delete_workspace 统一清理。

故这里断言新语义：删会话只清 DB 行（含 checkpoint/stream，本测试聚焦磁盘），
共享产物目录无论 cascade 真假都必须存活。
"""
import asyncio
import tempfile
from pathlib import Path

from sqlalchemy.orm import sessionmaker

from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.service.chat_service import ChatService


def _setup(db_engine, conversation_id, employee_id=7):
    """建工作空间 + 项目共享产物文件 + 两个会话（同项目）。"""
    root = Path(tempfile.mkdtemp(prefix="de-shared-product-"))
    # 项目级共享产物（同项目所有会话共用），写入一个产物文件
    shared_artifacts = root / "artifacts"
    shared_artifacts.mkdir(parents=True)
    (shared_artifacts / "report.md").write_text("shared product", encoding="utf-8")
    shared_uploads = root / "uploads"
    shared_uploads.mkdir(parents=True)
    (shared_uploads / "input.txt").write_text("shared upload", encoding="utf-8")

    session_factory = sessionmaker(bind=db_engine)
    db = session_factory()
    ws = Workspace(id=1, name="W", root_path=str(root))
    db.add(ws)
    db.flush()
    # 同一项目下两个会话：删其一，另一仍引用共享产物
    db.add(Conversation(
        id=conversation_id, workspace_id=1,
        target_type="employee", target_id=employee_id, title="t1",
    ))
    db.add(Conversation(
        id=conversation_id + 100, workspace_id=1,
        target_type="employee", target_id=employee_id, title="t2",
    ))
    db.commit()
    return root, db, shared_artifacts, shared_uploads


def test_delete_conversation_keeps_shared_products(db_engine):
    cid = 11
    root, db, shared_artifacts, shared_uploads = _setup(db_engine, cid)
    try:
        asyncio.run(ChatService.adelete_conversation(db, cid, cascade_artifacts=True))
        # DB 行已删
        assert db.get(Conversation, cid) is None
        # 同项目另一会话仍在
        assert db.get(Conversation, cid + 100) is not None
        # 共享产物（artifacts/uploads）必须存活——其它会话仍引用
        assert shared_artifacts.exists()
        assert (shared_artifacts / "report.md").exists()
        assert shared_uploads.exists()
        assert (shared_uploads / "input.txt").exists()
    finally:
        db.close()


def test_cascade_false_also_keeps_shared_products(db_engine):
    """cascade=False 与 True 在新模型下对共享产物行为一致：都不删。"""
    cid = 12
    root, db, shared_artifacts, shared_uploads = _setup(db_engine, cid)
    try:
        asyncio.run(ChatService.adelete_conversation(db, cid, cascade_artifacts=False))
        assert db.get(Conversation, cid) is None
        assert shared_artifacts.exists()
        assert shared_uploads.exists()
    finally:
        db.close()
