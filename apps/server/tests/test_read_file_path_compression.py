"""Tests for large historical read_file path-only compression (§C)."""

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from src.service.agent.read_file_path_compression import (
    compress_large_read_file_history,
    read_file_path_only_placeholder,
)


def _large_body(prefix: str = "X") -> str:
    return prefix * 5000


def test_small_read_unchanged() -> None:
    messages = [
        ToolMessage(
            content="short",
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": "/a.md"},
        ),
    ]
    out = compress_large_read_file_history(messages)
    assert out[0].content == "short"


def test_old_large_read_compressed_keeps_latest() -> None:
    path = "/artifacts/big.md"
    messages = [
        ToolMessage(
            content=_large_body("OLD"),
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": path},
        ),
        HumanMessage(content="继续"),
        ToolMessage(
            content=_large_body("NEW"),
            name="read_file",
            tool_call_id="c2",
            additional_kwargs={"read_file_path": "/other.md"},
        ),
    ]
    out = compress_large_read_file_history(messages)
    assert read_file_path_only_placeholder(path) in str(out[0].content)
    assert out[2].content == _large_body("NEW")


def test_single_large_read_kept_when_most_recent() -> None:
    body = _large_body()
    messages = [
        ToolMessage(
            content=body,
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": "/only.md"},
        ),
    ]
    out = compress_large_read_file_history(messages)
    assert out[0].content == body


def test_image_blocks_count_toward_size() -> None:
    path = "/uploads/old.png"
    messages = [
        ToolMessage(
            content="",
            content_blocks=[{"type": "image", "base64": "a" * 5000}],
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": path},
        ),
        HumanMessage(content="done"),
        ToolMessage(
            content="latest",
            name="read_file",
            tool_call_id="c2",
            additional_kwargs={"read_file_path": "/new.md"},
        ),
    ]
    out = compress_large_read_file_history(messages)
    assert read_file_path_only_placeholder(path) in str(out[0].content)
    blocks = out[0].content_blocks or []
    assert not any(b.get("type") == "image" for b in blocks)


def test_skips_already_path_only() -> None:
    path = "/a.md"
    stub = read_file_path_only_placeholder(path)
    messages = [
        ToolMessage(
            content=stub,
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": path},
        ),
        ToolMessage(
            content="ok",
            name="read_file",
            tool_call_id="c2",
            additional_kwargs={"read_file_path": "/b.md"},
        ),
    ]
    out = compress_large_read_file_history(messages)
    assert out[0].content == stub


def test_paginated_same_path_not_compressed() -> None:
    """分页阅读同一文件时，较早的大段正文不能压成 path-only stub。"""
    path = "/artifacts/big.md"
    body0 = _large_body("A")
    body200 = _large_body("B")
    messages = [
        ToolMessage(
            content=body0,
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": path, "read_file_offset": 0},
        ),
        ToolMessage(
            content=body200,
            name="read_file",
            tool_call_id="c2",
            additional_kwargs={"read_file_path": path, "read_file_offset": 200},
        ),
    ]
    out = compress_large_read_file_history(messages)
    assert out[0].content == body0
    assert out[1].content == body200
