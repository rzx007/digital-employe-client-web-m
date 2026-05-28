"""message_parts_extractor 回归：流式 tool input 与 DB message_parts 对齐。"""

from __future__ import annotations

from src.service.message_parts_extractor import extract_message_parts_from_buffer

# read_file 分片流（与 apps/web mock SSE 一致）：chunked args + 空 id
READ_FILE_STREAM_EVENTS = [
    {
        "seq": 0,
        "data": {
            "type": "messages",
            "data": [
                {
                    "lc": 1,
                    "type": "constructor",
                    "id": ["langchain", "schema", "messages", "AIMessageChunk"],
                    "kwargs": {
                        "content": "",
                        "type": "AIMessageChunk",
                        "id": "lc_run--read-file-test",
                        "tool_calls": [
                            {
                                "name": "read_file",
                                "args": {},
                                "id": "call_6c944c1c8d874ea299df44",
                                "type": "tool_call",
                            }
                        ],
                        "tool_call_chunks": [
                            {
                                "name": "read_file",
                                "args": '{"file',
                                "id": "call_6c944c1c8d874ea299df44",
                                "index": 0,
                                "type": "tool_call_chunk",
                            }
                        ],
                        "invalid_tool_calls": [],
                    },
                },
                {"langgraph_node": "model"},
            ],
        },
    },
    {
        "seq": 1,
        "data": {
            "type": "messages",
            "data": [
                {
                    "lc": 1,
                    "type": "constructor",
                    "id": ["langchain", "schema", "messages", "AIMessageChunk"],
                    "kwargs": {
                        "content": "",
                        "type": "AIMessageChunk",
                        "id": "lc_run--read-file-test",
                        "tool_calls": [],
                        "invalid_tool_calls": [
                            {
                                "name": None,
                                "args": '_path": "/a',
                                "id": "",
                                "type": "invalid_tool_call",
                            }
                        ],
                        "tool_call_chunks": [
                            {
                                "name": None,
                                "args": '_path": "/a',
                                "id": "",
                                "index": 0,
                                "type": "tool_call_chunk",
                            }
                        ],
                    },
                },
                {"langgraph_node": "model"},
            ],
        },
    },
    {
        "seq": 2,
        "data": {
            "type": "messages",
            "data": [
                {
                    "lc": 1,
                    "type": "constructor",
                    "id": ["langchain", "schema", "messages", "AIMessageChunk"],
                    "kwargs": {
                        "content": "",
                        "type": "AIMessageChunk",
                        "id": "lc_run--read-file-test",
                        "tool_calls": [],
                        "invalid_tool_calls": [
                            {
                                "name": None,
                                "args": '.txt"}',
                                "id": "",
                                "type": "invalid_tool_call",
                            }
                        ],
                        "tool_call_chunks": [
                            {
                                "name": None,
                                "args": '.txt"}',
                                "id": "",
                                "index": 0,
                                "type": "tool_call_chunk",
                            }
                        ],
                    },
                },
                {"langgraph_node": "model"},
            ],
        },
    },
    {
        "seq": 3,
        "data": {
            "type": "messages",
            "data": [
                {
                    "lc": 1,
                    "type": "constructor",
                    "id": ["langchain", "schema", "messages", "ToolMessage"],
                    "kwargs": {
                        "content": "System reminder: File exists but has empty contents",
                        "type": "tool",
                        "name": "read_file",
                        "tool_call_id": "call_6c944c1c8d874ea299df44",
                        "status": "success",
                    },
                },
                {"langgraph_node": "tools"},
            ],
        },
    },
]

UPDATES_ONLY_EVENT = {
    "seq": 0,
    "data": {
        "type": "updates",
        "data": {
            "model": {
                "messages": [
                    {
                        "lc": 1,
                        "type": "constructor",
                        "id": [
                            "langchain",
                            "schema",
                            "messages",
                            "AIMessage",
                        ],
                        "kwargs": {
                            "id": "lc_run--test",
                            "tool_calls": [
                                {
                                    "name": "read_file",
                                    "args": {"file_path": "/skills/foo/SKILL.md"},
                                    "id": "call_test_read",
                                    "type": "tool_call",
                                }
                            ],
                        },
                    }
                ]
            }
        },
    },
}

READ_FILE_TOOL_MESSAGE_EVENT = {
    "seq": 1,
    "data": {
        "type": "messages",
        "data": [
            {
                "lc": 1,
                "type": "constructor",
                "id": ["langchain", "schema", "messages", "ToolMessage"],
                "kwargs": {
                    "content": "ok",
                    "type": "tool",
                    "name": "read_file",
                    "tool_call_id": "call_test_read",
                    "status": "success",
                },
            },
            {},
        ],
    },
}

NULL_CHUNK_EVENTS = [
    {
        "seq": 0,
        "data": {
            "type": "messages",
            "data": [
                {
                    "lc": 1,
                    "type": "constructor",
                    "id": ["langchain", "schema", "messages", "AIMessageChunk"],
                    "kwargs": {
                        "id": "lc_run--null-chunk",
                        "tool_calls": [
                            {
                                "name": "read_file",
                                "args": {},
                                "id": "call_null_chunk",
                                "type": "tool_call",
                            }
                        ],
                        "tool_call_chunks": [
                            {
                                "args": None,
                                "id": "",
                                "index": 0,
                                "type": "tool_call_chunk",
                            }
                        ],
                        "invalid_tool_calls": [
                            {
                                "args": '{"file_path": "/b.txt"}',
                                "id": "",
                                "index": 0,
                                "type": "invalid_tool_call",
                            }
                        ],
                    },
                },
                {},
            ],
        },
    },
    {
        "seq": 1,
        "data": {
            "type": "messages",
            "data": [
                {
                    "lc": 1,
                    "type": "constructor",
                    "id": ["langchain", "schema", "messages", "ToolMessage"],
                    "kwargs": {
                        "content": "ok",
                        "type": "tool",
                        "name": "read_file",
                        "tool_call_id": "call_null_chunk",
                        "status": "success",
                    },
                },
                {},
            ],
        },
    },
]


def _read_file_part(parts: list[dict]) -> dict:
    read_parts = [p for p in parts if p.get("type") == "tool-read_file"]
    assert read_parts, "expected read_file tool part"
    return read_parts[0]


def test_read_file_streaming_chunks_produce_input() -> None:
    parts = extract_message_parts_from_buffer(READ_FILE_STREAM_EVENTS)
    assert parts

    read_part = _read_file_part(parts)
    assert read_part.get("input") is not None
    assert read_part["input"].get("file_path") == "/a.txt"


def test_updates_only_provides_tool_input() -> None:
    parts = extract_message_parts_from_buffer(
        [UPDATES_ONLY_EVENT, READ_FILE_TOOL_MESSAGE_EVENT]
    )
    assert parts
    assert parts[0].get("input") == {"file_path": "/skills/foo/SKILL.md"}


def test_null_tool_call_chunks_fallback_to_invalid() -> None:
    parts = extract_message_parts_from_buffer(NULL_CHUNK_EVENTS)
    assert parts
    assert parts[0].get("input") == {"file_path": "/b.txt"}
