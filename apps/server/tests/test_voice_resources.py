from pathlib import Path

from src.schemas.resource import VoiceUploadResult
from src.service.resource_service import ResourceService


def test_save_voice_file_writes_to_voice_dir(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"webm-bytes")
    assert isinstance(result, VoiceUploadResult)
    assert result.audio_path.startswith("voice/")
    assert result.audio_path.endswith(".webm")
    saved = tmp_path / "42" / result.audio_path
    assert saved.is_file()
    assert saved.read_bytes() == b"webm-bytes"


def test_save_voice_file_rejects_empty(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"")
    assert isinstance(result, str)


def test_save_voice_file_rejects_oversize(tmp_path: Path):
    big = b"x" * (10 * 1024 * 1024 + 1)
    result = ResourceService.save_voice_file(str(tmp_path), 42, big)
    assert isinstance(result, str)


def test_resolve_voice_path_roundtrip(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"abc")
    assert isinstance(result, VoiceUploadResult)
    resolved = ResourceService.resolve_voice_path(str(tmp_path), 42, result.audio_path)
    assert resolved is not None
    assert resolved.read_bytes() == b"abc"


def test_resolve_voice_path_rejects_traversal(tmp_path: Path):
    (tmp_path / "42").mkdir(parents=True)
    (tmp_path / "secret.webm").write_bytes(b"top")
    assert (
        ResourceService.resolve_voice_path(str(tmp_path), 42, "voice/../../secret.webm")
        is None
    )


def test_resolve_voice_path_rejects_other_prefix(tmp_path: Path):
    assert ResourceService.resolve_voice_path(str(tmp_path), 42, "uploads/a.webm") is None


def test_resolve_voice_path_missing_file(tmp_path: Path):
    assert ResourceService.resolve_voice_path(str(tmp_path), 42, "voice/none.webm") is None


def test_resolve_voice_path_isolated_per_conversation(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"abc")
    assert isinstance(result, VoiceUploadResult)
    assert ResourceService.resolve_voice_path(str(tmp_path), 43, result.audio_path) is None
