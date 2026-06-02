from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from src.service.agent_message_builder import (
    build_history_user_content,
    build_user_agent_content,
)


def _uploads_dir(root: Path, conversation_id: int = 1) -> Path:
    path = root / str(conversation_id) / "uploads"
    path.mkdir(parents=True)
    return path


def _save_image(path: Path, size: tuple[int, int] = (400, 300)) -> None:
    Image.new("RGB", size, (64, 128, 192)).save(path)


def test_build_current_user_content_with_vision_image(tmp_path: Path) -> None:
    uploads = _uploads_dir(tmp_path)
    image_path = uploads / "photo.png"
    _save_image(image_path)

    content = build_user_agent_content(
        "请描述这张图",
        [{"path": "/uploads/photo.png", "name": "photo.png"}],
        artifacts_root=tmp_path,
        conversation_id=1,
        allow_images=True,
    )

    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image_url"
    assert "data:image/" in content[1]["image_url"]["url"]


def test_build_current_user_content_without_vision_degrades_to_text(
    tmp_path: Path,
) -> None:
    uploads = _uploads_dir(tmp_path)
    image_path = uploads / "photo.png"
    _save_image(image_path)

    content = build_user_agent_content(
        "请描述这张图",
        [{"path": "/uploads/photo.png", "name": "photo.png"}],
        artifacts_root=tmp_path,
        conversation_id=1,
        allow_images=False,
    )

    assert isinstance(content, str)
    assert "当前模型不支持图片理解" in content
    assert "/uploads/photo.png" in content


def test_build_history_user_content_rebuilds_image_block(tmp_path: Path) -> None:
    uploads = _uploads_dir(tmp_path)
    image_path = uploads / "photo.png"
    _save_image(image_path)
    message = SimpleNamespace(
        role="user",
        content="第一轮问题",
        extra_meta='{"files":[{"path":"/uploads/photo.png","name":"photo.png"}]}',
    )

    payload, used_bytes, included = build_history_user_content(
        message,
        artifacts_root=tmp_path,
        conversation_id=1,
        allow_images=True,
    )

    assert included
    assert used_bytes > 0
    assert isinstance(payload["content"], list)
    assert payload["content"][1]["type"] == "image_url"


def test_build_history_user_content_respects_byte_budget(tmp_path: Path) -> None:
    uploads = _uploads_dir(tmp_path)
    image_path = uploads / "photo.png"
    _save_image(image_path)
    message = SimpleNamespace(
        role="user",
        content="第一轮问题",
        extra_meta='{"files":[{"path":"/uploads/photo.png","name":"photo.png"}]}',
    )

    payload, used_bytes, included = build_history_user_content(
        message,
        artifacts_root=tmp_path,
        conversation_id=1,
        allow_images=True,
        remaining_byte_budget=1,
    )

    assert not included
    assert used_bytes == 0
    assert isinstance(payload["content"], str)
    assert "历史图片预算不足" in payload["content"]


def test_build_user_content_inlines_document_text(tmp_path: Path) -> None:
    from docx import Document

    uploads = _uploads_dir(tmp_path)
    docx_path = uploads / "report.docx"
    document = Document()
    document.add_paragraph("文档里的关键内容")
    document.save(str(docx_path))

    content = build_user_agent_content(
        "总结附件",
        [{"path": "/uploads/report.docx", "name": "report.docx"}],
        artifacts_root=tmp_path,
        conversation_id=1,
        allow_images=True,
    )

    assert isinstance(content, str)
    assert "文档里的关键内容" in content
    assert "总结附件" in content
