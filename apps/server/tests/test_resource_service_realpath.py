"""资源服务真实路径 + 分桶 + 沙箱校验。"""
from pathlib import Path

from src.service.resource_service import ResourceService, _bucket_of


def _setup(tmp_path: Path):
    root = tmp_path / "root"
    conv = root / "7"
    (conv / "artifacts").mkdir(parents=True)
    (conv / "uploads").mkdir(parents=True)
    (conv / "artifacts" / "report.md").write_text("# hi", encoding="utf-8")
    (conv / "uploads" / "a.txt").write_text("u", encoding="utf-8")
    (conv / "conversation_history").mkdir(parents=True)
    (conv / "conversation_history" / "h.md").write_text("secret", encoding="utf-8")
    return str(root), conv


def test_list_resources_has_real_path_and_bucket(tmp_path):
    root, conv = _setup(tmp_path)
    data = ResourceService.list_resources(root, 7)
    art = data.artifacts[0]
    assert art.bucket == "artifacts"
    assert art.path == str(conv / "artifacts" / "report.md")
    assert data.uploads[0].bucket == "uploads"


def test_read_content_allows_bucket_file(tmp_path):
    root, conv = _setup(tmp_path)
    real = str(conv / "artifacts" / "report.md")
    content = ResourceService.read_content(root, 7, real)
    assert content is not None
    assert content.path == real


def test_read_content_rejects_non_bucket(tmp_path):
    root, conv = _setup(tmp_path)
    # conversation_history 不是允许桶
    real = str(conv / "conversation_history" / "h.md")
    assert ResourceService.read_content(root, 7, real) is None


def test_read_content_rejects_sandbox_escape(tmp_path):
    root, conv = _setup(tmp_path)
    outside = str(tmp_path / "etc_passwd")
    Path(outside).write_text("x", encoding="utf-8")
    assert ResourceService.read_content(root, 7, outside) is None


def test_bucket_of(tmp_path):
    root, conv = _setup(tmp_path)
    assert _bucket_of(conv / "artifacts" / "x", conv) == "artifacts"
    assert _bucket_of(conv / "uploads" / "x", conv) == "uploads"
    assert _bucket_of(conv / "conversation_history" / "x", conv) is None
