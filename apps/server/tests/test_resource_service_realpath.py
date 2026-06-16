"""资源服务：员工工作空间 + 公共区 + 读根沙箱 + 跨员工隔离 + 批量删。"""
from pathlib import Path

import pytest

from src.service import resource_service as rs
from src.service.resource_service import ResourceService


@pytest.fixture()
def ws(tmp_path, monkeypatch):
    """搭建员工 7 的工作空间 + 公共区，并把会话→员工/房间映射打桩为不依赖 DB。"""
    root = tmp_path / "root"
    # 员工 7 工作空间：conv-1 当前会话 + conv-2 过去会话
    (root / "employee-7" / "artifacts" / "conv-1").mkdir(parents=True)
    (root / "employee-7" / "artifacts" / "conv-1" / "report.md").write_text("# r", encoding="utf-8")
    (root / "employee-7" / "artifacts" / "conv-1" / "uploads").mkdir()
    (root / "employee-7" / "artifacts" / "conv-1" / "uploads" / "a.txt").write_text("u", encoding="utf-8")
    (root / "employee-7" / "artifacts" / "conv-2").mkdir(parents=True)
    (root / "employee-7" / "artifacts" / "conv-2" / "old.md").write_text("old", encoding="utf-8")
    # 公共区
    (root / "shared" / "employee-7" / "conv-1").mkdir(parents=True)
    (root / "shared" / "employee-7" / "conv-1" / "pub.md").write_text("pub", encoding="utf-8")
    # 另一个员工 9 的私有工作空间（B 不能读）
    (root / "employee-9" / "artifacts" / "conv-5").mkdir(parents=True)
    (root / "employee-9" / "artifacts" / "conv-5" / "secret.md").write_text("x", encoding="utf-8")

    monkeypatch.setattr(rs, "_resolve_employee_id_for_conversation", lambda cid: 7)
    return str(root), root


def test_list_resources_workspace_and_public(ws):
    root, root_p = ws
    data = ResourceService.list_resources(root, 1)
    # 当前会话产物（不含 uploads 子目录）
    art_names = {e.name for e in data.artifacts}
    assert "report.md" in art_names
    assert "uploads" not in art_names
    # 上传单列
    assert data.uploads and data.uploads[0].name == "a.txt"
    # 工作空间全树含两个会话目录
    ws_names = {e.name for e in data.workspace}
    assert {"conv-1", "conv-2"} <= ws_names
    # 公共区
    pub_names = {e.name for e in data.public}
    assert "employee-7" in pub_names
    # bucket 标注
    assert data.workspace[0].bucket == "workspace"
    assert data.public[0].bucket == "public"


def test_read_content_allows_workspace_and_public(ws):
    root, root_p = ws
    own = str(root_p / "employee-7" / "artifacts" / "conv-2" / "old.md")
    pub = str(root_p / "shared" / "employee-7" / "conv-1" / "pub.md")
    assert ResourceService.read_content(root, 1, own) is not None
    assert ResourceService.read_content(root, 1, pub) is not None


def test_cross_employee_private_rejected(ws):
    root, root_p = ws
    other = str(root_p / "employee-9" / "artifacts" / "conv-5" / "secret.md")
    assert ResourceService.read_content(root, 1, other) is None
    assert ResourceService.resolve_download_path(root, 1, other) is None


def test_sandbox_escape_rejected(ws):
    root, root_p = ws
    outside = str(root_p.parent / "etc_passwd")
    Path(outside).write_text("x", encoding="utf-8")
    assert ResourceService.read_content(root, 1, outside) is None


def test_batch_delete_skips_illegal(ws):
    root, root_p = ws
    ok = str(root_p / "employee-7" / "artifacts" / "conv-2" / "old.md")
    bad = str(root_p / "employee-9" / "artifacts" / "conv-5" / "secret.md")
    res = ResourceService.batch_delete(root, 1, [ok, bad])
    assert ok in res["deleted"]
    assert bad in res["skipped"]
    assert not Path(ok).exists()
    assert Path(bad).exists()  # 跨员工未删


def test_legacy_layout_read_fallback(tmp_path, monkeypatch):
    """迁移兼容：旧会话级布局 <root>/<cid>/artifacts 仍可读、可列。"""
    root = tmp_path / "root"
    legacy = root / "1" / "artifacts"
    legacy.mkdir(parents=True)
    (legacy / "old.md").write_text("legacy", encoding="utf-8")
    monkeypatch.setattr(rs, "_resolve_employee_id_for_conversation", lambda cid: 7)

    data = ResourceService.list_resources(str(root), 1)
    assert any(e.name == "old.md" for e in data.artifacts)
    assert ResourceService.read_content(str(root), 1, str(legacy / "old.md")) is not None
