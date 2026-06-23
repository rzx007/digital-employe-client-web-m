"""SP2 Task 2.1：ResourceService 吃项目产物根（桶直挂、conv_id 不入路径）。

校验：
- 资源面板从 <product_root>/artifacts 读到文件；
- 同一项目下两个会话解析到同一 product_root → 产物项目共享。
"""
from __future__ import annotations

from pathlib import Path

from src.models.conversation import Conversation
from src.models.workspace import Workspace
from src.service.product_paths import resolve_conversation_product_root
from src.service.resource_service import ResourceService


def _mk_workspace(db, root: Path, *, ws_id: int = 1) -> Workspace:
    ws = Workspace(
        id=ws_id,
        name="proj",
        root_path=str(root),
        user_id=f"u-ws{ws_id}",
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


def _mk_conv(db, ws: Workspace, *, target_id: int) -> Conversation:
    conv = Conversation(
        workspace_id=ws.id,
        target_type="employee",
        target_id=target_id,
        title=f"conv-{target_id}",
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def test_list_resources_reads_project_product_root(db_session, tmp_path):
    proj = tmp_path / "proj"
    ws = _mk_workspace(db_session, proj)
    conv = _mk_conv(db_session, ws, target_id=1)

    product_root = resolve_conversation_product_root(db_session, conv)
    # 外部用户文件夹 flat 直挂：产物根 = 文件夹本身
    assert product_root == proj

    # flat：AI 产物平铺写在产物根本身
    product_root.mkdir(parents=True, exist_ok=True)
    (product_root / "foo.txt").write_text("hello", encoding="utf-8")

    data = ResourceService.list_resources(product_root)
    names = {e.name for e in data.artifacts}
    assert "foo.txt" in names

    # read_content 用同一根可读到
    real = str(product_root / "foo.txt")
    content = ResourceService.read_content(product_root, real)
    assert content is not None
    assert content.content == "hello"


def test_list_resources_external_flat_shows_preexisting_files(db_session, tmp_path):
    """非空外部工作空间：用户已有文件/目录平铺显示；噪音/隐藏/其它桶目录跳过。"""
    proj = tmp_path / "existing-repo"
    proj.mkdir()
    # 用户已有内容
    (proj / "main.py").write_text("print(1)", encoding="utf-8")
    (proj / "README.md").write_text("# repo", encoding="utf-8")
    (proj / "src").mkdir()
    (proj / "src" / "util.py").write_text("x=1", encoding="utf-8")
    # 噪音 / 隐藏 / 其它桶——应被跳过
    (proj / "node_modules").mkdir()
    (proj / "node_modules" / "dep.js").write_text("//", encoding="utf-8")
    (proj / ".git").mkdir()
    (proj / ".git" / "HEAD").write_text("ref", encoding="utf-8")
    (proj / "uploads").mkdir()
    (proj / "uploads" / "up.txt").write_text("u", encoding="utf-8")

    ws = _mk_workspace(db_session, proj)
    conv = _mk_conv(db_session, ws, target_id=1)
    product_root = resolve_conversation_product_root(db_session, conv)
    assert product_root == proj

    data = ResourceService.list_resources(product_root)
    top = {e.name: e for e in data.artifacts}
    assert "main.py" in top and "README.md" in top and "src" in top
    # src 目录递归出 util.py
    assert any(c.name == "util.py" for c in top["src"].children)
    # 噪音/隐藏/其它桶不在 artifacts
    assert "node_modules" not in top
    assert ".git" not in top
    assert "uploads" not in top
    # uploads 物理子目录归 uploads 桶
    assert any(e.name == "up.txt" for e in data.uploads)


def test_two_conversations_same_project_share_artifacts(db_session, tmp_path):
    proj = tmp_path / "proj"
    ws = _mk_workspace(db_session, proj)
    conv_a = _mk_conv(db_session, ws, target_id=1)
    conv_b = _mk_conv(db_session, ws, target_id=2)

    root_a = resolve_conversation_product_root(db_session, conv_a)
    root_b = resolve_conversation_product_root(db_session, conv_b)
    # 同项目 → 同产物根（项目共享，conv_id 不入路径）
    assert root_a == root_b

    # 会话 A 写产物（flat 平铺在产物根），会话 B 解析的同一根能列出
    root_a.mkdir(parents=True, exist_ok=True)
    (root_a / "shared.md").write_text("by A", encoding="utf-8")

    data_b = ResourceService.list_resources(root_b)
    assert any(e.name == "shared.md" for e in data_b.artifacts)


def test_upload_and_delete_roundtrip_on_product_root(db_session, tmp_path):
    proj = tmp_path / "proj"
    ws = _mk_workspace(db_session, proj)
    conv = _mk_conv(db_session, ws, target_id=1)
    product_root = resolve_conversation_product_root(db_session, conv)

    res = ResourceService.upload_file(product_root, "note.txt", b"data")
    assert not isinstance(res, str)
    assert res.bucket == "uploads"
    saved = product_root / "uploads" / "note.txt"
    assert saved.is_file()

    # uploads 桶直挂产物根，删之
    assert ResourceService.delete_upload_file(product_root, str(saved)) is True
    assert not saved.exists()


def test_sandbox_escape_rejected(db_session, tmp_path):
    proj = tmp_path / "proj"
    ws = _mk_workspace(db_session, proj)
    conv = _mk_conv(db_session, ws, target_id=1)
    product_root = resolve_conversation_product_root(db_session, conv)
    product_root.mkdir(parents=True, exist_ok=True)

    outside = tmp_path / "secret.txt"
    outside.write_text("top", encoding="utf-8")
    assert ResourceService.read_content(product_root, str(outside)) is None
    assert ResourceService.resolve_download_path(product_root, str(outside)) is None
    assert ResourceService.delete_resource(product_root, str(outside)) is False


def test_voice_roundtrip_under_product_root(db_session, tmp_path):
    proj = tmp_path / "proj"
    ws = _mk_workspace(db_session, proj)
    conv = _mk_conv(db_session, ws, target_id=1)
    product_root = resolve_conversation_product_root(db_session, conv)

    res = ResourceService.save_voice_file(product_root, b"webm")
    assert not isinstance(res, str)
    assert res.audio_path.startswith("voice/")
    saved = product_root / res.audio_path
    assert saved.is_file()

    resolved = ResourceService.resolve_voice_path(product_root, res.audio_path)
    assert resolved is not None
    assert resolved.read_bytes() == b"webm"
    # 越界拒绝
    assert (
        ResourceService.resolve_voice_path(product_root, "voice/../../secret.webm")
        is None
    )
