"""资源服务（SP2 后）：项目产物根直挂三桶 + 沙箱 + 批量删。

SP2 Task 2.1 后 ResourceService 不再有 workspace/public 桶与会话级布局/legacy
回退，所有路径相对单一 product_root，桶 artifacts/uploads/skills-draft 直挂其下。
"""
from pathlib import Path

from src.service.resource_service import ResourceService


def _seed(root: Path) -> None:
    """在 product_root 下铺三桶样本。"""
    (root / "artifacts").mkdir(parents=True)
    (root / "artifacts" / "report.md").write_text("# r", encoding="utf-8")
    (root / "artifacts" / "sub").mkdir()
    (root / "artifacts" / "sub" / "nested.md").write_text("n", encoding="utf-8")
    (root / "uploads").mkdir()
    (root / "uploads" / "a.txt").write_text("u", encoding="utf-8")


def test_list_resources_buckets_under_product_root(tmp_path):
    # 外部 flat 工作空间：artifacts 平铺在产物根本身；uploads 物理在子目录
    root = tmp_path / "proj"
    root.mkdir(parents=True)
    (root / "report.md").write_text("# r", encoding="utf-8")
    (root / "sub").mkdir()
    (root / "sub" / "nested.md").write_text("n", encoding="utf-8")
    (root / "uploads").mkdir()
    (root / "uploads" / "a.txt").write_text("u", encoding="utf-8")

    data = ResourceService.list_resources(root)
    art_names = {e.name for e in data.artifacts}
    assert "report.md" in art_names
    assert "sub" in art_names
    # uploads 单列（物理子目录，不混入 artifacts）
    assert "uploads" not in art_names
    assert data.uploads and data.uploads[0].name == "a.txt"

    # rel_path 相对产物根（正斜杠）
    by_name = {e.name: e for e in data.artifacts}
    assert by_name["report.md"].rel_path == "report.md"
    sub = by_name["sub"]
    assert sub.rel_path == "sub"
    assert sub.children and sub.children[0].rel_path == "sub/nested.md"
    assert data.uploads[0].rel_path == "uploads/a.txt"
    # 不再有 workspace/public 桶
    assert data.workspace == []
    assert data.public == []
    assert data.artifacts[0].bucket == "artifacts"


def test_read_content_in_product_root(tmp_path):
    root = tmp_path / "proj"
    _seed(root)
    target = str(root / "artifacts" / "report.md")
    assert ResourceService.read_content(root, target) is not None


def test_sandbox_escape_rejected(tmp_path):
    root = tmp_path / "proj"
    _seed(root)
    outside = str(tmp_path / "etc_passwd")
    Path(outside).write_text("x", encoding="utf-8")
    assert ResourceService.read_content(root, outside) is None
    assert ResourceService.resolve_download_path(root, outside) is None


def test_other_project_root_rejected(tmp_path):
    """另一项目根下的文件不在本根沙箱内 → 拒绝读/删。"""
    root = tmp_path / "proj"
    other = tmp_path / "other"
    _seed(root)
    (other / "artifacts").mkdir(parents=True)
    secret = other / "artifacts" / "secret.md"
    secret.write_text("x", encoding="utf-8")
    assert ResourceService.read_content(root, str(secret)) is None
    assert ResourceService.delete_resource(root, str(secret)) is False
    assert secret.exists()


def test_batch_delete_skips_illegal(tmp_path):
    root = tmp_path / "proj"
    other = tmp_path / "other"
    _seed(root)
    (other / "artifacts").mkdir(parents=True)
    bad = other / "artifacts" / "secret.md"
    bad.write_text("x", encoding="utf-8")
    ok = str(root / "artifacts" / "report.md")
    res = ResourceService.batch_delete(root, [ok, str(bad)])
    assert ok in res["deleted"]
    assert str(bad) in res["skipped"]
    assert not Path(ok).exists()
    assert bad.exists()


def test_delete_resource_refuses_root_itself(tmp_path):
    root = tmp_path / "proj"
    _seed(root)
    assert ResourceService.delete_resource(root, str(root)) is False
    assert root.exists()
