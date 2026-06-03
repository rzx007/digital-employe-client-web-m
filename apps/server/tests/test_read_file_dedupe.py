"""Tests for read_file duplicate suppression before LLM calls."""

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from src.service.agent.read_file_dedupe import (
    dedupe_read_file_tool_messages,
    extract_read_file_path,
    read_file_dedupe_placeholder,
)


def test_no_duplicate_unchanged() -> None:
    messages = [
        HumanMessage(content="hi"),
        ToolMessage(content="line1\nline2", name="read_file", tool_call_id="c1"),
    ]
    out = dedupe_read_file_tool_messages(messages)
    assert out[1].content == "line1\nline2"


def test_same_path_keeps_latest_only() -> None:
    path = "/artifacts/report.md"
    messages = [
        AIMessage(
            content="",
            tool_calls=[
                {
                    "id": "c1",
                    "name": "read_file",
                    "args": {"file_path": path},
                }
            ],
        ),
        ToolMessage(content="OLD BODY " * 50, name="read_file", tool_call_id="c1"),
        AIMessage(
            content="",
            tool_calls=[
                {
                    "id": "c2",
                    "name": "read_file",
                    "args": {"file_path": path},
                }
            ],
        ),
        ToolMessage(content="NEW BODY", name="read_file", tool_call_id="c2"),
    ]
    out = dedupe_read_file_tool_messages(messages)
    assert read_file_dedupe_placeholder(path) in str(out[1].content)
    assert out[3].content == "NEW BODY"


def test_different_paths_both_kept() -> None:
    messages = [
        ToolMessage(
            content="a",
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": "/a.md"},
        ),
        ToolMessage(
            content="b",
            name="read_file",
            tool_call_id="c2",
            additional_kwargs={"read_file_path": "/b.md"},
        ),
    ]
    out = dedupe_read_file_tool_messages(messages)
    assert out[0].content == "a"
    assert out[1].content == "b"


def test_error_read_not_replaced() -> None:
    path = "/missing.md"
    messages = [
        ToolMessage(
            content="Error: not found",
            name="read_file",
            tool_call_id="c1",
            status="error",
            additional_kwargs={"read_file_path": path},
        ),
        ToolMessage(
            content="ok",
            name="read_file",
            tool_call_id="c2",
            additional_kwargs={"read_file_path": path},
        ),
    ]
    out = dedupe_read_file_tool_messages(messages)
    assert out[0].content == "Error: not found"
    assert out[1].content == "ok"


def test_extract_path_from_ai_tool_call() -> None:
    messages = [
        AIMessage(
            content="",
            tool_calls=[
                {
                    "id": "c9",
                    "name": "read_file",
                    "args": {"file_path": "/uploads/x.txt"},
                }
            ],
        ),
        ToolMessage(content="data", name="read_file", tool_call_id="c9"),
    ]
    path = extract_read_file_path(messages[1], messages, 1)
    assert path == "/uploads/x.txt"


def test_image_read_clears_content_blocks_on_dedupe() -> None:
    path = "/uploads/photo.png"
    messages = [
        ToolMessage(
            content="",
            content_blocks=[{"type": "image", "base64": "abc", "mime_type": "image/png"}],
            name="read_file",
            tool_call_id="c1",
            additional_kwargs={"read_file_path": path},
        ),
        ToolMessage(
            content="latest text",
            name="read_file",
            tool_call_id="c2",
            additional_kwargs={"read_file_path": path},
        ),
    ]
    out = dedupe_read_file_tool_messages(messages)
    assert read_file_dedupe_placeholder(path) in str(out[0].content)
    blocks = out[0].content_blocks or []
    assert not any(b.get("type") == "image" for b in blocks)
