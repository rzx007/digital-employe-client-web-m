"""DashScope 兼容 read_file 中间件测试。"""

import base64

from deepagents.backends.protocol import FileData, ReadResult
from langchain_core.messages import ToolMessage

from src.service.basic_file_reader import DASHSCOPE_MAX_MULTIMODAL_BYTES
from src.service.agent.compatible_filesystem_middleware import (
    handle_compatible_read_result,
    sanitize_messages_for_openai_compatible,
)

_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaG"
    "AAAAIEAIFb8XqMAAAAAElFTkSuQmCC"
)


def _truncate(content: str, _file_path: str, _limit: int) -> str:
    return content


def test_pdf_extracted_as_utf8_returns_text_not_file_block():
    read_result = ReadResult(
        file_data=FileData(
            content="Page 1\nHello PDF",
            encoding="utf-8",
        )
    )
    msg = handle_compatible_read_result(
        read_result,
        "/uploads/report.pdf",
        "call-1",
        0,
        100,
        truncate=_truncate,
    )
    assert msg.content
    assert "Hello PDF" in msg.content
    blocks = msg.content_blocks or []
    assert not any(b.get("type") == "file" for b in blocks)


def test_image_returns_image_block():
    read_result = ReadResult(
        file_data=FileData(content=_PNG_B64, encoding="base64")
    )
    msg = handle_compatible_read_result(
        read_result,
        "/uploads/photo.png",
        "call-2",
        0,
        100,
        truncate=_truncate,
    )
    assert msg.content_blocks
    assert msg.content_blocks[0]["type"] == "image"


def test_sanitize_checkpoint_tool_message_with_file_block():
    msg = ToolMessage(
        content_blocks=[
            {"type": "file", "base64": "abc", "mime_type": "application/pdf"},
        ],
        name="read_file",
        tool_call_id="call-old",
        additional_kwargs={"read_file_path": "/uploads/report.pdf"},
    )
    out = sanitize_messages_for_openai_compatible([msg])[0]
    assert isinstance(out, ToolMessage)
    assert "report.pdf" in str(out.content)
    blocks = out.content_blocks or []
    assert not any(b.get("type") == "file" for b in blocks)


def test_sanitize_oversized_image_block():
    oversized = base64.b64encode(b"x" * (DASHSCOPE_MAX_MULTIMODAL_BYTES + 1)).decode(
        "ascii"
    )
    msg = ToolMessage(
        content_blocks=[
            {"type": "image", "base64": oversized, "mime_type": "image/png"},
        ],
        name="read_file",
        tool_call_id="call-big",
        additional_kwargs={"read_file_path": "/uploads/huge.png"},
    )
    out = sanitize_messages_for_openai_compatible([msg], allow_images=True)[0]
    assert "超过当前模型多模态上限" in str(out.content)
    blocks = out.content_blocks or []
    assert not any(b.get("type") == "image" for b in blocks)


def test_sanitize_keeps_image_for_vision_model():
    msg = ToolMessage(
        content_blocks=[
            {"type": "image", "base64": "aGVsbG8=", "mime_type": "image/png"},
        ],
        name="read_file",
        tool_call_id="call-img",
        additional_kwargs={"read_file_path": "/uploads/photo.png"},
    )
    out = sanitize_messages_for_openai_compatible([msg], allow_images=True)[0]
    payload = out.content if isinstance(out.content, list) else (out.content_blocks or [])
    assert payload
    assert payload[0]["type"] == "image_url"
    assert "data:image/png;base64," in str(payload[0].get("image_url", {}).get("url"))


def test_sanitize_strips_image_for_text_model():
    msg = ToolMessage(
        content_blocks=[
            {"type": "image", "base64": "aGVsbG8=", "mime_type": "image/png"},
        ],
        name="read_file",
        tool_call_id="call-img",
        additional_kwargs={"read_file_path": "/uploads/photo.png"},
    )
    out = sanitize_messages_for_openai_compatible([msg], allow_images=False)[0]
    assert "视觉模型" in str(out.content)


def test_oversized_image_read_result_returns_error():
    oversized = base64.b64encode(b"x" * (DASHSCOPE_MAX_MULTIMODAL_BYTES + 1)).decode(
        "ascii"
    )
    read_result = ReadResult(
        file_data=FileData(content=oversized, encoding="base64")
    )
    msg = handle_compatible_read_result(
        read_result,
        "/uploads/huge.png",
        "call-4",
        0,
        100,
        truncate=_truncate,
    )
    assert msg.status == "error"
    assert "超过当前模型多模态上限" in str(msg.content)


def test_binary_file_without_utf8_encoding_returns_error():
    read_result = ReadResult(
        file_data=FileData(content="JVBERi0=", encoding="base64")
    )
    msg = handle_compatible_read_result(
        read_result,
        "/uploads/report.pdf",
        "call-3",
        0,
        100,
        truncate=_truncate,
    )
    assert msg.status == "error"
    assert "不支持" in str(msg.content)
