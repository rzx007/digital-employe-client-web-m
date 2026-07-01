"""语音资源：SP2 后 ResourceService 吃项目产物根，voice/ 直挂产物根下。"""
from pathlib import Path

from src.schemas.resource import VoiceUploadResult
from src.service.resource_service import ResourceService


def test_save_voice_file_writes_to_voice_dir(tmp_path: Path):
    result = ResourceService.save_voice_file(tmp_path, b"webm-bytes")
    assert isinstance(result, VoiceUploadResult)
    assert result.audio_path.startswith("voice/")
    assert result.audio_path.endswith(".webm")
    saved = tmp_path / result.audio_path
    assert saved.is_file()
    assert saved.read_bytes() == b"webm-bytes"


def test_save_voice_file_rejects_empty(tmp_path: Path):
    result = ResourceService.save_voice_file(tmp_path, b"")
    assert isinstance(result, str)


def test_save_voice_file_rejects_oversize(tmp_path: Path):
    big = b"x" * (10 * 1024 * 1024 + 1)
    result = ResourceService.save_voice_file(tmp_path, big)
    assert isinstance(result, str)


def test_resolve_voice_path_roundtrip(tmp_path: Path):
    result = ResourceService.save_voice_file(tmp_path, b"abc")
    assert isinstance(result, VoiceUploadResult)
    resolved = ResourceService.resolve_voice_path(tmp_path, result.audio_path)
    assert resolved is not None
    assert resolved.read_bytes() == b"abc"


def test_resolve_voice_path_rejects_traversal(tmp_path: Path):
    (tmp_path / "voice").mkdir(parents=True)
    (tmp_path.parent / "secret.webm").write_bytes(b"top")
    assert (
        ResourceService.resolve_voice_path(tmp_path, "voice/../../secret.webm")
        is None
    )


def test_resolve_voice_path_rejects_other_prefix(tmp_path: Path):
    assert ResourceService.resolve_voice_path(tmp_path, "uploads/a.webm") is None


def test_resolve_voice_path_missing_file(tmp_path: Path):
    assert ResourceService.resolve_voice_path(tmp_path, "voice/none.webm") is None


def test_resolve_voice_path_isolated_per_product_root(tmp_path: Path):
    root_a = tmp_path / "a"
    root_b = tmp_path / "b"
    root_a.mkdir()
    root_b.mkdir()
    result = ResourceService.save_voice_file(root_a, b"abc")
    assert isinstance(result, VoiceUploadResult)
    # 另一项目产物根解析不到 A 的语音文件
    assert ResourceService.resolve_voice_path(root_b, result.audio_path) is None
